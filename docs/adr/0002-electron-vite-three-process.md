# ADR-0002：Electron + electron-vite 三进程结构

- **状态**：已接受
- **日期**：2026-10-14

---

## 背景

要做桌面应用，核心是富文本编辑：contenteditable、拖拽、选区、粘贴图片、
自定义字体和滚动条。

需要跨平台（Windows + macOS），并且**离线可用**。

技术选型的候选：

| 方案 | 跨平台 | 离线 | 富文本能力 | 体积 |
| --- | --- | --- | --- | --- |
| Tauri | ✅ | ✅ | Web | 小 |
| Electron | ✅ | ✅ | Web | 大 |
| 原生（WinUI / SwiftUI） | ❌ 各写一遍 | ✅ | 差 | 小 |

---

## 决策

用 **Electron 39 + electron-vite**，严格遵循 Electron 的**三进程模型**：

```
main     （Node）    数据库、文件系统、AI 会话
preload  （桥）      contextBridge 白名单
renderer （Chromium）纯 React
```

配合以下安全配置：

```ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  sandbox: false,
  contextIsolation: true,
  nodeIntegration: false
}
```

以及 `protocol.registerSchemesAsPrivileged` 注册的 `nc-asset://` 自定义协议。

---

## 理由

### 为什么不用 Tauri

Tauri 更轻（安装包几十 MB vs 一两百 MB），但：

- 需要 Rust 工具链，**引入了一套新的构建链**。
- `node:sqlite` 用不了，得换 SQLite 绑定。
- 生态和调试工具不如 Electron 成熟。

对一个**本地优先的桌面应用**来说，Electron 的体积不是决定性因素
（用户装一次），而开发效率和生态更重要。

### 为什么 `sandbox: false`

沙箱会限制 preload 能用的 Node API。本应用的 preload 需要 `ipcRenderer` 和 `electron`
模块，而 `contextIsolation: true` + `nodeIntegration: false` 已经提供了真正的隔离：

- 渲染进程的 JS 上下文与 preload **不在同一个全局环境**。
- 渲染进程拿不到 `require`、拿不到 `fs`。
- 渲染进程能碰的唯一 Node 能力是 preload **显式暴露**的那三个对象。

`sandbox: false` 换来的能力是 preload 可以用 Node API，风险由 preload 代码本身承担
（它是项目自己的代码，且暴露面是手写白名单）。

### 为什么 `nodeIntegration: false` + `contextIsolation: true`

这是 Electron 官方的安全基线。渲染进程要处理用户输入的富文本，
是**不可信输入**的加工场，不应该有任何系统能力的默认访问权。

### 为什么用 electron-vite 而不是自己配 Vite

- 一个配置同时管三段构建（main / preload / renderer）。
- 内置 `externalizeDepsPlugin()`，自动把 `dependencies` 排除出打包。
- 开发模式自动处理 main / preload 的重启。

### 为什么主进程直接用 Node API 而不封装一层

主进程是可信代码。`fs`、`path` 这些 API 本身就很直观，
再包一层 `StorageService` 只会增加间接层，没有实际收益。

数据层的边界由**目录结构**保证：`src/main/` 之外的代码碰不到数据库。

### 为什么用 `node:sqlite` 而不是 better-sqlite3

见 [ADR-0001](0001-local-first-sqlite.md)。

### `nc-asset://` 协议而不是 `file://`

`file://` 在 Electron 渲染进程里受 `webSecurity` 限制，
且会把真实文件路径暴露给页面内容。用自定义协议可以：

- 只暴露 `assets/` 目录下的文件（用 `basename` 提取，天然防路径穿越）。
- 自己控制 `Content-Type`。
- 不暴露用户目录结构。

---

## 后果

### 正面

- 完整的 Web 技术栈：contenteditable、拖拽、粘贴、字体，全部现成。
- 离线完全可用。
- 打包和调试流程成熟。
- 渲染层是**纯 React**，没有 Electron 特有的心智负担。

### 负面

- **安装包体积大**（Electron 运行时占大头）。
- **内存占用高**（Chromium 多进程）。
- **主进程必须重启才能生效**的代码改动，开发体验略差。
- `sandbox: false` 意味着 preload 的安全性由代码质量保证，而非沙箱强制。

### 后续影响

- 主进程产物是 **CJS**，所以纯 ESM 的包（Pi SDK）必须用**动态 `import()`** 加载。
  见 `main/ai.ts` 的 `loadSdk()`。
- `node:sqlite` 必须在构建时 `external`，否则会被 Vite 尝试打包。
- 跨平台打包要用 electron-builder，且 Windows 和 macOS 的签名策略完全不同。
  见 [构建与发布](../development/build-and-release.md)。
- 如果未来体积成为问题，可以考虑换 Tauri，但**迁移成本极高**——
  这也是一个"选 Electron 就意味着长期锁定"的理由。

---

## 相关文档

- [架构总览](../architecture/overview.md)
- [IPC 桥接](../architecture/ipc-bridge.md)
- [资源管线](../architecture/assets.md)
