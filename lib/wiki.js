/**
 * WikiIndex — scans a directory of .md files: page listing, safe reads,
 * [[wikilink]] resolution, backlinks, and case-insensitive full-text search.
 * Zero dependencies. Hidden directories (dot-prefixed) are skipped.
 */
import fs from 'node:fs'
import path from 'node:path'
import { renderMd, extractWikilinks, normalizeName } from './md.js'

export class WikiIndex {
  constructor(rootDir, { onLog = () => {} } = {}) {
    this.root = path.resolve(rootDir)
    this.onLog = onLog
  }

  /** Recursive .md listing (forward-slash relative paths, hidden dirs skipped). */
  listPages() {
    const out = []
    const walk = (dir, rel = '') => {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue
        const abs = path.join(dir, e.name)
        const relPath = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) walk(abs, relPath)
        else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          const st = fs.statSync(abs)
          out.push({ path: relPath, name: path.basename(e.name, '.md'), size: st.size, mtime: st.mtimeMs })
        }
      }
    }
    walk(this.root)
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  /** Guard: a relative path must stay inside the root and point at a file. */
  _safeResolve(relPath) {
    const rel = String(relPath ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel.toLowerCase().endsWith('.md')) return null
    const abs = path.resolve(this.root, rel)
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) return null
    return abs
  }

  /**
   * Read + render one page. Returns
   *   { ok: true, path, raw, html, backlinks: [{ source, text }] }
   * or { ok: false, error } (missing file / path escape).
   */
  readPage(relPath) {
    const abs = this._safeResolve(relPath)
    if (!abs) return { ok: false, error: '路径不合法(必须是 root 内的 .md 文件)' }
    let raw
    try {
      raw = fs.readFileSync(abs, 'utf8')
    } catch {
      return { ok: false, error: '页面不存在' }
    }
    const pagePath = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
    const norm = normalizeName(pagePath)
    // Backlinks: every page whose wikilinks resolve to THIS page.
    const backlinks = []
    for (const p of this.listPages()) {
      if (normalizeName(p.path) === norm) continue
      let text
      try { text = fs.readFileSync(path.join(this.root, p.path), 'utf8') } catch { continue }
      for (const link of extractWikilinks(text)) {
        if (normalizeName(link.target) === norm) {
          backlinks.push({ source: p.path, text: link.text })
        }
      }
    }
    return {
      ok: true,
      path: pagePath,
      raw,
      html: renderMd(raw, { resolve: (name) => this.resolveLink(name) }),
      backlinks,
    }
  }

  /** Resolve a [[wikilink]] target to a page's relative path, or null.
   *  Matching ignores case, spaces/underscores and a trailing .md. */
  resolveLink(target) {
    const want = normalizeName(target)
    if (!want) return null
    for (const p of this.listPages()) {
      if (normalizeName(p.path) === want) return p.path
      if (normalizeName(p.name) === want) return p.path
    }
    return null
  }

  /** Page title: first `# ` heading, else the file stem. */
  _title(text, pagePath) {
    const m = text.match(/^#\s+(.+)$/m)
    return m ? m[1].trim() : path.basename(pagePath, '.md')
  }

  /**
   * Full-text search (case-insensitive substring).
   * @returns [{ path, title, count, hits: [{ line, text }] }] — at most
   * `limit` pages, at most 10 hit lines per page.
   */
  search(query, { limit = 50 } = {}) {
    const q = String(query ?? '').trim().toLowerCase()
    if (!q) return []
    const results = []
    for (const p of this.listPages()) {
      let text
      try { text = fs.readFileSync(path.join(this.root, p.path), 'utf8') } catch { continue }
      const lines = text.replace(/\r\n?/g, '\n').split('\n')
      const hits = []
      let count = 0
      lines.forEach((line, i) => {
        const lower = line.toLowerCase()
        let idx = lower.indexOf(q)
        if (idx >= 0) {
          count++
          if (hits.length < 10) hits.push({ line: i + 1, text: line.trim().slice(0, 200) })
          // count additional occurrences on the same line
          while ((idx = lower.indexOf(q, idx + q.length)) >= 0) count++
        }
      })
      if (count > 0) results.push({ path: p.path, title: this._title(text, p.path), count, hits })
      if (results.length >= limit) break
    }
    return results.sort((a, b) => b.count - a.count)
  }

  /** Create the root dir with a small starter set when it does not exist. */
  seedIfEmpty() {
    if (fs.existsSync(this.root) && this.listPages().length) return false
    fs.mkdirSync(this.root, { recursive: true })
    const pages = {
      'Home.md': '# Home\n\n欢迎使用 mdwiki —— 零依赖本地 Wiki。\n\n- 用左侧列表或搜索浏览页面\n- 页面里写 [[其它页面]] 即可互相链接\n\n## 快速上手\n\n新建一个 `笔记.md` 放进本目录,刷新就能看到。\n\n> 提示:不存在的 [[页面链接]] 会显示为虚线,点击后提示未创建。\n',
      '示例页.md': '# 示例页\n\n这是 [[Home]] 的子页面,用于演示反向链接。\n\n- 列表项\n- **加粗** 与 *斜体* 与 `行内代码`\n\n```\n代码块保持原样,[[不会解析]]\n```\n',
    }
    for (const [name, text] of Object.entries(pages)) {
      fs.writeFileSync(path.join(this.root, name), text, 'utf8')
    }
    this.onLog(`seeded starter pages into ${this.root}`)
    return true
  }
}
