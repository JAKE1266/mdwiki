# mdwiki

零依赖**本地 Markdown Wiki**:把一个装满 `.md` 文件的目录变成带 `[[wikilink]]` 双链、反向链接与全文搜索的个人知识库。纯 Node.js(≥18),无任何第三方依赖,渲染器自带 XSS 防护。

## 快速开始

```bash
npm test                       # 32 项断言(渲染器/索引/HTTP E2E)
node server.js                 # → http://127.0.0.1:8797(默认 ./notes 目录,自动播种示例)
node server.js D:/我的笔记      # 指定 wiki 目录
WIKI_ROOT=/path WIKI_PORT=9000 node server.js
```

## Wiki 语法

- 页面 = wiki 目录下的 `.md` 文件(支持子目录)
- `[[页面名]]` 或 `[[页面名|显示文本]]` 建立链接;匹配忽略大小写、空格/下划线/连字符与 `.md` 后缀
- 不存在的链接显示为红色虚线;每页底部列出**反向链接**(谁链接到这里)
- 标准 Markdown:标题/列表/引用/代码块/行内代码/粗斜体/链接/图片/分隔线

## 安全模型

渲染器先把**整个输入 HTML 转义**,再在转义文本上做白名单变换——页面里的 `<script>`、`javascript:` 链接一律失效;链接 URL 仅允许 `http(s):`、`mailto:`、`/`、`#` 与相对路径。读取路径强制约束在 wiki 目录内(`../` 逃逸拒绝)。

## API

```
GET /api/pages            页面列表(递归,含子目录,隐藏目录跳过)
GET /api/page/<path>      { ok, path, raw, html, backlinks: [{ source, text }] }
GET /api/search?q=&limit= 全文搜索(大小写不敏感,按命中数排序,每页最多 10 行)
GET /                     仪表盘(hash 路由:#/page/<path>,#/search/<q>)
```

## 文件结构

```
mdwiki/
├── server.js             # CLI 启动 + API(缺失目录自动播种示例页)
├── public/index.html     # 仪表盘(单文件,无构建)
├── lib/
│   ├── md.js             # 最小 Markdown 渲染器 + wikilink 提取 + slug
│   └── wiki.js           # WikiIndex:列表/安全读取/解析/反链/搜索/播种
└── test/                 # md(10) + wiki(9) + server E2E(9) + 语法(4) = 32 项
```

## 渲染器范围(刻意最小)

支持:标题(h1–h6 带锚点)、段落、扁平列表(ul/ol)、引用、围栏代码块(原样转义)、行内代码/粗体/斜体、链接/图片(URL scheme 白名单)、`[[wikilink]]`、分隔线。不支持表格与嵌套列表——按需再加。

## License

MIT
