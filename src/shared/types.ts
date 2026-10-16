export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletedList'
  | 'numberedList'
  | 'todo'
  | 'quote'
  | 'code'
  | 'divider'
  | 'image'

/** Title of the auto-seeded welcome page. Used to identify it for "reset examples". */
export const WELCOME_PAGE_TITLE = '欢迎使用 Notion Clone'

export interface BlockContent {
  text?: string
  checked?: boolean
  /** Image block: asset URL (nc-asset://asset/<id>) */
  src?: string
}

export interface SaveImageInput {
  name: string
  mime: string
  data: ArrayBuffer
}

export interface SavedImage {
  id: string
  url: string
}

export interface Block {
  id: string
  pageId: string
  type: BlockType
  content: BlockContent
  position: number
  createdAt: number
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

export interface SearchResult {
  pageId: string
  pageTitle: string
  pageIcon: string | null
  blockId: string | null
  snippet: string
}

export interface CreatePageInput {
  parentId?: string | null
  title?: string
}

export interface UpdatePageInput {
  id: string
  title?: string
  icon?: string | null
}

export interface CreateBlockInput {
  pageId: string
  type?: BlockType
  content?: BlockContent
  afterId?: string | null
}

export interface UpdateBlockInput {
  id: string
  type?: BlockType
  content?: BlockContent
}

// ---------- AI Assistant ----------

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
  model?: string
  error?: string
}

export interface AiSendResult {
  ok: boolean
  error?: string
}

/** 发送给 AI 助手时附带的"当前页面"上下文 */
export interface AiPageContext {
  pageId: string
  title: string
  icon?: string | null
  blocks: Array<{ id: string; type: string; text: string; checked?: boolean }>
}

export interface AiApi {
  send(text: string, context: AiPageContext | null): Promise<AiSendResult>
  abort(): Promise<void>
  getStatus(): Promise<AiStatus>
  /** 列出本机可用的模型(需要模型目录与认证信息,首次调用会触发刷新) */
  listModels(): Promise<AiModelInfo[]>
  /** 丢弃当前会话(清空对话历史与上下文),下次提问时按最新设置重建 */
  reset(): Promise<void>
  onEvent(cb: (event: AiEvent) => void): () => void
  onNotesChanged(cb: () => void): () => void
}

// ---------- Settings ----------

/** 递归可选,用于局部更新设置 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type ThemeMode = 'light' | 'dark' | 'system'

/** 编辑器正文字号预设(px),同时决定行高与排版节奏 */
export const EDITOR_FONT_SIZES = [14, 15, 17, 19] as const
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number]

/** 内容区最大宽度预设(px,含左右内边距) */
export const CONTENT_WIDTHS = { narrow: 640, standard: 768, wide: 1080 } as const
export type ContentWidth = keyof typeof CONTENT_WIDTHS

export interface AiSettings {
  /** "provider/id";null 表示跟随 pi 的默认模型 */
  model: string | null
  /** 是否在每轮提问时自动附带当前页面上下文 */
  autoContext: boolean
  /** 追加到内置系统提示词之后的自定义指令 */
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

/** 供设置面板展示的单个可用模型 */
export interface AiModelInfo {
  provider: string
  id: string
  name: string
  reasoning: boolean
  contextWindow: number
}

/** 应用与存储信息(设置面板「数据」分区) */
export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  dataDir: string
  assetsDir: string
  dbPath: string
  dbBytes: number
  assetCount: number
  assetBytes: number
  pageCount: number
  blockCount: number
}

export interface SettingsApi {
  get(): Promise<AppSettings>
  set(patch: DeepPartial<AppSettings>): Promise<AppSettings>
  reset(): Promise<AppSettings>
  onChanged(cb: (settings: AppSettings) => void): () => void
  getAppInfo(): Promise<AppInfo>
  /** 在系统文件管理器中打开数据目录 / 资源目录 */
  reveal(target: 'data' | 'assets'): Promise<void>
}

export interface NotionApi {
  listPages(): Promise<PageMeta[]>
  createPage(input: CreatePageInput): Promise<PageMeta>
  updatePage(input: UpdatePageInput): Promise<void>
  deletePage(id: string): Promise<void>
  /**
   * Re-seed the welcome page's example blocks. Returns the page meta.
   * Throws if no page with the welcome title exists.
   */
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
