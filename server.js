/**
 * mdwiki server — zero dependency.
 *
 *   node server.js [rootDir]        → http://127.0.0.1:8797
 *   WIKI_ROOT=/path WIKI_PORT=9000  also accepted
 *
 * rootDir defaults to ./notes (auto-seeded with starter pages). The UI is a
 * single static file with hash routing: #/page/<path>, #/search/<query>.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WikiIndex } from './lib/wiki.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const argv = process.argv.slice(2)
const posArg = argv.find((a) => !a.startsWith('--'))
const portArg = (() => {
  const i = argv.indexOf('--port')
  return i >= 0 ? Number(argv[i + 1]) : null
})()

const rootDir = path.resolve(process.env.WIKI_ROOT || posArg || path.join(__dirname, 'notes'))
const PORT = portArg || Number(process.env.WIKI_PORT) || 8797

const wiki = new WikiIndex(rootDir)
if (wiki.seedIfEmpty()) console.log(`已播种示例页面到 ${rootDir}`)

const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(data))
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (u.pathname === '/api/pages' && req.method === 'GET') {
      return json(res, 200, { root: rootDir, pages: wiki.listPages() })
    }
    if (u.pathname.startsWith('/api/page/') && req.method === 'GET') {
      const rel = decodeURIComponent(u.pathname.slice('/api/page/'.length))
      const page = wiki.readPage(rel)
      return json(res, page.ok ? 200 : 404, page)
    }
    if (u.pathname === '/api/search' && req.method === 'GET') {
      const q = u.searchParams.get('q') ?? ''
      const limit = Math.min(Number(u.searchParams.get('limit')) || 50, 200)
      return json(res, 200, { q, results: wiki.search(q, { limit }) })
    }
    if (u.pathname === '/' && req.method === 'GET') {
      const p = path.join(__dirname, 'public', 'index.html')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(fs.readFileSync(p))
    }
    return json(res, 404, { error: 'Not found' })
  } catch (e) {
    return json(res, 500, { error: e.message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mdwiki → http://127.0.0.1:${PORT}`)
  console.log(`wiki 目录: ${rootDir}`)
})
process.on('SIGINT', () => { server.close(); process.exit(0) })
