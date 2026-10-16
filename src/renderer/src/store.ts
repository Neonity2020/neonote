import { create } from 'zustand'
import type { Block, BlockContent, BlockType, PageMeta } from '../../shared/types'

const SAVE_DEBOUNCE = 400
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleSave(id: string): void {
  const existing = saveTimers.get(id)
  if (existing) clearTimeout(existing)
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id)
      const block = useStore.getState().blocks.find((b) => b.id === id)
      if (block) {
        void window.api.updateBlock({ id: block.id, type: block.type, content: block.content })
      }
    }, SAVE_DEBOUNCE)
  )
}

function flushSaves(): void {
  for (const [id, timer] of saveTimers) {
    clearTimeout(timer)
    const block = useStore.getState().blocks.find((b) => b.id === id)
    if (block) {
      void window.api.updateBlock({ id: block.id, type: block.type, content: block.content })
    }
  }
  saveTimers.clear()
}

const pageSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function schedulePageSave(id: string): void {
  const existing = pageSaveTimers.get(id)
  if (existing) clearTimeout(existing)
  pageSaveTimers.set(
    id,
    setTimeout(() => {
      pageSaveTimers.delete(id)
      const page = useStore.getState().pages.find((p) => p.id === id)
      if (page) {
        void window.api.updatePage({ id: page.id, title: page.title, icon: page.icon })
      }
    }, SAVE_DEBOUNCE)
  )
}

interface StoreState {
  pages: PageMeta[]
  currentPageId: string | null
  blocks: Block[]
  blocksLoading: boolean

  init: () => Promise<void>
  selectPage: (id: string | null) => Promise<void>
  createPage: (parentId?: string | null) => Promise<string>
  renamePage: (id: string, title: string) => void
  setPageIcon: (id: string, icon: string | null) => void
  deletePage: (id: string) => Promise<void>
  /** Reset the welcome page's example blocks in-place. Page id stays the same. */
  resetWelcomePage: () => Promise<void>

  updateBlockLocal: (id: string, content: BlockContent) => void
  setBlockType: (id: string, type: BlockType) => void
  setBlockChecked: (id: string, checked: boolean) => void
  insertBlockAfter: (
    afterId: string | null,
    type?: BlockType,
    content?: BlockContent
  ) => Promise<Block | null>
  removeBlock: (id: string) => Promise<void>
  setBlocksOrder: (orderedIds: string[]) => void
  /** AI 助手改动笔记后,从数据库重新加载页面与块 */
  refreshFromAi: () => Promise<void>
}

export const useStore = create<StoreState>((set, get) => ({
  pages: [],
  currentPageId: null,
  blocks: [],
  blocksLoading: false,

  init: async () => {
    const pages = await window.api.listPages()
    set({ pages })
    if (pages.length > 0) {
      await get().selectPage(pages[0].id)
    }
  },

  selectPage: async (id) => {
    flushSaves()
    if (!id) {
      set({ currentPageId: null, blocks: [] })
      return
    }
    set({ currentPageId: id, blocksLoading: true })
    const blocks = await window.api.listBlocks(id)
    set({ blocks, blocksLoading: false })
  },

  createPage: async (parentId = null) => {
    const page = await window.api.createPage({ parentId })
    set((s) => ({ pages: [...s.pages, page] }))
    await get().selectPage(page.id)
    return page.id
  },

  renamePage: (id, title) => {
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, title } : p)) }))
    schedulePageSave(id)
  },

  setPageIcon: (id, icon) => {
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, icon } : p)) }))
    void window.api.updatePage({ id, icon })
  },

  deletePage: async (id) => {
    const { pages, currentPageId } = get()
    // collect ids that will be removed (id + descendants)
    const removed = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const p of pages) {
        if (p.parentId && removed.has(p.parentId) && !removed.has(p.id)) {
          removed.add(p.id)
          changed = true
        }
      }
    }
    const remaining = pages.filter((p) => !removed.has(p.id))
    await window.api.deletePage(id)
    set({ pages: remaining })
    if (currentPageId && removed.has(currentPageId)) {
      await get().selectPage(remaining[0]?.id ?? null)
    }
  },

  resetWelcomePage: async () => {
    flushSaves()
    const { currentPageId } = get()
    const page = await window.api.resetWelcomePage()
    // Touch the page's updatedAt locally so the sidebar reflects the change
    set((s) => ({
      pages: s.pages.map((p) => (p.id === page.id ? { ...p, updatedAt: page.updatedAt } : p))
    }))
    // If we're currently viewing the welcome page, reload its blocks
    if (currentPageId === page.id) {
      await get().selectPage(page.id)
    }
  },

  updateBlockLocal: (id, content) => {
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? { ...b, content } : b))
    }))
    scheduleSave(id)
  },

  setBlockType: (id, type) => {
    set((s) => ({
      blocks: s.blocks.map((b) => {
        if (b.id !== id) return b
        const content: BlockContent = { ...b.content }
        if (type === 'divider') content.text = ''
        if (type !== 'todo') delete content.checked
        return { ...b, type, content }
      })
    }))
    scheduleSave(id)
  },

  setBlockChecked: (id, checked) => {
    set((s) => ({
      blocks: s.blocks.map((b) => (b.id === id ? { ...b, content: { ...b.content, checked } } : b))
    }))
    scheduleSave(id)
  },

  insertBlockAfter: async (afterId, type = 'paragraph', content = { text: '' }) => {
    const { currentPageId } = get()
    if (!currentPageId) return null
    const block = await window.api.createBlock({ pageId: currentPageId, type, content, afterId })
    set((s) => {
      const blocks = [...s.blocks]
      const idx = afterId ? blocks.findIndex((b) => b.id === afterId) : blocks.length - 1
      blocks.splice(idx + 1, 0, block)
      return { blocks }
    })
    return block
  },

  removeBlock: async (id) => {
    const remaining = get().blocks.filter((b) => b.id !== id)
    await window.api.deleteBlock(id)
    if (remaining.length === 0) {
      set({ blocks: [] })
      await get().insertBlockAfter(null, 'paragraph', { text: '' })
    } else {
      set({ blocks: remaining })
    }
  },

  setBlocksOrder: (orderedIds) => {
    const { blocks, currentPageId } = get()
    const byId = new Map(blocks.map((b) => [b.id, b]))
    const reordered = orderedIds
      .map((id, i) => {
        const b = byId.get(id)
        return b ? { ...b, position: (i + 1) * 1024 } : null
      })
      .filter((b): b is Block => b !== null)
    set({ blocks: reordered })
    if (currentPageId) {
      void window.api.reorderBlocks(currentPageId, orderedIds)
    }
  },

  refreshFromAi: async () => {
    // 先把本地未落库的编辑写回去,再整体重读,避免 AI 的改动被旧快照覆盖
    flushSaves()
    const pages = await window.api.listPages()
    const { currentPageId } = get()
    if (currentPageId && pages.some((p) => p.id === currentPageId)) {
      const blocks = await window.api.listBlocks(currentPageId)
      set({ pages, blocks })
    } else {
      set({ pages })
      await get().selectPage(pages[0]?.id ?? null)
    }
  }
}))
