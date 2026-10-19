# 类型参考

全部类型定义在 `packages/shared/src/index.ts`。主进程、preload、渲染进程**共用**这一份。

---

## 块类型

```ts
export type BlockType =
  | 'paragraph' | 'heading1' | 'heading2' | 'heading3'
  | 'bulletedList' | 'numberedList' | 'todo'
  | 'quote' | 'code' | 'divider' | 'image' | 'table'
```

12 种。详细行为见 [块类型参考](../user-guide/blocks.md)。

---

## 核心数据

```ts
export interface Block {
  id: string          // UUID
  pageId: string
  type: BlockType
  content: BlockContent
  position: number    // 浮点数，同页内排序
  createdAt: number   // 毫秒时间戳
  updatedAt: number
}

export interface PageMeta {
  id: string
  title: string
  icon: string | null
  parentId: string | null
  position: number
  createdAt: number
  updatedAt: number
}

export interface BlockContent {
  text?: string
  checked?: boolean
  src?: string          // image: 'nc-asset://asset/<id>'
  table?: TableData
}

export interface TableData {
  rows: string[][]
  header: boolean       // 第一行是否渲染为表头
}
```

---

## 常量与工具函数

```ts
export const WELCOME_PAGE_TITLE = '欢迎使用 Notion Clone'
export const TABLE_DEFAULT_ROWS = 3
export const TABLE_DEFAULT_COLS = 3

export function createTableData(
  rowCount = TABLE_DEFAULT_ROWS,
  colCount = TABLE_DEFAULT_COLS,
  header = true
): TableData

export function tableToText(table: TableData): string
```

`tableToText` 把表格拍平成纯文本：行内用 ` | ` 连接，行间用 `\n` 分隔。

```ts
tableToText({ header: true, rows: [['a','b'],['c','d']] })
// → "a | b\nc | d"
```

**这张纯文本摘要会写进 `content.text`**，让表格能复用搜索、AI 上下文、复制粘贴这些纯文本通道。

---

## 搜索

```ts
export interface SearchResult {
  pageId: string
  pageTitle: string
  pageIcon: string | null
  blockId: string | null    // null 表示这是页面标题命中
  snippet: string
}
```

---

## 输入类型

```ts
export interface CreatePageInput {
  parentId?: string | null
  title?: string
}

export interface UpdatePageInput {
  id: string
  title?: string
  icon?: string | null
}

export interface MovePageInput {
  id: string
  parentId: string | null    // null = 移到顶层
  index: number              // 0 基，在目标父级的子节点中的插入位置
}

export interface CreateBlockInput {
  pageId: string
  type?: BlockType
  content?: BlockContent
  afterId?: string | null     // 在哪个块之后插入；null = 追加到末尾
}

export interface UpdateBlockInput {
  id: string
  type?: BlockType
  content?: BlockContent
}
```

---

## 图片

```ts
export interface SaveImageInput {
  name: string
  mime: string
  data: ArrayBuffer
}

export interface SavedImage {
  id: string
  url: string    // 'nc-asset://asset/<id>'
}
```

---

## AI

```ts
export type AiEvent =
  | { type: 'run_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; id: string; name: string; label: string; args: unknown }
  | { type: 'tool_end'; id: string; name: string; isError: boolean }
  | { type: 'notice'; text: string }
  | { type: 'run_end'; error?: string }

export interface AiStatus {
  ready: boolean
  model?: string      // 'provider / id'
  error?: string
}

export interface AiSendResult {
  ok: boolean
  error?: string
}

export interface AiPageContext {
  pageId: string
  title: string
  icon?: string | null
  blocks: Array<{ id: string; type: string; text: string; checked?: boolean }>
}

export interface AiModelInfo {
  provider: string
  id: string
  name: string
  reasoning: boolean
  contextWindow: number
}
```

### `AiApi`

```ts
export interface AiApi {
  send(text: string, context: AiPageContext | null): Promise<AiSendResult>
  abort(): Promise<void>
  getStatus(): Promise<AiStatus>
  listModels(): Promise<AiModelInfo[]>
  reset(): Promise<void>
  onEvent(cb: (event: AiEvent) => void): () => void      // 返回取消订阅函数
  onNotesChanged(cb: () => void): () => void
}
```

---

## 设置

```ts
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type ThemeMode = 'light' | 'dark' | 'system'

export const EDITOR_FONT_SIZES = [14, 15, 17, 19] as const
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number]

export const CONTENT_WIDTHS = { narrow: 640, standard: 768, wide: 1080 } as const
export type ContentWidth = keyof typeof CONTENT_WIDTHS

export interface AiSettings {
  model: string | null        // 'provider/id'；null = 跟随 pi 默认
  autoContext: boolean
  extraPrompt: string
}

export interface EditorSettings {
  fontSize: EditorFontSize
  contentWidth: ContentWidth
}

export interface AppSettings {
  theme: ThemeMode
  editor: EditorSettings
  ai: AiSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  editor: { fontSize: 15, contentWidth: 'standard' },
  ai: { model: null, autoContext: true, extraPrompt: '' }
}
```

### `AppInfo`

```ts
export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string      // 'darwin arm64'
  dataDir: string
  assetsDir: string
  dbPath: string
  dbBytes: number
  assetCount: number
  assetBytes: number
  pageCount: number
  blockCount: number
}
```

### `SettingsApi`

```ts
export interface SettingsApi {
  get(): Promise<AppSettings>
  set(patch: DeepPartial<AppSettings>): Promise<AppSettings>   // 返回最终生效值
  reset(): Promise<AppSettings>
  onChanged(cb: (settings: AppSettings) => void): () => void
  getAppInfo(): Promise<AppInfo>
  reveal(target: 'data' | 'assets'): Promise<void>
}
```

---

## 笔记 API

```ts
export interface NotionApi {
  listPages(): Promise<PageMeta[]>
  createPage(input: CreatePageInput): Promise<PageMeta>
  updatePage(input: UpdatePageInput): Promise<void>
  deletePage(id: string): Promise<void>
  movePage(input: MovePageInput): Promise<PageMeta[]>     // 返回刷新后的完整列表
  resetWelcomePage(): Promise<PageMeta>
  listBlocks(pageId: string): Promise<Block[]>
  createBlock(input: CreateBlockInput): Promise<Block>
  updateBlock(input: UpdateBlockInput): Promise<void>
  deleteBlock(id: string): Promise<void>
  reorderBlocks(pageId: string, orderedIds: string[]): Promise<void>
  search(query: string): Promise<SearchResult[]>
  saveImage(input: SaveImageInput): Promise<SavedImage>
  pickImage(): Promise<SavedImage | null>
}
```

---

## 窗口全局对象

`packages/renderer/src/env.d.ts`：

```ts
declare global {
  interface Window {
    api: NotionApi
    ai: AiApi
    settings: SettingsApi
  }
}
```

因为直接引用 shared 包里的接口，**改了 shared 包，
渲染层的 `window.api.xxx` 立刻就有类型提示**——不需要手动同步任何声明。

---

## 相关文档

- [IPC 通道表](ipc-channels.md) —— 通道与类型对照
- [文件地图](file-map.md) —— 类型在哪些文件里被用
- [数据模型](../architecture/data-model.md) —— 这些类型怎么落库
