/**
 * Minimal Markdown renderer + [[wikilink]] extraction. Zero dependencies.
 *
 * Security model (same as the project set's mdLite approach): the ENTIRE
 * input is HTML-escaped FIRST, then a small whitelist of block/inline
 * transforms runs on escaped text — no raw markup from a page can reach
 * innerHTML. Link/image URLs must start with http(s):, mailto:, / or #;
 * javascript: and friends degrade to plain text.
 *
 * Scope (deliberately minimal): headings, fenced code, quotes, flat lists,
 * hr, paragraphs, inline code/bold/italic/links/images/wikilinks. No tables,
 * no nested lists — this is a personal wiki, not a CommonMark implementation.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function slugify(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || 'section'
}

/** Normalized name for [[wikilink]] matching: case-insensitive, strips .md
 *  and ALL separators (spaces/underscores/hyphens) so [[示例 页]] still finds
 *  示例页.md and [[page-name]] finds Page Name.md. */
export function normalizeName(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\.md$/, '').replace(/[\s_-]+/g, '')
}

/** Extract [[target]] / [[target|label]] pairs, skipping fenced code blocks. */
export function extractWikilinks(src) {
  const out = []
  let inCode = false
  for (const raw of String(src ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const fence = raw.match(/^\s*```/)
    if (fence) { inCode = !inCode; continue }
    if (inCode) continue
    for (const m of raw.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
      const target = m[1].trim()
      if (target) out.push({ target, text: (m[2] ?? target).trim() })
    }
  }
  return out
}

const safeUrl = (url) => /^(https?:|mailto:|#|\/)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url)

function wikilinkHtml(specEsc, resolve) {
  const parts = specEsc.split('|')
  const target = parts[0].trim()
  const label = (parts[1] ?? parts[0]).trim()
  // The href points at the RESOLVED page path when the target exists, so the
  // server can serve subdirectory pages directly; missing links keep the raw
  // target and get the "missing" class.
  const resolved = resolve ? resolve(target) : null
  const href = `/wiki/${encodeURIComponent(resolved ?? target)}`
  return `<a class="wl${resolved ? '' : ' missing'}" href="${href}" data-wiki="${esc(target)}">${label}</a>`
}

/** Inline transforms on ALREADY-ESCAPED text. */
function inline(s, resolve) {
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => safeUrl(url) ? `<img src="${url}" alt="${alt}">` : m)
  s = s.replace(/\[\[([^\]]+)\]\]/g, (m, spec) => wikilinkHtml(spec, resolve))
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => safeUrl(url) ? `<a href="${url}" rel="noopener">${text}</a>` : text)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  return s
}

/**
 * Render Markdown to HTML.
 * @param {string} src
 * @param {object} [opts] { resolve?: (target) => string|null } — resolves a
 *   wikilink target to an existing page path (null = missing → class "missing").
 */
export function renderMd(src, opts = {}) {
  const resolve = typeof opts.resolve === 'function' ? opts.resolve : null
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let inCode = false
  let codeLang = ''
  let codeBuf = []
  let listTag = null   // 'ul' | 'ol'
  let inQuote = false

  const closeList = () => { if (listTag) { out.push(`</${listTag}>`); listTag = null } }
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false } }
  const closeAll = () => { closeList(); closeQuote() }

  for (const raw of lines) {
    const fence = raw.match(/^\s*```(\S*)\s*$/)
    if (fence) {
      if (!inCode) {
        closeAll()
        inCode = true
        codeLang = fence[1] ?? ''
        codeBuf = []
      } else {
        inCode = false
        const cls = codeLang ? ` class="lang-${esc(codeLang)}"` : ''
        out.push(`<pre><code${cls}>${codeBuf.join('\n')}</code></pre>`)
      }
      continue
    }
    if (inCode) { codeBuf.push(esc(raw)); continue }

    const line = esc(raw)
    if (/^\s*$/.test(line)) { closeAll(); continue }

    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      closeAll()
      const lvl = h[1].length
      out.push(`<h${lvl} id="${esc(slugify(h[2]))}">${inline(h[2], resolve)}</h${lvl}>`)
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeAll(); out.push('<hr>'); continue }

    const q = line.match(/^\s*&gt;\s?(.*)$/)
    if (q) {
      closeList()
      if (!inQuote) { out.push('<blockquote>'); inQuote = true }
      out.push(`<p>${inline(q[1], resolve)}</p>`)
      continue
    }

    const li = line.match(/^(\s*)([-*]|\d+[.)])\s+(.+)$/)
    if (li) {
      closeQuote()
      const tag = /^\d/.test(li[2]) ? 'ol' : 'ul'
      if (listTag !== tag) {
        closeList()
        out.push(`<${tag}>`)
        listTag = tag
      }
      out.push(`<li>${inline(li[3], resolve)}</li>`)
      continue
    }

    closeList()
    closeQuote()
    out.push(`<p>${inline(line, resolve)}</p>`)
  }
  closeAll()
  if (inCode) {
    // Unclosed fence: close it with the same language marker.
    const cls = codeLang ? ` class="lang-${esc(codeLang)}"` : ''
    out.push(`<pre><code${cls}>${codeBuf.join('\n')}</code></pre>`)
  }
  return out.join('\n')
}
