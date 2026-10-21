# Notion Clone Web

Electron 版 Notion Clone 的 Web 端，跑在 Cloudflare Workers 上。

技术栈：[TanStack Start](https://tanstack.com/start)（React 19 + Vite 8 + Tailwind CSS 4）、
[better-auth](https://www.better-auth.com)（邮箱密码登录）、[drizzle-orm](https://orm.drizzle.team) +
[Turso](https://turso.tech)（libsql 数据库）。

## 目录结构

```
web/
├── src/
│   ├── db/schema.ts        # drizzle 表定义（better-auth 四张表 + note）
│   ├── lib/db.ts           # Turso 连接（@libsql/client，进程内单例）
│   ├── lib/auth.ts         # better-auth 服务端实例（drizzle adapter）
│   ├── lib/auth-client.ts  # better-auth React 客户端
│   ├── server/             # 服务端函数（session / notes CRUD）
│   ├── routes/             # 文件路由：/ 、/login 、/signup 、/dashboard 、/api/auth/*
│   └── styles/app.css      # Tailwind 入口
├── drizzle/                # drizzle-kit 生成的 SQL 迁移
├── drizzle.config.ts
├── vite.config.ts          # tailwind + cloudflare + tanstackStart + react
├── wrangler.jsonc          # Cloudflare Workers 配置
└── .dev.vars.example       # 本地环境变量模板（复制为 .dev.vars）
```

注意：`web/` 是独立 npm 项目（不参与根目录 Electron 工程的 workspaces），
在 `web/` 目录内单独 `npm install`。

## 环境变量

| 变量 | 用途 | 本地 dev | 生产 |
| --- | --- | --- | --- |
| `TURSO_DATABASE_URL` | Turso 连接地址 | `.dev.vars` | `wrangler.jsonc` 的 `vars` |
| `TURSO_AUTH_TOKEN` | Turso 访问令牌 | `.dev.vars` | `wrangler secret put` |
| `BETTER_AUTH_SECRET` | better-auth 签名密钥 | `.dev.vars` | `wrangler secret put` |
| `BETTER_AUTH_URL` | 站点地址（可选，同域可省略） | `.dev.vars` | 通常可省略 |

本地开发：`cp .dev.vars.example .dev.vars` 后按需修改。

## 本地开发

```bash
cd web
npm install
cp .dev.vars.example .dev.vars
```

数据库二选一：

```bash
# 方式 A：本地 sqld（无需联网/账号）
turso dev                 # 默认监听 http://127.0.0.1:8080

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
# 设置密钥
wrangler secret put TURSO_AUTH_TOKEN
wrangler secret put BETTER_AUTH_SECRET

# 把 libsql://… 数据库地址填进 wrangler.jsonc 的 "vars"，然后：
npm run deploy
```

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
