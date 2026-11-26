/**
 * HTTP E2E — boots the real mdwiki server against a TEMP wiki directory
 * fixture and exercises the API + dashboard + security guards.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let n = 0
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); n++ }
  catch (e) { console.error(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1 }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)) })
  })
}
function killTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill('SIGKILL')
}

// ---- wiki fixture ----
const wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdwiki-e2e-'))
fs.writeFileSync(path.join(wikiDir, 'Home.md'), '# Home\n\n欢迎来到主页。相关:[[示例页]] 与 [[notes/项目笔记]]。\n', 'utf8')
fs.mkdirSync(path.join(wikiDir, 'notes'), { recursive: true })
fs.writeFileSync(path.join(wikiDir, 'notes', '项目笔记.md'), '# 项目笔记\n\n回到 [[Home]] 或 [[示例页|示例]]。\n', 'utf8')
fs.writeFileSync(path.join(wikiDir, '示例页.md'), '# 示例页\n\n包含关键词 蓝色雷达。\n', 'utf8')

const port = await freePort()
const base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, WIKI_ROOT: wikiDir, WIKI_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
const logs = []
child.stdout.on('data', (d) => logs.push(d.toString()))
child.stderr.on('data', (d) => logs.push(d.toString()))

let up = false
for (let i = 0; i < 50 && !up; i++) {
  try { up = (await fetch(`${base}/api/pages`)).ok } catch { await sleep(250) }
}

try {
  if (!up) throw new Error('服务器未启动: ' + logs.join('').slice(-500))

  await test('仪表盘静态页可访问', async () => {
    const res = await fetch(`${base}/`)
    assert.equal(res.status, 200)
    assert.match(await res.text(), /mdwiki/)
  })

  await test('/api/pages 列出全部页面(含子目录)', async () => {
    const d = await (await fetch(`${base}/api/pages`)).json()
    assert.deepEqual(d.pages.map((p) => p.path).sort(), ['Home.md', 'notes/项目笔记.md', '示例页.md'].sort())
  })

  await test('/api/page 渲染 HTML + 反链正确', async () => {
    const p = await (await fetch(`${base}/api/page/${encodeURIComponent('Home.md')}`)).json()
    assert.equal(p.ok, true)
    assert.match(p.html, /<h1 id="home">Home<\/h1>/)
    assert.match(p.html, /class="wl" href="\/wiki\/[^"]+"/, 'wikilink 渲染为内部链接')
    const srcs = p.backlinks.map((b) => b.source)
    assert.ok(srcs.includes('notes/项目笔记.md'), '项目笔记 链接回 Home')
  })

  await test('子目录页面可读,反链含标签文本', async () => {
    const p = await (await fetch(`${base}/api/page/${encodeURIComponent('notes/项目笔记.md')}`)).json()
    assert.equal(p.ok, true)
    const bl = p.backlinks.find((b) => b.source === 'Home.md')
    assert.ok(bl, 'Home 链接到项目笔记')
  })

  await test('/api/search 命中关键词并返回标题', async () => {
    const d = await (await fetch(`${base}/api/search?q=${encodeURIComponent('蓝色雷达')}`)).json()
    assert.equal(d.results.length, 1)
    assert.equal(d.results[0].path, '示例页.md')
    assert.equal(d.results[0].title, '示例页')
    assert.ok(d.results[0].hits[0].text.includes('蓝色雷达'))
  })

  await test('不存在的页面返回 404 + ok:false', async () => {
    const res = await fetch(`${base}/api/page/${encodeURIComponent('不存在.md')}`)
    assert.equal(res.status, 404)
    assert.equal((await res.json()).ok, false)
  })

  await test('路径逃逸被拒绝(../ 与反斜杠)', async () => {
    const r1 = await fetch(`${base}/api/page/${encodeURIComponent('../outside.md')}`)
    assert.equal(r1.status, 404)
    assert.equal((await r1.json()).ok, false)
    const r2 = await fetch(`${base}/api/page/${encodeURIComponent('..\\secret.md')}`)
    assert.equal(r2.status, 404)
  })

  await test('非 .md 目标被拒绝', async () => {
    const res = await fetch(`${base}/api/page/${encodeURIComponent('Home.txt')}`)
    assert.equal(res.status, 404)
  })

  await test('rootDir 缺失时自动播种(第二个隔离实例)', async () => {
    const seedDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mdwiki-seed-')), 'notes')
    const port2 = await freePort()
    const child2 = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, WIKI_ROOT: seedDir, WIKI_PORT: String(port2) },
      stdio: 'ignore', windowsHide: true,
    })
    try {
      let ok = false
      for (let i = 0; i < 40 && !ok; i++) {
        try { ok = (await fetch(`http://127.0.0.1:${port2}/api/pages`)).ok } catch { await sleep(250) }
      }
      assert.equal(ok, true)
      const d = await (await fetch(`http://127.0.0.1:${port2}/api/pages`)).json()
      assert.ok(d.pages.some((p) => p.path === 'Home.md'), '自动播种 Home.md')
    } finally {
      killTree(child2)
    }
  })
} finally {
  killTree(child)
  await sleep(500)
  try { fs.rmSync(wikiDir, { recursive: true, force: true }) } catch {}
}

console.log(`\n${n} passed${process.exitCode ? ', some FAILED' : ', 0 failed'}`)
