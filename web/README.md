# Notion Clone Web

Electron 版 Notion Clone 的 Web 端，跑在 Cloudflare Workers 上。**前端组件完整复刻自桌面版**
（`packages/renderer`），数据层换成 TanStack Start server functions + Turso。

技术栈：[TanStack Start](https://tanstack.com/start)（React 19 + Vite 8 + Tailwind CSS 4）、
[better-auth](https://www.better-auth.com)（邮箱密码登录）、[drizzle-orm](https://orm.drizzle.team) +
[Turso](https://turso.tech)（libsql 数据库）、zustand + dnd-kit + Radix UI + shadcn 风格组件（与桌面版一致）。

## 目录结构

```
web/
├── src/
│   ├── db/schema.ts        # drizzle 表定义：better-auth 四张表 + page / block / asset
│   ├── lib/
│   │   ├── db.ts           # Turso 连接（@libsql/client，进程内单例）
│   │   ├── auth.ts         # better-auth 服务端实例（drizzle adapter）
│   │   ├── auth-client.ts  # better-auth React 客户端
│   │   ├── shared.ts       # 桌面版 @neonity/notion-clone-shared 契约的副本（类型 + 纯函数）
│   │   ├── api.ts          # NotionApi 契约的 Web 实现（每个方法对应一个 server fn）
│   │   ├── bridge.ts       # 把 api / settings / ai 注入 window.*（与 Electron preload 同构）
│   │   ├── settingsApi.ts  # SettingsApi 的 localStorage 实现
│   │   ├── aiApi.ts        # AiApi 占位实现（Web 版暂无 AI 后端）
│   │   ├── caret.ts / wikiLink.ts / blockTypes.tsx / utils.ts   # 桌面版渲染层工具的原样副本
│   │   ├── transcribe.ts / transcribeWorker.ts  # 音频语音识别（浏览器本地 Whisper，HuggingFace/镜像自动回退）
│   ├── store.ts            # 桌面版 zustand store 的原样副本（走 window.api）
│   ├── settingsStore.ts    # 桌面版设置 store 的原样副本（走 window.settings）
│   ├── server/
│   │   ├── queries.ts      # 纯服务端数据访问（drizzle），严禁被客户端 import
│   │   ├── pages.ts        # server fns：页面树 / 欢迎页种子 / 搜索 / wiki 双链
│   │   ├── blocks.ts       # server fns：块 CRUD / 重排
│   │   ├── assets.ts       # server fn：图片校验与上传
│   │   └── r2.ts           # Cloudflare R2 读写与公开 URL
│   ├── components/         # 桌面版组件复刻：Sidebar / Editor / BlockItem / TableBlock / …
│   │   ├── App.tsx         # 桌面版 App 去掉 AI 助手入口
│   │   └── ui/             # shadcn 风格基础组件（与桌面版一致）
│   ├── assets/             # 空白页背景图（与桌面版同源）
│   ├── routes/             # 文件路由：/ 、/login 、/signup 、/dashboard（工作区）、/api/*
│   └── styles/app.css      # Tailwind 4 主题（桌面版 index.css 的移植）+ 编辑器 CSS
├── drizzle/                # drizzle-kit 生成的 SQL 迁移
├── drizzle.config.ts
├── vite.config.ts          # tailwind + cloudflare + tanstackStart + react
├── wrangler.jsonc          # Cloudflare Workers 配置
└── .dev.vars.example       # 本地环境变量模板（复制为 .dev.vars）
```

注意：`web/` 是独立 npm 项目（不参与根目录 Electron 工程的 workspaces），
在 `web/` 目录内单独 `npm install`。

## 桌面版复刻方式

桌面版 UI 包通过 `window.api / window.settings / window.ai` 三个桥接面工作（Electron 由
preload 注入）。Web 端按同一契约实现这三个面（`lib/bridge.ts` 在进入工作区前注入）：

| 桥 | Web 实现 |
| --- | --- |
| `window.api`（NotionApi） | `lib/api.ts`：每个方法转发到 `server/` 里的 createServerFn（RPC fetch），全部按登录用户隔离 |
| `window.settings`（SettingsApi） | `lib/settingsApi.ts`：localStorage 持久化 + 内存广播 |
| `window.ai`（AiApi） | `lib/aiApi.ts`：占位实现，明确返回"未接入"；桌面版 AssistantPanel 未移植 |

因此 `store.ts`、`components/*` 与桌面版逐字一致（仅导入别名 `@/` → `~/`、共享包 → `lib/shared.ts`），
桌面版的组件修复原则上可以直接抄过来。例外：`SettingsPanel.tsx` 在桌面版分区之上新增了
Web 特有的「账号」分区（修改密码，走 better-auth `changePassword`）。

## 数据模型

`page` / `block` 复刻桌面版 SQLite 表结构（JSON content 单列、1024 间隔的小数 position、
wiki 链接改写传播、欢迎页种子），并增加 `user_id` 外键做每用户隔离；`block.user_id`
冗余一列，让搜索和反链扫描不必 join 判权属。新上传的图片写入 Cloudflare R2，`asset`
表只保存对象 key 与权属信息；旧版 base64 图片继续兼容读取。未配置公开域名时经
`/api/asset/$id` 登录态路由回源，配置 `R2_PUBLIC_URL` 后直接保存图床 URL。单图上限 10MB。

首次进入工作区时按用户种出「欢迎使用 Notion Clone」示例页（与桌面版首启一致）。

## 环境变量

| 变量 | 用途 | 本地 dev | 生产 |
| --- | --- | --- | --- |
| `TURSO_DATABASE_URL` | Turso 连接地址 | `.dev.vars` | `wrangler.jsonc` 的 `vars` |
| `TURSO_AUTH_TOKEN` | Turso 访问令牌 | `.dev.vars` | `wrangler secret put` |
| `BETTER_AUTH_SECRET` | better-auth 签名密钥 | `.dev.vars` | `wrangler secret put` |
| `BETTER_AUTH_URL` | 站点地址（可选，同域可省略） | `.dev.vars` | 通常可省略 |
| `R2_PUBLIC_URL` | R2 自定义域名或开发用 `r2.dev` 地址（可选） | `.dev.vars` | `wrangler.jsonc` 的 `vars` |

本地开发：`cp .dev.vars.example .dev.vars` 后按需修改。

## 本地开发

```bash
cd web
npm install
cp .dev.vars.example .dev.vars
```

数据库二选一：

```bash
# 方式 A：本地 sqld（无需联网/账号）；.dev.vars 默认指向 127.0.0.1:8081
turso dev --port 8081 --db-file dev-local.db   # --db-file 让数据在重启后保留

# 方式 B：真实 Turso 数据库
turso db create notion-clone-web
turso db show notion-clone-web --url
turso db tokens create notion-clone-web
# 把 url / token 写进 .dev.vars
```

建表（把 SQL 迁移推到上面的数据库）：

```bash
set -a; source .dev.vars; set +a   # 让 drizzle-kit 读到 TURSO_DATABASE_URL
npm run db:push                    # 或 npm run db:generate 后手工执行 drizzle/*.sql
```

启动：

```bash
npm run dev       # http://localhost:3000
```

## 部署到 Cloudflare

```bash
wrangler login
# 创建与 wrangler.jsonc 对应的私有存储桶（只需一次）
wrangler r2 bucket create notion-clone-images
# 设置密钥
wrangler secret put TURSO_AUTH_TOKEN
wrangler secret put BETTER_AUTH_SECRET

# 把 libsql://… 数据库地址填进 wrangler.jsonc 的 "vars"，然后：
npm run deploy
```

默认通过 Worker 的 `NOTE_IMAGES` binding 读写私有 R2。若需要可公开引用的图床 URL，
请在 R2 设置中绑定自定义域名（生产推荐）或启用 `r2.dev`（仅开发），再把该地址写入
`R2_PUBLIC_URL`；R2 bucket 本身无需向客户端暴露访问密钥。

首次部署后 workers.dev 域名可直接访问；绑定自定义域名时在 Cloudflare 控制台或
`wrangler.jsonc` 的 `routes` 中配置。

## 常用脚本

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 开发（Vite + workerd） |
| `npm run build` | 构建 + tsc 类型检查 |
| `npm run preview` | 本地预览构建产物 |
| `npm run deploy` | 构建 + `wrangler deploy` |
| `npm run db:generate` | 由 schema 生成 SQL 迁移 |
| `npm run db:push` | 把 schema 推送到数据库 |
| `npm run cf-typegen` | 生成 worker-configuration.d.ts |
