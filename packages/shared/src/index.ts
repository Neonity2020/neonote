/**
 * The IPC contract shared by the main and renderer processes.
 *
 * Every type and helper in this module is imported by both sides, so the
 * shapes the renderer sends and the main process answers can never drift
 * apart.
 */

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
  | 'audio'
  | 'table'
  | 'database'

/** Title of the auto-seeded welcome page. Used to identify it for "reset examples". */
export const WELCOME_PAGE_TITLE = '欢迎使用 Notion Clone'

/** A simple table: plain-text cells, no merging or styling, with an optional header row. */
export interface TableData {
  rows: string[][]
  /** Whether the first row is rendered as the header. */
  header: boolean
}

/** The payload of a block; which fields are used depends on the block type. */
export interface BlockContent {
  text?: string
  checked?: boolean
  /** Image or audio block: asset URL or remote media URL. */
  src?: string
  /** Image caption, also mirrored to text for search and AI context. */
  caption?: string
  /** Audio block: speech-to-text transcript, also mirrored to text for search. */
  transcript?: string
  /** Table block: row and column data. */
  table?: TableData
  database?: DatabaseData
}

export type DatabasePropertyType = 'text' | 'number' | 'date' | 'checkbox' | 'select'
export interface DatabaseProperty {
  id: string
  name: string
  type: DatabasePropertyType
  options?: string[]
}
export interface DatabaseData {
  name: string
  /** Missing on older databases: use the table view. */
  view?: 'table' | 'gallery'
  properties: DatabaseProperty[]
  records: { id: string; values: Record<string, string | boolean> }[]
  sort?: { propertyId: string; direction: 'asc' | 'desc' }
}
export function createDatabaseData(): DatabaseData {
  return {
    name: '未命名数据库',
    properties: [
      { id: 'name', name: '名称', type: 'text' },
      { id: 'status', name: '状态', type: 'select', options: ['未开始', '进行中', '已完成'] }
    ],
    records: [{ id: 'first', values: { name: '', status: '未开始' } }]
  }
}
export function databaseToText(database: DatabaseData): string {
  return [database.name, database.properties.map((p) => p.name).join(' | '),
    ...database.records.map((record) => database.properties.map((p) => {
      const value = record.values[p.id]
      return typeof value === 'boolean' ? (value ? '是' : '否') : value ?? ''
    }).join(' | '))].join('\n')
}

/** Default number of rows in a newly created table. */
export const TABLE_DEFAULT_ROWS = 3
/** Default number of columns in a newly created table. */
export const TABLE_DEFAULT_COLS = 3

/** Create an empty table with the given dimensions, padded to a rectangle. */
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
 * Flatten a table into plain text and store it in content.text.
 * That way search, the AI context and copy/paste all reuse the existing
 * plain-text path instead of needing a table-aware variant of each.
 */
export function tableToText(table: TableData): string {
  return table.rows.map((row) => row.join(' | ')).join('\n')
}

// ---------- Wiki Links ----------

/**
 * Wiki link syntax: `[[Page title]]` in the body, which the renderer draws as
 * a clickable link.
 * `[[Page title|Display alias]]` is supported; the alias only changes what is
 * shown, the link still points at the page named by the title.
 *
 * A title may not contain `[`, `]` or a newline, so nested or ambiguous links
 * cannot be produced.
 */
export const WIKI_LINK_SOURCE = '\\[\\[([^\\[\\]\\n]+)\\]\\]'

/** The position and meaning of one wiki link match in the source text. */
export interface WikiLinkMatch {
  /** Index of the start of the match (pointing at the first `[`). */
  start: number
  /** Index just after the end of the match (pointing past the last `]`). */
  end: number
  /** The page title the link points at (the alias is stripped). */
  title: string
  /** The display alias, or null when the link has none. */
  alias: string | null
}

/**
 * Parse every wiki link in a text.
 * A pure function that the main process and the renderer both use, so what
 * looks like a link on screen and what counts as a backlink always agree.
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

/** The titles every wiki link in a text points at, in order of appearance and possibly repeated. */
export function extractWikiLinkTitles(text: string): string[] {
  return parseWikiLinks(text).map((l) => l.title)
}

/** Strip the `[[...]]` markers from a text, leaving only the readable text (used to build snippets). */
export function stripWikiLinkMarkers(text: string): string {
  return text.replace(new RegExp(WIKI_LINK_SOURCE, 'g'), (_all, inner: string) => {
    const pipe = inner.indexOf('|')
    const title = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : ''
    return alias || title
  })
}

/**
 * Rewrite the wiki links that point at `oldTitle` so they point at `newTitle`.
 *
 * The title is matched case-insensitively, because that is how a link is
 * resolved: `[[notes]]` points at a page titled "Notes", so a rename has to
 * rewrite it as well. Only the whole title is compared, so `[[Old]]` never
 * touches `[[Oldish]]`; an alias is kept.
 */
export function replaceWikiLinkTitle(text: string, oldTitle: string, newTitle: string): string {
  if (!oldTitle || oldTitle === newTitle) return text
  const matches = parseWikiLinks(text)
  if (matches.length === 0) return text
  const wanted = oldTitle.toLowerCase()
  let out = ''
  let cursor = 0
  let changed = false
  for (const m of matches) {
    if (m.title.toLowerCase() !== wanted) continue
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
 * Title index: built once so every link does not have to scan the page list.
 * `exact` holds the exact titles, `lower` holds their lowercase form; the
 * latter is only consulted when the exact match misses.
 */
export interface PageTitleIndex<T> {
  exact: Map<string, T>
  lower: Map<string, T>
}

/** Build the title lookup maps for a list of pages. */
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

/** Look a page up in a title index: exact match first, then a case-insensitive fallback. */
export function lookupPageByTitle<T>(index: PageTitleIndex<T>, title: string): T | undefined {
  const t = title.trim()
  if (!t) return undefined
  return index.exact.get(t) ?? index.lower.get(t.toLowerCase())
}

/**
 * Resolve the target page by title.
 * An exact match first, then a case-insensitive fallback; with duplicate titles
 * the first entry of the list wins (the list has to be in page-tree order).
 *
 * The main process counts backlinks and the renderer draws the links with this
 * same function, so "clickable in the UI" and "counted as a backlink" always
 * point at the same page.
 */
export function resolvePageByTitle<T extends { id: string; title: string }>(
  pages: T[],
  title: string
): T | undefined {
  return lookupPageByTitle(buildPageTitleIndex(pages), title)
}

/** A link this page makes to another page. */
export interface OutgoingLink {
  /** The title of the page the link points at. */
  title: string
  /** The id of the target page, or null when the page does not exist (the link is "not created"). */
  pageId: string | null
  /** The icon of the target page. */
  pageIcon: string | null
  /** The ids of the blocks that hold this link (several when the target is referenced repeatedly). */
  blockIds: string[]
}

/** One backlink: a block that references the target page. */
export interface BacklinkRef {
  /** The id of the block holding the reference. */
  blockId: string
  /** The id of the page that holds the block. */
  pageId: string
  /** The title of the page that holds the block. */
  pageTitle: string
  /** The icon of the page that holds the block. */
  pageIcon: string | null
  /** A text summary of the referring block (the wiki link markers are stripped). */
  snippet: string
}

/** Both link directions of a single page. */
export interface PageLinks {
  /** The links this page makes. */
  outgoing: OutgoingLink[]
  /** The links that point back at this page. */
  backlinks: BacklinkRef[]
}

/** After a page rename, the blocks whose wiki links were rewritten. */
export interface PageUpdateResult {
  /** The ids of the blocks whose text was rewritten (they may live in other pages). */
  updatedBlockIds: string[]
}

/** Raw image bytes plus the metadata used to pick a file extension. */
export interface SaveImageInput {
  name: string
  mime: string
  data: ArrayBuffer
}

/** A stored asset: its file id and the URL the renderer can display. */
export interface SavedImage {
  id: string
  url: string
}

/** A content block belonging to a page. */
export interface Block {
  id: string
  pageId: string
  type: BlockType
  content: BlockContent
  position: number
  createdAt: number
  updatedAt: number
}

/** Page metadata shared by the sidebar and editor, including its icon and optional cover. */
export interface PageMeta {
  id: string
  title: string
  icon: string | null
  cover: string | null
  parentId: string | null
  position: number
  createdAt: number
  updatedAt: number
}

/** One search hit: either a page title match or a block text match. */
export interface SearchResult {
  pageId: string
  pageTitle: string
  pageIcon: string | null
  blockId: string | null
  snippet: string
}

/** The fields accepted when creating a page. */
export interface CreatePageInput {
  parentId?: string | null
  title?: string
}

/** The fields accepted when updating a page; undefined fields are left untouched. */
export interface UpdatePageInput {
  id: string
  title?: string
  icon?: string | null
  cover?: string | null
}

/**
 * Move a page to a position under a new parent, covering both a reorder among
 * siblings and a change of level in one operation.
 */
export interface MovePageInput {
  id: string
  /** The new parent; null moves the page to the top level. */
  parentId: string | null
  /** The insertion index among the target parent's children (0-based, excluding the moved page itself). */
  index: number
}

/** The fields accepted when creating a block. */
export interface CreateBlockInput {
  pageId: string
  type?: BlockType
  content?: BlockContent
  afterId?: string | null
}

/** The fields accepted when updating a block; undefined fields are left untouched. */
export interface UpdateBlockInput {
  id: string
  type?: BlockType
  content?: BlockContent
}

// ---------- AI Assistant ----------

/** An event streamed from the AI session to the renderer. */
export type AiEvent =
  | { type: 'run_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; id: string; name: string; label: string; args: unknown }
  | { type: 'tool_end'; id: string; name: string; isError: boolean }
  | { type: 'notice'; text: string }
  | { type: 'run_end'; error?: string }

/** The readiness and the current model of the AI assistant. */
export interface AiStatus {
  ready: boolean
  model?: string
  error?: string
}

/** The outcome of sending a message to the AI assistant. */
export interface AiSendResult {
  ok: boolean
  error?: string
}

/** The "current page" context attached to a message sent to the AI assistant. */
export interface AiPageContext {
  pageId: string
  title: string
  icon?: string | null
  blocks: Array<{ id: string; type: string; text: string; checked?: boolean }>
}

/** The AI assistant surface exposed to the renderer through contextBridge. */
export interface AiApi {
  send(text: string, context: AiPageContext | null): Promise<AiSendResult>
  abort(): Promise<void>
  getStatus(): Promise<AiStatus>
  /** List the models available on this machine (needs the model catalog and the auth info; the first call triggers a refresh). */
  listModels(): Promise<AiModelInfo[]>
  /** Discard the current session (clearing the conversation history and the context); the next question rebuilds it from the latest settings. */
  reset(): Promise<void>
  onEvent(cb: (event: AiEvent) => void): () => void
  onNotesChanged(cb: () => void): () => void
}

// ---------- Settings ----------

/** Recursively optional, so a settings patch can be partial. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/** Light, dark, or follow the operating system. */
export type ThemeMode = 'light' | 'dark' | 'system'

/** The predefined editor body font sizes in px, which also set the line height and the typographic rhythm. */
export const EDITOR_FONT_SIZES = [14, 15, 17, 19] as const
export type EditorFontSize = (typeof EDITOR_FONT_SIZES)[number]

/** The predefined maximum content widths in px (including the horizontal padding). */
export const CONTENT_WIDTHS = { narrow: 640, standard: 768, wide: 1080 } as const
export type ContentWidth = keyof typeof CONTENT_WIDTHS

/** The settings of the built-in AI assistant. */
export interface AiSettings {
  /** "provider/id"; null means follow pi's default model. */
  model: string | null
  /** Whether the current page context is attached automatically on every turn. */
  autoContext: boolean
  /** Custom instructions appended to the built-in system prompt. */
  extraPrompt: string
}

/** The editor section of the settings. */
export interface EditorSettings {
  fontSize: EditorFontSize
  contentWidth: ContentWidth
  /** Whether the decorative illustration is shown behind an empty page. */
  newPageBackground: boolean
}

/** The full settings object: the theme, editor and AI sections. */
export interface AppSettings {
  theme: ThemeMode
  editor: EditorSettings
  ai: AiSettings
}

/** The settings a fresh installation starts with. */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  editor: { fontSize: 15, contentWidth: 'standard', newPageBackground: true },
  ai: { model: null, autoContext: true, extraPrompt: '' }
}

/** One model available on this machine, as shown in the settings panel. */
export interface AiModelInfo {
  provider: string
  id: string
  name: string
  reasoning: boolean
  contextWindow: number
}

/** Application and storage information (the "data" section of the settings panel). */
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

/** The settings surface exposed to the renderer through contextBridge. */
export interface SettingsApi {
  get(): Promise<AppSettings>
  set(patch: DeepPartial<AppSettings>): Promise<AppSettings>
  reset(): Promise<AppSettings>
  onChanged(cb: (settings: AppSettings) => void): () => void
  getAppInfo(): Promise<AppInfo>
  /** Open the data directory or the asset directory in the system file manager. */
  reveal(target: 'data' | 'assets'): Promise<void>
}

/** Raw bytes of a stored asset, readable back by the app (e.g. for transcription). */
export interface AssetBytes {
  mime: string
  data: ArrayBuffer
}

/** The pages, blocks and links surface exposed to the renderer through contextBridge. */
export interface NotionApi {
  listPages(): Promise<PageMeta[]>
  createPage(input: CreatePageInput): Promise<PageMeta>
  /** Change the title and/or icon; a title change also rewrites the `[[old title]]` links in other blocks and returns the ids of the rewritten blocks. */
  updatePage(input: UpdatePageInput): Promise<PageUpdateResult>
  deletePage(id: string): Promise<void>
  /** Move a page (change its parent / reorder it among its siblings) and return the refreshed page list. */
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
  /** Both directions of a page's wiki links: outgoing links and backlinks. */
  getPageLinks(pageId: string): Promise<PageLinks>
  saveImage(input: SaveImageInput): Promise<SavedImage>
  pickImage(): Promise<SavedImage | null>
  /** Same shape as the image pair, for audio files (mp3 / wav / …). */
  saveAudio(input: SaveImageInput): Promise<SavedImage>
  pickAudio(): Promise<SavedImage | null>
  /**
   * Read back the bytes of an asset URL the app itself produced (uploaded image /
   * audio). Used when the browser cannot fetch the URL directly (CORS on R2
   * public URLs, custom schemes on desktop). Null when the URL is not readable
   * through the app.
   */
  fetchAssetBytes(url: string): Promise<AssetBytes | null>
}
