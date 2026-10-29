# NeoNote

**[中文](#中文) · [English](#english)**

> 本地优先的块笔记应用 —— 数据首先保存在本机（桌面版 SQLite / Web 版 IndexedDB），桌面版完全离线可用，Web 版提供离线优先的多端同步。
> A local-first, block-based notes app — data lives on your machine first (SQLite on desktop, IndexedDB on the web), with an offline-first sync engine for multi-device use on the web.

桌面版（Electron + Vite + React + shadcn/ui + SQLite）与 Web 版（TanStack Start + Cloudflare Workers）
同源界面：块编辑器、页面树、拖拽排序、全文搜索、表格、数据库、图片、音频转写、双链、
日记模式，以及桌面版上能直接读写笔记的 AI 助手。

📖 **完整文档见 [`docs/`](docs/README.md) / Full documentation lives in [`docs/`](docs/README.md)**

---

## 中文

### 快速开始

```bash
npm install
npm run dev
```

首次启动会自动创建一个「欢迎使用 NeoNote」示例页面。

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式（热更新） |
| `npm run build` | 构建产物到 `out/` |
| `npm start` | 预览构建产物 |
| `npm run typecheck` | 四处 tsc 类型检查（根 + shared + renderer + web） |
| `npm run lint` | ESLint 检查（`npm run lint:fix` 自动修） |
| `npm run verify` | 类型检查 + Lint + 文档校验，CI 跑的就是这一套 |
| `npm run dist` | 打包 Windows 安装包（NSIS / x64） |
| `npm run dist:mac` | 打包 macOS DMG（arm64 / Apple Silicon） |
| `npm run docs:check` | 校验文档内部链接与锚点 |

环境要求：Node.js 20+、npm 10+。**不需要**单独安装 SQLite —— 应用使用 Electron 内置的
`node:sqlite`，由 Electron 39 自带的 Node 22 运行时提供。

### 功能

- **块编辑器** —— 14 种块类型，斜杠命令菜单，Markdown 快捷输入（`# `、`- `、`[] `…）
- **双链** —— 正文写 `[[页面标题]]` 即可互链，页面底部列出「谁引用了我」，改名自动同步链接（旧标题唯一时）
- **页面树** —— 无限层级，拖拽同时支持排序和改变父子关系
- **表格** —— 纯文本行列数据，键盘导航，可被搜索和 AI 读取
- **数据库** —— 属性 + 记录，表格或画廊视图，支持搜索与排序，可被搜索和 AI 读取
- **图片** —— 任意文本块 `Ctrl+V` 直接粘贴；可选同步到 Cloudflare R2 图床
- **音频与转写** —— 音频块附本地转写，支持一键复制与折叠
- **全文搜索** —— 同时匹配页面标题与块正文
- **日记模式**（Web 版）—— 月历导航，每天一篇确定性页面；双链创建的笔记自动归属当天日记并可从回链返回
- **多端同步**（Web 版）—— 离线优先：本地 IndexedDB 为第一数据源，后台引擎按行级 LWW 与墓碑删除双向同步
- **AI 助手** —— 复用本机 `~/.pi/agent` 的模型配置，能直接读写笔记
- **主题与外观** —— 浅色 / 深色 / 跟随系统，字号与内容宽度可调

### 技术栈

| 层 | 技术 |
| --- | --- |
| 主进程 | Electron 39、Node 内置 `node:sqlite` |
| 预加载 | `contextBridge` 白名单桥接 |
| 渲染进程 | React 18、TypeScript、Tailwind CSS、zustand、dnd-kit、Radix UI |
| AI | `@earendil-works/pi-coding-agent`（Pi SDK） |

### 架构速览

三层，职责严格分离：

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 主进程 | `src/main/` | 全部 SQLite 读写、图片资源、设置、AI 会话 —— 唯一的数据出口 |
| 预加载 | `src/preload/` | `contextBridge` 白名单，只暴露 `window.api` / `window.ai` / `window.settings` |
| 渲染进程 | `packages/renderer/` | 纯 React：块编辑、页面树、面板。不碰文件系统，不直接 import `node:` 模块 |

IPC 契约集中在共享包 `@neonity/neonote-shared`，主进程与渲染进程引用同一份类型。

数据流：渲染进程的改动 → `window.api` → 预加载转发 → 主进程落库；主进程再把事件
（AI 流式输出、设置变更、笔记被 AI 改写）推回渲染进程。

### 目录结构

```
.
├── src/                        Electron 宿主
│   ├── main/                   主进程：db / assets / settings / ai
│   └── preload/                contextBridge 白名单
├── packages/
│   ├── shared/                 @neonity/neonote-shared（IPC 契约层）
│   └── renderer/               @neonity/neonote-ui（前端包，可独立 npm 发布）
├── web/                        Web 版（TanStack Start + Cloudflare Workers）
├── build/                      electron-builder 资源（macOS entitlements）
├── scripts/                    签名钩子、文档校验
├── docs/                       完整文档
└── electron.vite.config.ts
```

### Web 版（`web/`）

与桌面版同源的 React 界面，运行在 TanStack Start + Cloudflare Workers 上：

- **认证与存储** —— better-auth 登录，Turso（libSQL）云端行存储，drizzle ORM
- **离线优先同步** —— IndexedDB 本地库是唯一读写面，写穿本地后由后台同步引擎
  推送/拉取；行级 LWW 裁决、墓碑传导删除、断网可继续写作
- **日记模式（Daily Note）** —— 参照 Capacities 的交互：月历导航、日期标题、
  每天一篇确定性页面（`daily-YYYY-MM-DD`），从日记里双链创建的笔记自动归属
  当天并可从回链返回
- **启动** —— `cd web && ./dev.sh`（本地 sqld + vite，<http://localhost:3000>）；
  部署用 `npm run deploy`（wrangler）

### 数据存放位置

```
<userData>/neonote/
├── neonote.db           # 页面、块、设置
├── neonote.db-wal       # WAL 日志
├── neonote.db-shm       # WAL 共享内存
└── assets/              # 图片资源，文件名 = UUID + 扩展名
```

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\neonote` |
| macOS | `~/Library/Application Support/neonote` |
| Linux | `~/.config/neonote` |

从旧版本（`notion-clone`）升级时，应用会在启动时自动把整个旧数据目录迁移到新位置
（含数据库与 WAL 文件），无需手动操作。

备份 = 复制整个目录（稳妥起见先退出应用，让 WAL 落盘）。

桌面版默认继续使用本地图片目录。若要把新图片同步到 Cloudflare R2，请在启动主进程前
设置 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET` 和
`R2_PUBLIC_URL`。`R2_PUBLIC_URL` 应为该 bucket 绑定的生产自定义域名；所有凭据仅由
Electron 主进程读取，不会暴露给渲染进程。

### 文档

| 入口 | 内容 |
| --- | --- |
| [文档总览](docs/README.md) | 全站导航 |
| [快速开始](docs/getting-started/index.md) | 安装、运行、打包 |
| [功能巡览](docs/getting-started/quick-tour.md) | 5 分钟走一遍 |
| [用户指南](docs/user-guide/editor.md) | 编辑器、页面、搜索、表格、双链、AI、快捷键 |
| [双链（Wiki Link）](docs/user-guide/links.md) | `[[页面]]` 语法与反向链接 |
| [快捷键速查](docs/user-guide/shortcuts.md) | 全部键盘操作一览 |
| [架构总览](docs/architecture/overview.md) | 进程模型、数据流、分层 |
| [数据模型](docs/architecture/data-model.md) | SQLite 表结构与位置策略 |
| [AI 集成](docs/ai/integration.md) | 会话生命周期、模型解析、设置联动 |
| [开发环境](docs/development/setup.md) | 目录结构、调试、扩展指引 |
| [ADR 索引](docs/adr/README.md) | 架构决策记录 |

### 开发约定

- 代码风格：2 空格缩进、无分号、单引号、尾随逗号（多行）
- 提交前跑 `npm run verify`（类型检查 + Lint + 文档校验）
- 改渲染层热更新；改主进程或 preload 需重启 `npm run dev`
- 代码注释统一使用英文，文档统一使用简体中文

### 许可

私有项目，版权归作者所有。

---

## English

### Quick start

```bash
npm install
npm run dev
```

On first launch the app seeds a welcome page titled **「欢迎使用 NeoNote」** (👋) that
demonstrates the block types in action.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development mode with hot reload |
| `npm run build` | Build the app into `out/` |
| `npm start` | Preview the built app |
| `npm run typecheck` | Run `tsc` across the root project, both packages and the web app |
| `npm run lint` | Run ESLint (`npm run lint:fix` to auto-fix) |
| `npm run verify` | Typecheck + lint + docs validation — the same gate CI runs |
| `npm run dist` | Package a Windows installer (NSIS / x64) |
| `npm run dist:mac` | Package a macOS DMG (arm64 / Apple Silicon) |
| `npm run docs:check` | Validate internal documentation links and anchors |

Requirements: Node.js 20+ and npm 10+. You do **not** need to install SQLite — the app uses the
built-in `node:sqlite` module provided by the Node 22 runtime bundled with Electron 39.

### Features

- **Block editor** — 13 block types, a slash command menu, and Markdown shortcuts (`# `, `- `, `[] `, …)
- **Wiki links** — write `[[Page title]]` to link pages; each page lists what references it, and renaming a page rewrites the links automatically, as long as the old title is unique
- **Page tree** — unlimited nesting; dragging reorders siblings and re-parents pages at the same time
- **Tables** — plain-text cells with full keyboard navigation, readable by search and by the AI
- **Databases** — properties and records in a table or gallery view, searchable and sortable, readable by search and by the AI
- **Images** — stored locally; paste straight from the clipboard with `Ctrl+V` in any text block
- **Audio & transcription** — audio blocks with local transcription, one-click copy and collapsible transcript
- **Full-text search** — matches page titles and block bodies
- **Daily notes** (web) — calendar navigation, one deterministic page per day; notes created via wiki links belong to that day and link back to it
- **Multi-device sync** (web) — offline-first: IndexedDB is the local source of truth, with a background engine syncing via row-level LWW and tombstones
- **AI assistant** — reuses the model configuration in your local `~/.pi/agent` and can read and write your notes
- **Theme and appearance** — light / dark / follow system, with adjustable font size and content width

### Tech stack

| Layer | Technology |
| --- | --- |
| Main process | Electron 39, Node's built-in `node:sqlite` |
| Preload | `contextBridge` allowlist bridge |
| Renderer | React 18, TypeScript, Tailwind CSS, zustand, dnd-kit, Radix UI |
| AI | `@earendil-works/pi-coding-agent` (Pi SDK) |

### Architecture at a glance

Three layers with strictly separated responsibilities:

| Layer | Location | Responsibility |
| --- | --- | --- |
| Main process | `src/main/` | All SQLite access, image assets, settings, AI sessions — the only exit to the database |
| Preload | `src/preload/` | A `contextBridge` allowlist exposing exactly `window.api`, `window.ai` and `window.settings` |
| Renderer | `packages/renderer/` | Pure React: block editing, page tree, panels. No filesystem access, no direct `node:` imports |

The IPC contract lives in the shared package `@neonity/neonote-shared`, so the main process
and the renderer always speak the same types.

Data flow: a renderer change goes through `window.api`, is forwarded by the preload script, and is
persisted by the main process; the main process then pushes events back (AI stream output, settings
changes, notes rewritten by the AI).

### Project layout

```
.
├── src/                        Electron host
│   ├── main/                   Main process: db / assets / settings / ai
│   └── preload/                contextBridge allowlist
├── packages/
│   ├── shared/                 @neonity/neonote-shared (the IPC contract)
│   └── renderer/               @neonity/neonote-ui (publishable UI package)
├── web/                        Web app (TanStack Start + Cloudflare Workers)
├── build/                      electron-builder resources (macOS entitlements)
├── scripts/                    Signing hook, docs validation
├── docs/                       Full documentation
└── electron.vite.config.ts
```

### Web app (`web/`)

The same React UI running on TanStack Start + Cloudflare Workers:

- **Auth & storage** — better-auth sign-in, Turso (libSQL) row storage, drizzle ORM
- **Offline-first sync** — the IndexedDB local store is the only read/write surface;
  a background engine pushes and pulls with row-level LWW resolution and tombstone deletions,
  so you can keep writing offline
- **Daily notes** — Capacities-style interactions: calendar navigation, date heading, one
  deterministic page per day (`daily-YYYY-MM-DD`); wiki-linked notes created from a daily
  note belong to that day and link back to it
- **Run it** — `cd web && ./dev.sh` (local sqld + vite at <http://localhost:3000>);
  deploy with `npm run deploy` (wrangler)

### Where your data lives

```
<userData>/neonote/
├── neonote.db           # Pages, blocks and settings
├── neonote.db-wal       # WAL journal
├── neonote.db-shm       # WAL shared memory
└── assets/              # Images, named UUID + extension
```

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\neonote` |
| macOS | `~/Library/Application Support/neonote` |
| Linux | `~/.config/neonote` |

Upgrading from the old `notion-clone` identity? The app migrates the whole legacy data
directory (db and WAL files included) to the new location automatically on startup.

Backing up means copying the whole directory — quit the app first so the WAL is flushed.

### Documentation

| Entry point | Contents |
| --- | --- |
| [Documentation index](docs/README.md) | Navigation for the whole site |
| [Getting started](docs/getting-started/index.md) | Install, run, package |
| [Quick tour](docs/getting-started/quick-tour.md) | A five-minute walkthrough |
| [User guide](docs/user-guide/editor.md) | Editor, pages, search, tables, links, AI, shortcuts |
| [Wiki links](docs/user-guide/links.md) | The `[[page]]` syntax and backlinks |
| [Keyboard shortcuts](docs/user-guide/shortcuts.md) | Every keyboard action in one page |
| [Architecture overview](docs/architecture/overview.md) | Process model, data flow, layering |
| [Data model](docs/architecture/data-model.md) | SQLite schema and the ordering strategy |
| [AI integration](docs/ai/integration.md) | Session lifecycle, model resolution, settings coupling |
| [Development setup](docs/development/setup.md) | Project layout, debugging, extension guide |
| [ADR index](docs/adr/README.md) | Architecture decision records |

### Development conventions

- Code style: 2-space indent, no semicolons, single quotes, trailing commas on multiline
- Run `npm run verify` (typecheck + lint + docs validation) before committing
- Renderer changes hot-reload; main-process and preload changes need `npm run dev` restarted
- Code comments are written in English; the documentation is written in Simplified Chinese

### License

Private project. All rights reserved by the author.
