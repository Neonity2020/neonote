# 状态管理

渲染进程用**两个独立的 zustand store**。没有 Redux，没有 Context 状态层。

| Store | 职责 |
| --- | --- |
| `useStore` | 页面、当前页面、块、全部块级操作 |
| `useSettings` | 应用设置 |

分开的理由：设置的更新频率低、来源不同（主进程广播）、消费者也不同（外观分区 vs 笔记区）。
混在一起会让设置变更触发笔记区的无谓重渲染。

---

## `useStore`

### 状态

```ts
interface StoreState {
  pages: PageMeta[]        // 全量页面列表（平铺，渲染层自己拼树）
  currentPageId: string | null
  blocks: Block[]          // 当前页面的块
  blocksLoading: boolean
}
```

**`pages` 是平铺数组**，不是树。树在渲染层用 `parentId` 现场拼（`buildTree`）。
这样 `movePage` 之后主进程返回整个列表，前端直接整体替换，不存在"两棵树的中间态"。

### 防抖落库

`src/renderer/src/store.ts:5`：

```ts
const SAVE_DEBOUNCE = 400
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
```

- 每个块一个定时器。
- 同一块再次编辑会 **clearTimeout** 掉上一次待执行的写入。
- 定时器触发时**重新从 store 读最新值**写入，而不是闭包里捕获的旧值——
  保证写进数据库的一定是最终内容。

标题改名走**另一套**定时器（`pageSaveTimers`），逻辑相同但写 `updatePage`。

### `flushSaves()`

把**所有**待执行的写入立刻执行掉。有三处会调用：

| 时机 | 原因 |
| --- | --- |
| `selectPage()` | 切页前把当前页的编辑写回，避免丢数据 |
| `resetWelcomePage()` | 重置前先写回 |
| `refreshFromAi()` | AI 改完数据后重载前，先把本地编辑写回 |

第���条尤其重要：AI 通过工具直接改数据库，如果前端还有未落库的编辑，
重载时会被 AI 的新内容覆盖——用户的输入就丢了。`flushSaves()` 保证了
**本地编辑先落库，AI 的改动后读入**，顺序正确。

### 主要操作

| 操作 | 实现要点 |
| --- | --- |
| `init()` | 拉全部页面，自动选中第一个 |
| `selectPage(id)` | `flushSaves()` → 置 `blocksLoading` → 拉块 |
| `createPage(parentId)` | 建页 → 加入列表 → 选中 |
| `renamePage(id, title)` | 乐观更新 + 防抖落库 |
| `setPageIcon(id, icon)` | 乐观更新 + **立即**落库（图标没有防抖） |
| `deletePage(id)` | 先算后代集合 → 调 IPC → 从列表移除 → 必要时跳转 |
| `movePage(id, parentId, index)` | 先落库再整体替换状态 |
| `updateBlockLocal(id, content)` | 乐观更新 + 防抖落库 |
| `setBlockType(id, type)` | 附带类型转换的副作用清理 |
| `setBlockChecked(id, checked)` | 乐观更新 + 防抖落库 |
| `insertBlockAfter(afterId, type, content)` | 建块 → 插入到本地数组对应位置 |
| `removeBlock(id)` | 删块；**删到最后一个时补一个空正文块** |
| `setBlocksOrder(orderedIds)` | 本地重排 + 落库 |
| `refreshFromAi()` | `flushSaves()` → 重读页面和块 |

### 两个"不落库直接改"的细节

**`setPageIcon`** 立即落库而不是防抖。图标是一个离散动作，用户不会连续拖动，
防抖只会让图标响应有延迟感。

**`removeBlock` 补空块**：删掉页面最后一个块后，页面会变成"什么都没有"，
用户无法继续输入。所以会自动补一个空正文块，保证页面始终可编辑。

---

## `useSettings`

```ts
interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: DeepPartial<AppSettings>) => Promise<void>
  resetAll: () => Promise<void>
}
```

### 更新流程

```
update(patch)
  → window.settings.set(patch)
  → 主进程 sanitize + 落库 + 广播
  → 返回最终生效值
  → set({ settings })
```

**前端不做校验**。主进程是唯一裁决者，返回的就是最终值。这样"界面显示"和"实际生效"
永远一致，不会出现两套规则。

### 外部变更同步

`App.tsx` 里订阅主进程的广播：

```tsx
useEffect(() => {
  return window.settings.onChanged((next) => {
    useSettings.setState({ settings: next })
  })
}, [])
```

多窗口场景下，一个窗口改了设置，其他窗口也会同步。

---

## 组件订阅方式

用 zustand 的**选择器**订阅，避免全量重渲染：

```tsx
const pages = useStore((s) => s.pages)
const updateBlockLocal = useStore((s) => s.updateBlockLocal)
```

**动作（action）单独订阅**，避免因 action 引用变化导致重渲染——zustand 的 action
在 store 初始化时创建，引用稳定。

需要在事件回调里读最新状态时，用 `useStore.getState()`：

```ts
const state = useStore.getState()
const { prev } = getNeighbors()
```

这在 `BlockItem` 的键盘处理里很常见——事件回调闭包里的 `blocks` 可能不是最新的。

---

## 乐观更新

几乎所有写操作都是**先改本地、再落库**：

```
updateBlockLocal(id, content)
  → set({ blocks: ... })       ← 界面立刻响应
  → scheduleSave(id)           ← 稍后落库
```

好处：输入不会有任何延迟感。代价是需要处理"落库失败"——目前**没有做失败回滚**，
因为本地 SQLite 写入基本不会失败（磁盘满等极端情况除外）。

如果后续要加错误处理，参考 AI 那侧的 `AiSendResult` 模式：
主进程返回 `{ ok, error }`，前端据此提示。

---

## 与 AI 的协作

AI 通过主进程直接改数据库，前端不知道。所以主进程在 AI 调用**写操作工具**后
广播 `ai:notes-changed`，前端收到后调 `refreshFromAi()`：

```
ai:notes-changed
  → refreshFromAi()
      → flushSaves()              ← 先把本地编辑写回
      → listPages()               ← 重读页面
      → listBlocks(currentPageId) ← 重读当前页块
      → set({ pages, blocks })
```

重读的是**当前页**。如果 AI 改的是别的页面，侧边栏的标题/图标会更新（因为重读了 pages），
但块内容要等切到那个页面才刷新。

---

## 相关文档

- [块编辑器](../user-guide/editor.md) —— 编辑行为如何映射到状态操作
- [数据模型](data-model.md) —— 落库的目标结构
- [Pi SDK 集成](../ai/integration.md) —— AI 与前端的协作时序
