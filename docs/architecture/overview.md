# 架构总览

## 一句话概括

一个**本地优先**的 Electron 应用：主进程独占 SQLite，渲染进程通过 preload 白名单桥接读写，
所有数据留在本机磁盘。

---

## 进程模型

```
┌──────────────────────────────────────────────────────────────┐
│ 主进程 (Node)  src/main/                                     │
│                                                              │
│  index.ts ──── 窗口创建、协议注册、IPC 路由                   │
│  db.ts ──────── 全部 SQLite 读写（唯一数据出口）              │
│  assets.ts ──── 图片存取、GC、nc-asset:// 协议实现              │
│  settings.ts ── 设置校验、落库、广播                           │
│  ai.ts ──────── Pi agent 会话、notes_* 工具、流式事件          │
└───────────────┬──────────────────────────────┬───────────────┘
                │ IPC (invoke / send)          │ 自定义协议
┌───────────────▼──────────────┐   ┌───────────▼──────────────┐
│ 预加载 (Context Bridge)      │   │ 渲染进程 (Chromium)      │
│ src/preload/index.ts         │   │ packages/renderer/src/        │
│                              │   │                          │
│ contextBridge.exposeInMain   │   │  App.tsx                 │
│ World('api' | 'ai' |         │──▶│   ├── Sidebar            │
│          'settings')         │   │   ├── Editor             │
│                              │   │   │    ├── BlockItem       │
│ 无 Node API 暴露             │   │   │    ├── TableBlock      │
│ contextIsolation: true       │   │   │    └── ImageBlock      │
│ nodeIntegration: false       │   │   ├── AssistantPanel     │
└──────────────────────────────┘   │   └── SettingsPanel      │
                                   │                          │
                                   │  store.ts / settingsStore│
                                   │  (zustand)               │
                                   └──────────────────────────┘
```

### 安全配置

`src/main/index.ts:34`：

| 项 | 值 | 含义 |
| --- | --- | --- |
| `contextIsolation` | `true` | 渲染进程的 JS 上下文与 preload 隔离 |
| `nodeIntegration` | `false` | 渲染进程**没有** Node 能力 |
| `sandbox` | `false` | 允许 preload 使用 Node API（`electron` 模块） |
| `webSecurity` | 默认开启 | 同源策略生效 |

渲染进程能碰到的 Node 能力**只有 preload 显式暴露的那三个对象**：
`window.api`、`window.ai`、`window.settings`。

---

## 目录结构

```
src/                       Electron 宿主
├── main/            主进程：Node 环境，碰数据库和文件系统
│   ├── index.ts     入口：窗口、协议、IPC 路由
│   ├── db.ts        SQLite 数据访问层
│   ├── assets.ts    图片资源
│   ├── settings.ts  设置服务
│   └── ai.ts        AI 会话与工具
└── preload/         唯一的进程间桥梁
    └── index.ts     contextBridge 暴露 api / ai / settings

packages/
├── shared/          @neonity/notion-clone-shared：主进程与渲染进程**共享**的类型与常量
│   └── src/index.ts 全部类型定义、默认设置、表格工具函数
└── renderer/src/    @neonity/notion-clone-ui：渲染进程（纯 React）
    ├── App.tsx      应用外壳、主题分发
    ├── store.ts     笔记状态（zustand）
    ├── settingsStore.ts  设置状态（zustand）
    ├── lib/
    │   ├── blockTypes.tsx  块类型元数据与过滤
    │   ├── caret.ts        光标定位与焦点注册
    │   └── utils.ts        cn() 等工具
    └── components/  UI 组件
```

**分层规则**：

- shared 包（`@neonity/notion-clone-shared`）不依赖任何一方，可被主进程和渲染进程同时 import。
- 渲染进程**永远不直接访问**数据库或文件系统，只走 `window.api`。
- 主进程**不持有 UI 状态**，只做数据与业务。

---

## 一次典型的数据流

以"用户在正文块里打字"为例：

```
用户按键
  │
  ▼
BlockItem.onInput
  │  读 textContent，检测 Markdown 前缀
  ▼
store.updateBlockLocal(id, content)     ← 立即更新前端 state（乐观更新）
  │
  ▼
store.scheduleSave(id)                  ← 400ms 防抖
  │  （同块再次编辑会取消上一次的定时器）
  ▼
window.api.updateBlock({id, type, content})
  │  preload → ipcRenderer.invoke('blocks:update')
  ▼
主进程 ipcMain.handle('blocks:update')
  │
  ▼
db.updateBlock(input)
  │  UPDATE blocks SET content = ?, updated_at = ? WHERE id = ?
  │  同时 touchPage(pageId, ts)
  ▼
SQLite（磁盘）
```

**读取方向**（切页面）：

```
store.selectPage(id)
  │  先 flushSaves() —— 把未落库的编辑强制写回
  ▼
window.api.listBlocks(id) → ipc → db.listBlocks(id)
  ▼
SELECT * FROM blocks WHERE page_id = ? ORDER BY position
  ▼
前端 set({ blocks, blocksLoading: false })
```

---

## 渲染进程的状态

两个独立的 zustand store：

| Store | 职责 | 文件 |
| --- | --- | --- |
| `useStore` | 页面列表、当前页面、块列表、块编辑操作 | `packages/renderer/src/store.ts` |
| `useSettings` | 应用设置 | `packages/renderer/src/settingsStore.ts` |

渲染进程**不缓存**从数据库读到的完整页面树之外的东西。`listPages` 返回全量页面列表，
前端自己用 `parentId` 拼树（`buildTree`）。

详见 [状态管理](state-management.md)。

---

## 启动流程

```
app.whenReady()
  ├─ db.initDb()                    打开/创建数据库，建表，WAL 模式
  │   └─ seedIfEmpty()              空库时写入欢迎页与示例块
  ├─ gcAssets(db.listImageAssetIds())  清理没有被引用的图片文件
  ├─ registerAssetProtocol()        注册 nc-asset:// 协议
  ├─ registerIpc()                  注册所有 IPC 通道
  ├─ registerSettings()             注册设置通道
  ├─ createWindow()                 创建窗口
  └─ registerAi(win)                挂载 AI 会话与事件转发
```

数据库初始化用的是 `CREATE TABLE IF NOT EXISTS`，**没有迁移机制**。
新增字段需要手写 `ALTER TABLE` 或删库重建——见 [数据模型](data-model.md#演进与迁移)。

---

## 构建与产线

`electron-vite` 负责构建三段产物：

| 段 | 产物 | 格式 |
| --- | --- | --- |
| main | `out/main/index.js` | CJS |
| preload | `out/preload/index.js` | CJS |
| renderer | `out/renderer/` | 静态资源 |

外部化策略：

- `externalizeDepsPlugin()` —— `dependencies` 里的包不打包，运行时从 `node_modules` 加载。
- `node:sqlite` 显式 `external` —— 它是 Node 内置模块，由 Electron 的 Node 运行时提供。

> Pi SDK 是**纯 ESM**，而主进程产物是 CJS，所以 `ai.ts` 用**动态 `import()`** 加载 SDK
> （`loadSdk()`，`src/main/ai.ts:78`）。

打包成安装包由 electron-builder 负责，详见 [构建与发布](../development/build-and-release.md)。

---

## 主题与外观分发

外观设置有三条分发路径：

1. **深色模式**：主进程在 `resolvedTheme()` 里算出当前主题 → 用作窗口底色（避免闪白）；
   渲染进程在 `<html>` 上切换 `dark` class。
2. **字号与宽度**：渲染进程读设置 → 写根节点 CSS 变量 `--editor-font-size` / `--editor-max-width`
   → 样式表消费。
3. **设置变更广播**：主进程 `broadcast()` → 所有窗口的 `settings:changed` → 渲染进程 `useSettings.setState`。

详见 [样式与主题](../development/styling.md)。

---

## 相关文档

- [数据模型](data-model.md) —— 表结构与位置策略
- [IPC 桥接](ipc-bridge.md) —— 进程间通信设计
- [状态管理](state-management.md) —— 前端状态与落库时序
- [资源管线](assets.md) —— 图片的完整生命周期
- [Pi SDK 集成](../ai/integration.md) —— AI 会话的生命周期
- [文件地图](../reference/file-map.md) —— 每个文件负责什么
