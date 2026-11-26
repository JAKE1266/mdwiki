/** WikiIndex tests: listing, safe reads, resolution, backlinks, search. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WikiIndex } from '../lib/wiki.js'

let n = 0
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); n++ }
  catch (e) { console.error(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1 }
}

const FIXTURE = {
  'Home.md': '# Home\n\n欢迎。相关页面:[[示例页]] 与 [[项目笔记]]。\n',
  '示例页.md': '# 示例页\n\n来自 [[Home]] 的链接。\n\n[[不存在的页面]] 是 missing。\n',
  'notes/项目笔记.md': '# 项目笔记\n\n subdir 页面,反向链接到 [[示例页|首页示例]]。\n',
}

const mkWiki = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdwiki-wiki-'))
  for (const [rel, text] of Object.entries(FIXTURE)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text, 'utf8')
  }
  return new WikiIndex(dir)
}

test('listPages walks subdirectories, skips hidden, sorted', () => {
  const w = mkWiki()
  fs.mkdirSync(path.join(w.root, '.hidden'), { recursive: true })
  fs.writeFileSync(path.join(w.root, '.hidden', 'secret.md'), 'x', 'utf8')
  const pages = w.listPages()
  assert.deepEqual(pages.map((p) => p.path), ['Home.md', 'notes/项目笔记.md', '示例页.md'])
})

test('readPage renders html and resolves wikilinks to real paths', () => {
  const w = mkWiki()
  const p = w.readPage('Home.md')
  assert.equal(p.ok, true)
  assert.match(p.html, /<h1 id="home">Home<\/h1>/)
  assert.match(p.html, /class="wl" href="\/wiki\/%E7%A4%BA%E4%BE%8B%E9%A1%B5\.md"/)
  // [[项目笔记]] 的 href 直接嵌入解析后的子目录真实路径
  assert.match(p.html, /href="\/wiki\/notes%2F%E9%A1%B9%E7%9B%AE%E7%AC%94%E8%AE%B0\.md"/)
})

test('backlinks: pages linking here, with label text', () => {
  const w = mkWiki()
  const p = w.readPage('示例页.md')
  const sources = p.backlinks.map((b) => b.source)
  assert.ok(sources.includes('Home.md'), 'Home 链接到示例页')
  assert.ok(sources.includes('notes/项目笔记.md'), '项目笔记也链接到示例页')
  const home = w.readPage('Home.md')
  assert.deepEqual(home.backlinks.map((b) => b.source), ['示例页.md'], '示例页 链接回 Home')
})

test('resolveLink normalizes case/spaces/.md and finds subdir pages', () => {
  const w = mkWiki()
  assert.equal(w.resolveLink('home'), 'Home.md')
  assert.equal(w.resolveLink('Home.md'), 'Home.md')
  assert.equal(w.resolveLink('示例 页'), '示例页.md', '空格/下划线归一')
  assert.equal(w.resolveLink('项目笔记'), 'notes/项目笔记.md')
  assert.equal(w.resolveLink('不存在'), null)
})

test('readPage rejects path escape and non-md targets', () => {
  const w = mkWiki()
  assert.equal(w.readPage('../outside.md').ok, false)
  assert.equal(w.readPage('a/../../x.md').ok, false)
  assert.equal(w.readPage('Home.txt').ok, false, '只允许 .md')
  assert.equal(w.readPage('不存在.md').ok, false)
})

test('search finds pages by content, ranks by hits, caps per-page lines', () => {
  const w = mkWiki()
  fs.writeFileSync(path.join(w.root, '密集.md'), '# 密集\n\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n示例 出现\n', 'utf8')
  const results = w.search('示例')
  const dense = results.find((r) => r.path === '密集.md')
  assert.ok(dense)
  assert.equal(dense.count, 12, '同行多次出现也计数')
  assert.equal(dense.hits.length, 10, '每页最多 10 条命中行')
  assert.ok(results.some((r) => r.path === '示例页.md'))
  assert.deepEqual(w.search('  '), [], '空查询')
})

test('search title prefers the first # heading', () => {
  const w = mkWiki()
  const results = w.search('欢迎')
  assert.equal(results[0].path, 'Home.md')
  assert.equal(results[0].title, 'Home')
})

test('seedIfEmpty creates starter pages only once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdwiki-seed-'))
  const w = new WikiIndex(dir)
  assert.equal(w.seedIfEmpty(), true)
  assert.ok(fs.existsSync(path.join(dir, 'Home.md')))
  assert.equal(w.seedIfEmpty(), false, '已有内容不再播种')
})

test('path escape via backslash is also blocked', () => {
  const w = mkWiki()
  assert.equal(w.readPage('..\\secret.md').ok, false)
})

console.log(`\n${n} passed${process.exitCode ? ', some FAILED' : ', 0 failed'}`)
