# IPC 桥接

渲染进程**不能**直接碰数据库和文件系统。所有跨进程操作都必须经过 preload 暴露的三个对象。

---

## 桥接设计

```
渲染进程                        preload                       主进程
   │                              │                             │
   │ window.api.listBlocks(id)    │                             │
   ├─────────────────────────────▶│ ipcRenderer.invoke         │
   │                              │   ('blocks:list', id) ─────▶│
   │                              │                             │ db.listBlocks(id)
   │                              │◀──── Promise 结果 ──────────┤
   │◀─────────────────────────────┤                             │
```

preload 里是**一对一的手写转发**（`src/preload/index.ts`）：

```ts
const api: NotionApi = {
  listPages: () => ipcRenderer.invoke('pages:list'),
  createPage: (input: CreatePageInput) => ipcRenderer.invoke('pages:create', input),
  // ...
}

contextBridge.exposeInMainWorld('api', api)
```

**没有**用 `ipcRenderer.send` + 通道名拼接这类动态转发。原因是：
手写转发让 preload 成为**显式的白名单**——新增一个能碰文件系统的能力，
必须有人手写一行 `contextBridge` 代码并 review 到。

---

## 暴露的三个对象

| 全局变量 | 类型 | 职责 |
| --- | --- | --- |
| `window.api` | `NotionApi` | 页面、块、搜索、双链、图片 |
| `window.ai` | `AiApi` | AI 会话与事件订阅 |
| `window.settings` | `SettingsApi` | 设置读写与应用信息 |

类型定义全部在 `packages/shared/src/index.ts`，`packages/renderer/src/env.d.ts` 里声明到 `Window` 全局。

---

## 通道命名约定

```
<域>:<动作>
```

| 前缀 | 域 | 例子 |
| --- | --- | --- |
| `pages:` | 页面 | `pages:list`、`pages:create`、`pages:move` |
| `blocks:` | 块 | `blocks:list`、`blocks:update`、`blocks:reorder` |
| `search:` | 搜索 | `search:query` |
| `links:` | 双链 | `links:page-links` |
| `images:` | 图片 | `images:save`、`images:pick` |
| `settings:` | 设置 | `settings:get`、`settings:set` |
| `ai:` | AI | `ai:send`、`ai:event` |

**请求/响应用 `ipcMain.handle` + `ipcRenderer.invoke`**（一问一答）。
**主进程主动推送用 `webContents.send`**（`ai:event`、`ai:notes-changed`、`settings:changed`）。

---

## 完整的通道表

### `window.api` — 笔记

| 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `pages:list` | — | `PageMeta[]` | 全部页面，按顶层优先 + position 排序 |
| `pages:create` | `CreatePageInput` | `PageMeta` | 新建页面，自动带一个空正文块 |
| `pages:update` | `UpdatePageInput` | `PageUpdateResult` | 改标题 / 图标；标题变更时返回被改写的块 id |
| `pages:delete` | `id: string` | `void` | 级联删除页面及其子页面、块 |
| `pages:move` | `MovePageInput` | `PageMeta[]` | 改父级 / 同级重排，返回刷新后的完整列表 |
| `pages:reset-welcome` | — | `PageMeta` | 重新灌入欢迎页示例块 |
| `blocks:list` | `pageId: string` | `Block[]` | 页面的全部块，按 position 排序 |
| `blocks:create` | `CreateBlockInput` | `Block` | 新建块，`afterId` 指定插入位置 |
| `blocks:update` | `UpdateBlockInput` | `void` | 改类型 / 内容 |
| `blocks:delete` | `id: string` | `void` | 删除块 |
| `blocks:reorder` | `pageId, orderedIds[]` | `void` | 整层重排，单事务 |
| `search:query` | `query: string` | `SearchResult[]` | 标题 + 正文搜索 |
| `links:page-links` | `pageId: string` | `PageLinks` | 页面的出链与反链 |
| `images:save` | `SaveImageInput` | `SavedImage` | 保存图片数据（粘贴用） |
| `images:pick` | — | `SavedImage \| null` | 打开系统文件选择器 |

### `window.ai` — AI

| 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `ai:send` | `text, context` | `AiSendResult` | 发送一条消息 |
| `ai:abort` | — | `void` | 中断当前生成 |
| `ai:status` | — | `AiStatus` | 会话是否就绪、当前模型、错误信息 |
| `ai:models` | — | `AiModelInfo[]` | 本机可用模型列表 |
| `ai:reset` | — | `void` | 丢弃当前会话 |

**主进程 → 渲染进程**：

| 通道 | 载荷 | 说明 |
| --- | --- | --- |
| `ai:event` | `AiEvent` | 流式事件：文本增量、思考增量、工具开始/结束、通知、结束 |
| `ai:notes-changed` | 无 | AI 执行了写操作，前端应重新加载数据 |

### `window.settings` — 设置

| 通道 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `settings:get` | — | `AppSettings` | 读取全部设置（已 sanitize） |
| `settings:set` | `DeepPartial<AppSettings>` | `AppSettings` | 局部更新，返回最终生效值 |
| `settings:reset` | — | `AppSettings` | 恢复默认（只重置设置，不动笔记） |
| `settings:app-info` | — | `AppInfo` | 版本、路径、体积、条目数 |
| `settings:reveal` | `'data' \| 'assets'` | `void` | 在系统文件管理器中打开目录 |

**主进程 → 渲染进程**：

| 通道 | 载荷 | 说明 |
| --- | --- | --- |
| `settings:changed` | `AppSettings` | 设置变更广播（所有窗口） |

---

## 事件订阅的返回值

`onEvent`、`onNotesChanged`、`onChanged` 都返回**取消订阅函数**：

```ts
const off = window.ai.onEvent((event) => { ... })
// 用完取消
off()
```

React 组件里直接在 `useEffect` 里返回这个函数即可：

```tsx
useEffect(() => window.ai.onEvent(handleEvent), [])
```

---

## 事件监听器的引用泄漏防护

preload 里包装监听器时，**必须**返回移除函数，否则组件卸载后监听器仍在：

```ts
onEvent: (cb: (event: AiEvent) => void) => {
  const listener = (_e: Electron.IpcRendererEvent, event: AiEvent): void => cb(event)
  ipcRenderer.on('ai:event', listener)
  return () => ipcRenderer.removeListener('ai:event', listener)
}
```

---

## 扩展指南

要加一个新能力，顺序是：

1. **在 `packages/shared/src/index.ts` 定义入参 / 出参类型**，并挂到对应的 `*Api` 接口上。
2. **主进程**：在 `db.ts`（数据）或对应服务文件里实现逻辑，
   然后在 `index.ts` 的 `registerIpc()` 里 `ipcMain.handle('域:动作', ...)`。
3. **preload**：在对应对象里加一行转发。
4. **渲染层**：在 `packages/renderer/src/env.d.ts` 确认全局类型已自动更新（类型来自 shared 包，无需手改）。

> `env.d.ts` 里 `Window` 接口直接引用 `NotionApi` / `AiApi` / `SettingsApi`，
> 所以只要 shared 包的类型改了，渲染层的 `window.api.xxx` 立刻有类型提示——
> 这是 shared 目录存在的核心价值。

---

## 相关文档

- [类型参考](../reference/types.md) —— 全部类型定义
- [IPC 通道表](../reference/ipc-channels.md) —— 速查表
- [架构总览](overview.md) —— 进程模型
