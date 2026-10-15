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
