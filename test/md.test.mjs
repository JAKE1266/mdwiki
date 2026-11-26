/** Renderer tests: blocks, inline, wikilinks, XSS safety. */
import assert from 'node:assert/strict'
import { renderMd, extractWikilinks, slugify, normalizeName } from '../lib/md.js'

let n = 0
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); n++ }
  catch (e) { console.error(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1 }
}

test('headings h1–h6 with slug anchors', () => {
  const html = renderMd('# 大标题\n## Sub Title\n###### h6')
  assert.match(html, /<h1 id="大标题">大标题<\/h1>/)
  assert.match(html, /<h2 id="sub-title">Sub Title<\/h2>/)
  assert.match(html, /<h6 id="h6">h6<\/h6>/)
})

test('paragraphs, hr, flat lists (ul/ol)', () => {
  const html = renderMd('第一段\n\n- 甲\n- 乙\n\n1. one\n2. two\n\n---\n\n第二段')
  assert.match(html, /<p>第一段<\/p>/)
  assert.match(html, /<ul>\n<li>甲<\/li>\n<li>乙<\/li>\n<\/ul>/)
  assert.match(html, /<ol>\n<li>one<\/li>\n<li>two<\/li>\n<\/ol>/)
  assert.match(html, /<hr>/)
  assert.match(html, /<p>第二段<\/p>/)
})

test('blockquote, fenced code stays verbatim and unparsed', () => {
  const html = renderMd('> 引用一行\n> 第二行\n\n```js\n# 不是标题\n[[不是链接]]\n<script>x</script>\n```')
  assert.match(html, /<blockquote>\n<p>引用一行<\/p>\n<p>第二行<\/p>\n<\/blockquote>/)
  assert.match(html, /<pre><code class="lang-js">/)
  assert.match(html, /# 不是标题/)
  assert.ok(!/<a class="wl" href="\/wiki\/不是链接"/.test(html.split('<pre>')[1] ?? ''), '代码块内不解析 wikilink')
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/, '代码块内容转义')
})

test('inline: code, bold, italic, link, image', () => {
  const html = renderMd('**粗** *斜* `码` [站点](https://a.b/c) ![图](https://a.b/x.png)')
  assert.match(html, /<strong>粗<\/strong>/)
  assert.match(html, /<em>斜<\/em>/)
  assert.match(html, /<code>码<\/code>/)
  assert.match(html, /<a href="https:\/\/a.b\/c" rel="noopener">站点<\/a>/)
  assert.match(html, /<img src="https:\/\/a.b\/x.png" alt="图">/)
})

test('XSS: script tags and javascript: URLs are neutralized', () => {
  const html = renderMd('<script>alert(1)</script>\n\n[点我](javascript:alert(1))\n\n![x](javascript:alert(1))')
  assert.ok(!html.includes('<script>'), '脚本标签必须被转义')
  assert.match(html, /&lt;script&gt;/)
  assert.ok(!/href="javascript:/i.test(html), 'javascript: 链接不渲染')
  assert.ok(!/src="javascript:/i.test(html))
  // javascript: 链接退化为纯文本
  assert.match(html, /点我/)
})

test('wikilink href embeds the RESOLVED path; missing keeps raw target', () => {
  const html = renderMd('去 [[其它页]] 或 [[目标页|显示名]]', { resolve: (name) => normalizeName(name) === '其它页' ? '其它页.md' : null })
  assert.match(html, /<a class="wl" href="\/wiki\/%E5%85%B6%E5%AE%83%E9%A1%B5\.md" data-wiki="其它页">其它页<\/a>/)
  assert.match(html, /<a class="wl missing" href="\/wiki\/%E7%9B%AE%E6%A0%87%E9%A1%B5" data-wiki="目标页">显示名<\/a>/)
})

test('wikilink label syntax and escaping of page text', () => {
  const html = renderMd('[[A|<script>x</script>]]')
  assert.match(html, /data-wiki="A"/)
  assert.ok(!html.includes('<script>'))
})

test('extractWikilinks skips fenced code, supports labels', () => {
  const links = extractWikilinks('[[Home]]\n[[目标|显示]]\n```\n[[代码内]]\n```\n[[  带空格  ]]')
  assert.deepEqual(links, [
    { target: 'Home', text: 'Home' },
    { target: '目标', text: '显示' },
    { target: '带空格', text: '带空格' },
  ])
})

test('slugify and normalizeName behavior', () => {
  assert.equal(slugify('Hello World!'), 'hello-world')
  assert.equal(slugify('多 空格  标题'), '多-空格-标题')
  assert.equal(normalizeName('Page Name.md'), 'pagename')
  assert.equal(normalizeName('PAGE_NAME'), 'pagename')
  assert.equal(normalizeName('  home  '), 'home')
  assert.equal(normalizeName('示例-页'), '示例页')
})

test('empty input renders empty; unclosed fence still closes the code tag', () => {
  assert.equal(renderMd(''), '')
  const html = renderMd('```js\nlet x = 1')
  assert.match(html, /<pre><code class="lang-js">let x = 1<\/code><\/pre>/)
})

console.log(`\n${n} passed${process.exitCode ? ', some FAILED' : ', 0 failed'}`)
