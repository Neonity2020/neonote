# IPC 通道表

速查表。设计说明见 [IPC 桥接](../architecture/ipc-bridge.md)。

---

## 请求 / 响应（`ipcMain.handle` + `ipcRenderer.invoke`）

### 页面

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `pages:list` | — | `PageMeta[]` |
| `pages:create` | `CreatePageInput` | `PageMeta` |
| `pages:update` | `UpdatePageInput` | `PageUpdateResult` |
| `pages:delete` | `id: string` | `void` |
| `pages:move` | `MovePageInput` | `PageMeta[]` |
| `pages:reset-welcome` | — | `PageMeta` |

### 块

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `blocks:list` | `pageId: string` | `Block[]` |
| `blocks:create` | `CreateBlockInput` | `Block` |
| `blocks:update` | `UpdateBlockInput` | `void` |
| `blocks:delete` | `id: string` | `void` |
| `blocks:reorder` | `pageId: string, orderedIds: string[]` | `void` |

### 搜索

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `search:query` | `query: string` | `SearchResult[]` |

### 双链

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `links:page-links` | `pageId: string` | `PageLinks` |

### 图片

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `images:save` | `SaveImageInput` | `SavedImage` |
| `images:pick` | — | `SavedImage \| null` |

### 设置

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `settings:get` | — | `AppSettings` |
| `settings:set` | `DeepPartial<AppSettings>` | `AppSettings` |
| `settings:reset` | — | `AppSettings` |
| `settings:app-info` | — | `AppInfo` |
| `settings:reveal` | `'data' \| 'assets'` | `void` |

### AI

| 通道 | 参数 | 返回 |
| --- | --- | --- |
| `ai:send` | `text: string, context: AiPageContext \| null` | `AiSendResult` |
| `ai:abort` | — | `void` |
| `ai:status` | — | `AiStatus` |
| `ai:models` | — | `AiModelInfo[]` |
| `ai:reset` | — | `void` |

---

## 主进程 → 渲染进程（`webContents.send`）

| 通道 | 载荷 | 触发时机 |
| --- | --- | --- |
| `ai:event` | `AiEvent` | AI 每轮生成期间的流式事件 |
| `ai:notes-changed` | 无 | AI 执行了写操作工具后 |
| `settings:changed` | `AppSettings` | 设置变更时广播给所有窗口 |

---

## 暴露的全局对象

| 全局变量 | 覆盖通道 |
| --- | --- |
| `window.api` | `pages:*`、`blocks:*`、`search:*`、`images:*` |
| `window.ai` | `ai:*` |
| `window.settings` | `settings:*` |

---

## 速查：按功能找通道

| 我想… | 通道 |
| --- | --- |
| 列出所有页面 | `pages:list` |
| 新建页面 | `pages:create` |
| 改标题 / 图标 | `pages:update` |
| 删页面 | `pages:delete` |
| 拖拽移动页面 | `pages:move` |
| 读某个页面的块 | `blocks:list` |
| 新建块 | `blocks:create` |
| 改块内容 | `blocks:update` |
| 删块 | `blocks:delete` |
| 整层重排 | `blocks:reorder` |
| 搜索 | `search:query` |
| 查页面的出链与反链 | `links:page-links` |
| 保存粘贴的图片 | `images:save` |
| 弹出文件选择器 | `images:pick` |
| 读设置 | `settings:get` |
| 改设置 | `settings:set` |
| 恢复默认设置 | `settings:reset` |
| 看版本和存储信息 | `settings:app-info` |
| 打开数据目录 | `settings:reveal` |
| 给 AI 发消息 | `ai:send` |
| 中断生成 | `ai:abort` |
| 查 AI 状态 | `ai:status` |
| 列可用模型 | `ai:models` |
| 重置对话 | `ai:reset` |

---

## 相关文档

- [IPC 桥接](../architecture/ipc-bridge.md) —— 设计说明与扩展指南
- [类型参考](types.md) —— 每个通道的参数类型
