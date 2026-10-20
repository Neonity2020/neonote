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
  | 'table'

/** Title of the auto-seeded welcome page. Used to identify it for "reset examples". */
export const WELCOME_PAGE_TITLE = '欢迎使用 Notion Clone'

/** 简单表格:纯文本单元格,不做合并/样式,第一行可选作为表头 */
export interface TableData {
  rows: string[][]
  /** 是否把第一行渲染为表头 */
  header: boolean
}

export interface BlockContent {
  text?: string
  checked?: boolean
  /** Image block: asset URL (nc-asset://asset/<id>) */
  src?: string
  /** Table block: 行列数据 */
  table?: TableData
}

/** 新建表格的默认尺寸 */
export const TABLE_DEFAULT_ROWS = 3
export const TABLE_DEFAULT_COLS = 3

export function createTableData(
  rowCount = TABLE_DEFAULT_ROWS,
  colCount = TABLE_DEFAULT_COLS,
  header = true
): TableData {
  return {
    header,
    rows: Array.from({ length: Math.max(1, rowCount) }, () => Array.from({ length: Math.max(1, colCount) }, () => ''))
  }
}

/**
 * 把表格拍平成纯文本,写进 content.text。
 * 这样搜索、AI 上下文、复制粘贴都能直接复用既有的纯文本通道。
 */
export function tableToText(table: TableData): string {
  return table.rows.map((row) => row.join(' | ')).join('\n')
}

// ---------- 双链 (Wiki Links) ----------

/**
 * 双链语法:正文里写 `[[页面标题]]`,渲染层把它显示成可点击的链接。
 * 支持 `[[页面标题|显示别名]]`,别名只影响显示,链接目标仍是标题指向的页面。
 *
 * 标题里不允许出现 `[` `]` 和换行,避免嵌套歧义。
 */
export const WIKI_LINK_SOURCE = '\\[\\[([^\\[\\]\\n]+)\\]\\]'

/** 一次双链匹配在原文中的位置与语义 */
export interface WikiLinkMatch {
  /** 匹配起始下标(指向第一个 `[`) */
  start: number
  /** 匹配结束下标(指向最后一个 `]` 之后) */
  end: number
  /** 链接指向的页面标题(已去掉别名) */
  title: string
  /** 显示别名;没写别名时为 null */
  alias: string | null
}

/**
 * 解析一段文本里的所有双链。
 * 纯函数,主进程与渲染进程共用同一份实现,保证"看到的是链接"和"算得出反向链接"一致。
 */
export function parseWikiLinks(text: string): WikiLinkMatch[] {
  const out: WikiLinkMatch[] = []
  if (!text) return out
  const re = new RegExp(WIKI_LINK_SOURCE, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]
    const pipe = inner.indexOf('|')
    const title = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    if (!title) continue
    const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : ''
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      title,
      alias: alias || null
    })
  }
  return out
}

/** 取出一段文本里所有双链指向的标题(按出现顺序,可重复) */
export function extractWikiLinkTitles(text: string): string[] {
  return parseWikiLinks(text).map((l) => l.title)
}

/** 把 `[[标题]]` 里的标记去掉,只留可读文本(用于生成摘要) */
export function stripWikiLinkMarkers(text: string): string {
  return text.replace(new RegExp(WIKI_LINK_SOURCE, 'g'), (_all, inner: string) => {
    const pipe = inner.indexOf('|')
    const title = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : ''
    return alias || title
  })
}

/**
 * 把文本里指向 `oldTitle` 的双链改写成 `newTitle`。
 * 只改标题完全相同的链接,`[[Old]]` 不会误伤 `[[Oldish]]`;别名会被保留。
 */
export function replaceWikiLinkTitle(text: string, oldTitle: string, newTitle: string): string {
  if (!oldTitle || oldTitle === newTitle) return text
  const matches = parseWikiLinks(text)
  if (matches.length === 0) return text
  let out = ''
  let cursor = 0
  let changed = false
  for (const m of matches) {
    if (m.title !== oldTitle) continue
    out += text.slice(cursor, m.start)
    out += `[[${newTitle}${m.alias ? `|${m.alias}` : ''}]]`
    cursor = m.end
    changed = true
  }
  if (!changed) return text
  out += text.slice(cursor)
  return out
}

/**
 * 标题索引:一次建表,避免每条链接都全量扫页面列表。
 * `exact` 存精确标题,`lower` 存小写形式,后者只在精确匹配落空时兜底。
 */
export interface PageTitleIndex<T> {
  exact: Map<string, T>
  lower: Map<string, T>
}

export function buildPageTitleIndex<T extends { id: string; title: string }>(
  pages: T[]
): PageTitleIndex<T> {
  const exact = new Map<string, T>()
  const lower = new Map<string, T>()
  for (const p of pages) {
    const key = p.title
    if (!key) continue
    if (!exact.has(key)) exact.set(key, p)
    const lk = key.toLowerCase()
    if (!lower.has(lk)) lower.set(lk, p)
  }
  return { exact, lower }
}

/** 在标题索引里查页面:先精确匹配,再退回忽略大小写匹配 */
export function lookupPageByTitle<T>(index: PageTitleIndex<T>, title: string): T | undefined {
  const t = title.trim()
  if (!t) return undefined
  return index.exact.get(t) ?? index.lower.get(t.toLowerCase())
}

/**
 * 按标题解析目标页面。
 * 先精确匹配,再退回忽略大小写匹配;同名时取数组里第一个(列表需按页面树顺序传入)。
 *
 * 主进程算反向链接、渲染进程画链接用的是同一个函数,
 * 所以"界面上显示能点开"和"面板里统计成反向链接"永远指向同一个页面。
 */
export function resolvePageByTitle<T extends { id: string; title: string }>(
  pages: T[],
  title: string
): T | undefined {
  return lookupPageByTitle(buildPageTitleIndex(pages), title)
}

/** 本页指向其他页面的链接 */
export interface OutgoingLink {
  /** 链接指向的页面标题 */
  title: string
  /** 目标页面 id;页面不存在时为 null(链接处于"未创建"状态) */
  pageId: string | null
  /** 目标页面图标 */
  pageIcon: string | null
  /** 引用这条链接的块 id(同一目标被引用多次时会有多个) */
  blockIds: string[]
}

/** 一条反向链接:某个块引用了目标页面 */
export interface BacklinkRef {
  /** 引用所在的块 id */
  blockId: string
  /** 引用所在页面 id */
  pageId: string
  /** 引用所在页面标题 */
  pageTitle: string
  /** 引用所在页面图标 */
  pageIcon: string | null
  /** 引用所在块的文本摘要(已去掉双链标记) */
  snippet: string
}

/** 一个页面的双向链接视图 */
export interface PageLinks {
  /** 本页指出去的链接 */
  outgoing: OutgoingLink[]
  /** 指向本页的反向链接 */
  backlinks: BacklinkRef[]
}

/** 页面改名后,哪些块里的双链被同步改写了 */
export interface PageUpdateResult {
  /** 文本被同步改写的块 id(可能属于别的页面) */
  updatedBlockIds: string[]
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

/** 把页面移动到新的父级下的指定位置(同时覆盖"同级排序"和"改变层级"两种操作) */
export interface MovePageInput {
  id: string
  /** 新父级;null 表示移到顶层 */
  parentId: string | null
  /** 在目标父级的子节点中的插入位置(0 基;计算时不含被移动页面自身) */
  index: number
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
  /** 改标题/图标;标题变更时会同步改写其他块里的 `[[旧标题]]`,返回被改写的块 id */
  updatePage(input: UpdatePageInput): Promise<PageUpdateResult>
  deletePage(id: string): Promise<void>
  /** 移动页面(改父级 / 同级重排),返回刷新后的完整页面列表 */
  movePage(input: MovePageInput): Promise<PageMeta[]>
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
  /** 取页面的双向链接:出链 + 反向链接 */
  getPageLinks(pageId: string): Promise<PageLinks>
  saveImage(input: SaveImageInput): Promise<SavedImage>
  pickImage(): Promise<SavedImage | null>
}
