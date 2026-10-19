# 开发环境

本文档面向**要改这个项目代码**的人。

---

## 环境准备

| 项目 | 要求 |
| --- | --- |
| Node.js | 20+ |
| npm | 10+ |

```bash
npm install
```

国内网络下 `.npmrc` 已配置镜像，无需额外设置。

---

## 脚本

| 命令 | 作用 | 产物 |
| --- | --- | --- |
| `npm run dev` | 开发模式（Vite 热更新 + Electron） | — |
| `npm run build` | 构建三段产物 | `out/` |
| `npm start` | 预览已构建的产物 | — |
| `npm run dist` | 打包 Windows 安装包 | `dist/` |
| `npm run dist:dir` | 打包 Windows 免安装目录 | `dist/` |
| `npm run dist:mac` | 打包 macOS DMG | `dist/` |
| `npm run dist:mac:dir` | 打包 macOS .app 目录 | `dist/` |
| `npm run docs:check` | 校验文档内部链接与锚点 | — |

> `dist` / `out` / `node_modules` / `.workbuddy` 都在 `.gitignore` 里，不会被提交。

---

## 目录结构

```
.
├── src/
│   ├── main/              主进程（Node 环境）
│   │   ├── index.ts       入口：窗口、协议、IPC 路由
│   │   ├── db.ts          SQLite 数据访问层
│   │   ├── assets.ts      图片资源 + nc-asset:// 协议
│   │   ├── settings.ts    设置服务
│   │   └── ai.ts          AI 会话与工具
│   ├── preload/
│   │   └── index.ts       contextBridge 暴露 api / ai / settings
│   ├── shared/
│   │   └── types.ts       共享类型、常量、表格工具函数
│   └── renderer/src/      渲染进程（纯 React）
│       ├── main.tsx       入口
│       ├── App.tsx        外壳
│       ├── store.ts       笔记状态
│       ├── settingsStore.ts 设置状态
│       ├── lib/           纯工具函数
│       │   ├── blockTypes.tsx
│       │   ├── caret.ts
│       │   └── utils.ts
│       └── components/
│           ├── Sidebar.tsx       页面树
│           ├── Editor.tsx        编辑器
│           ├── BlockItem.tsx     块渲染与键盘
│           ├── TableBlock.tsx    表格
│           ├── ImageBlock.tsx    图片
│           ├── SlashMenu.tsx     斜杠菜单
│           ├── EmojiPicker.tsx   表情选择
│           ├── AssistantPanel.tsx AI 面板
│           ├── SettingsPanel.tsx 设置面板
│           └── ui/               shadcn/ui 基础组件
├── build/                 electron-builder 资源（macOS entitlements）
├── scripts/
│   ├── sign-mac.js        electron-builder afterPack 钩子
│   └── check-docs.mjs     文档链接校验
├── docs/                  本文档目录
└── electron.vite.config.ts
```

各文件的职责详见 [文件地图](../reference/file-map.md)。

---

## 路径别名

渲染进程可以用 `@/` 指向 `src/renderer/src`：

```ts
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
```

定义在两处，**都要改**：

- `electron.vite.config.ts` —— Vite 解析
- `tsconfig.json` —— TypeScript 类型解析

> `src/shared/` **没有**别名，用相对路径 import（如 `../../shared/types`）。
> 因为主进程和 preload 不在 `@/` 的作用域内。

---

## 架构约束

改动前先确认自己在正确的层：

| 想做的事 | 改哪里 |
| --- | --- |
| 加一个块类型 | `shared/types.ts` 的 `BlockType` + `renderer/lib/blockTypes.tsx` 的元数据 + `BlockItem.tsx` 的渲染分支 + `main/ai.ts` 的工具 schema |
| 加一个数据库字段 | 优先扩展 `content` 的 JSON 形状（见 [数据模型](../architecture/data-model.md#演进与迁移)） |
| 加一个 IPC 能力 | `shared/types.ts` → `main/index.ts` → `preload/index.ts`（三处，顺序不能少） |
| 加一个设置项 | `shared/types.ts` 的 `AppSettings` + `main/settings.ts` 的 `sanitize()` + `SettingsPanel.tsx` |
| 改主题色 | `renderer/src/index.css` 的 CSS 变量 |
| 改 AI 能力 | `main/ai.ts` 的 `buildNotesTools()` + 系统提示词 |

**渲染进程不允许**直接 import `node:` 模块或访问文件系统。
所有这类需求都要走 `window.api` / `window.ai` / `window.settings`。

---

## 调试

### 开发者工具

`Cmd/Ctrl + I` 打开渲染进程 DevTools。控制台、Network、Sources 都可用。

主进程的日志会输出到启动 `npm run dev` 的终端。

### 常用排查手段

**看数据库里到底存了什么**

```bash
sqlite3 "$(node -e "console.log(require('electron').app.getPath('userData'))")/notion-clone.db"
```

或者直接用任意 SQLite 工具打开 `<userData>/notion-clone.db`。

> 数据库跑在 WAL 模式，外部工具读取时如果看到 `-wal` 文件是正常的。

**看 AI 事件流**

主进程 `console.log` 出来的 `[ai]` 开头的日志。孤儿锁清理成功会打印：

```
[ai] 已清理残留的 auth.json.lock 孤儿锁(上次异常退出留下的)
```

### 改主进程要重启

`electron-vite dev` 会自动重启主进程。渲染进程是热更新。

### 改 `shared/types.ts` 要重启

类型改了之后，preload 和主进程都需要重新构建。

---

## 类型检查

```bash
npx tsc --noEmit
```

项目**没有**配置 ESLint / Prettier，代码风格靠人工保持一致：

- 2 空格缩进
- 无分号
- 单引号
- 尾随逗号（多行）

---

## 添加依赖

```bash
npm install <pkg>
```

`dependencies` 里的包会被 `externalizeDepsPlugin()` **排除在打包之外**，
运行时从 `node_modules` 加载。`devDependencies` 只在构建时用。

> 纯 ESM 的包在主进程里要用动态 `import()` 加载，
> 因为主进程产物是 CJS。见 `main/ai.ts` 的 `loadSdk()`。

---

## 相关文档

- [样式与主题](styling.md) —— CSS 变量与 Tailwind 配置
- [构建与发布](build-and-release.md) —— 打包与签名
- [贡献指南](contributing.md) —— 提交规范与文档维护
- [架构总览](../architecture/overview.md) —— 分层与数据流
