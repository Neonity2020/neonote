import { create } from 'zustand'
import type { Block, BlockContent, BlockType, PageMeta, PageUpdateResult } from '~/lib/shared'
import { createTableData, tableToText, createDatabaseData, databaseToText } from '~/lib/shared'
import { requestScrollTo } from '~/lib/caret'

/** Debounce window for persisting an edit, in ms. A burst of typing costs one write. */
const SAVE_DEBOUNCE = 400
/**
 * Pending block saves, keyed by block id. A live entry doubles as the marker for
 * "this block has edits that are not in the database yet".
 */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
/**
 * When the pending edit of a block started, keyed by block id. The database
 * stamps every write with its own timestamp, so this is what tells apart "the
 * database was changed under us" (the AI wrote the block) from "our edit is the
 * newer one".
 */
const saveStartedAt = new Map<string, number>()

function scheduleSave(id: string): void {
  const existing = saveTimers.get(id)
  if (existing) clearTimeout(existing)
  saveStartedAt.set(id, Date.now())
  saveTimers.set(
    id,
    setTimeout(() => {
      saveTimers.delete(id)
      saveStartedAt.delete(id)
      const block = useStore.getState().blocks.find((b) => b.id === id)
      if (block) {
        void window.api.updateBlock({ id: block.id, type: block.type, content: block.content })
      }
    }, SAVE_DEBOUNCE)
  )
}

/**
 * Write every pending block save to the database right now.
 *
 * Called before switching pages and before a page rename is persisted, so an
 * edit that is still inside its debounce window is never dropped.
 */
function flushSaves(): void {
  for (const [id, timer] of saveTimers) {
    clearTimeout(timer)
    saveStartedAt.delete(id)
    const block = useStore.getState().blocks.find((b) => b.id === id)
    if (block) {
      void window.api.updateBlock({ id: block.id, type: block.type, content: block.content })
    }
  }
  saveTimers.clear()
}

/** Drop the pending save of a block, e.g. when the database version wins. */
function cancelSave(id: string): void {
  const timer = saveTimers.get(id)
  if (timer) clearTimeout(timer)
  saveTimers.delete(id)
  saveStartedAt.delete(id)
}

/**
 * Merge a freshly loaded block list into the local one.
 *
 * The database wins wherever it was written after the local state last saw the
 * block — that is the AI changing a note. The stale local edit is dropped in
 * that case, so the pending write cannot put the old text back. Everywhere else
 * the local version is kept, so a keystroke that is still inside its debounce
 * window is not lost.
 */
function mergeFreshBlocks(fresh: Block[]): Block[] {
  const local = new Map(useStore.getState().blocks.map((b) => [b.id, b]))
  const keep = new Map<string, Block>()
  for (const f of fresh) {
    const l = local.get(f.id)
    // A block the local state never saw was created by the AI: take the
    // database version.
    if (!l) continue
    const started = saveStartedAt.get(f.id)
    if (started !== undefined) {
      // The user is editing this block. If the database was written after the
      // edit started, somebody else changed it — the database wins, and the
      // stale local edit is dropped instead of being written back.
      if (f.updatedAt > started) {
        cancelSave(f.id)
        continue
      }
    } else if (f.updatedAt > l.updatedAt) {
      // Nobody is editing this block, and the database changed since it was
      // loaded: the database version is the newer one.
      continue
    }
    keep.set(f.id, l)
  }
  return fresh.map((f) => keep.get(f.id) ?? f)
}

// Pending page saves, keyed by page id.
const pageSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Write every pending page save (title, icon) to the database right now.
 *
 * The page list is replaced wholesale by `movePage` and by the AI refresh, and
 * the replacement comes from the database. A title edit that is still inside
 * its debounce window would be overwritten by the stored, older title — and
 * then persisted as such.
 */
async function flushPageSaves(): Promise<void> {
  const pending = [...pageSaveTimers.entries()]
  pageSaveTimers.clear()
  await Promise.all(
    pending.map(async ([id]) => {
      const page = useStore.getState().pages.find((p) => p.id === id)
      if (!page) return
      try {
        const result = await window.api.updatePage({
          id: page.id,
          title: page.title,
          icon: page.icon
        })
        await applyPageUpdate(result)
      } catch (err) {
        console.error('保存页面失败', err)
      }
    })
  )
}

/**
 * Apply the result of a page update: pull back the blocks a rename rewrote and
 * let the link panel re-query, because the resolution of every `[[title]]`
 * depends on the page titles.
 */
async function applyPageUpdate(result: PageUpdateResult): Promise<void> {
  if (result.updatedBlockIds.length > 0) {
    await useStore.getState().syncBlocksByIds(result.updatedBlockIds)
  }
  useStore.setState((s) => ({ linksVersion: s.linksVersion + 1 }))
}

function schedulePageSave(id: string): void {
  const existing = pageSaveTimers.get(id)
  if (existing) clearTimeout(existing)
  pageSaveTimers.set(
    id,
    setTimeout(() => {
      pageSaveTimers.delete(id)
      const page = useStore.getState().pages.find((p) => p.id === id)
      if (!page) return
      // Write the pending block edits first, so the rename propagation lands on
      // top of the user's latest text instead of being overwritten by it.
      flushSaves()
      void window.api
        .updatePage({ id: page.id, title: page.title, icon: page.icon, cover: page.cover })
        .then((result) => {
          // A rename also rewrites the `[[old title]]` links inside other blocks'
          // bodies; pull the affected blocks back from the database into local state.
          return applyPageUpdate(result)
        })
        .catch((err) => console.error('保存页面失败', err))
    }, SAVE_DEBOUNCE)
  )
}

interface StoreState {
  pages: PageMeta[]
  currentPageId: string | null
  blocks: Block[]
  blocksLoading: boolean
  /**
   * Monotonic counter bumped whenever the resolution of the existing
   * `[[title]]` links may have changed.
   *
   * Block components and the link panel watch it to know that the links have to
   * be resolved again. A rename bumps it once the rename has been persisted,
   * not on every keystroke of the title.
   */
  linksVersion: number

  init: () => Promise<void>
  selectPage: (id: string | null, focusBlockId?: string) => Promise<void>
  createPage: (parentId?: string | null, title?: string) => Promise<string>
  renamePage: (id: string, title: string) => void
  setPageIcon: (id: string, icon: string | null) => void
  setPageCover: (id: string, cover: string | null) => void
  deletePage: (id: string) => Promise<void>
  /** Move a page: re-parent it, or reorder it among its siblings. */
  movePage: (id: string, parentId: string | null, index: number) => Promise<void>
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
  /** Sync the given blocks (possibly rewritten by a page rename) back into local state. */
  syncBlocksByIds: (ids: string[]) => Promise<void>
  /** Reload pages and blocks from the database after the AI assistant changed a note. */
  refreshFromAi: () => Promise<void>
}

export const useStore = create<StoreState>((set, get) => ({
  pages: [],
  currentPageId: null,
  blocks: [],
  blocksLoading: false,
  linksVersion: 0,

  init: async () => {
    const pages = await window.api.listPages()
    set({ pages })
    if (pages.length > 0) {
      await get().selectPage(pages[0].id)
    }
  },

  selectPage: async (id, focusBlockId) => {
    flushSaves()
    if (!id) {
      set({ currentPageId: null, blocks: [] })
      return
    }
    set({ currentPageId: id, blocksLoading: true })
    const blocks = await window.api.listBlocks(id)
    set({ blocks, blocksLoading: false })
    // Arriving from a backlink: scroll the referenced block into view.
    if (focusBlockId) requestScrollTo(focusBlockId)
  },

  createPage: async (parentId = null, title = '') => {
    const page = await window.api.createPage({ parentId, title })
    set((s) => ({ pages: [...s.pages, page], linksVersion: s.linksVersion + 1 }))
    await get().selectPage(page.id)
    return page.id
  },

  renamePage: (id, title) => {
    // The link version is deliberately not bumped here: the panel would then
    // re-query the whole database on every character of the title. It is
    // bumped once the rename has actually been persisted.
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, title } : p))
    }))
    schedulePageSave(id)
  },

  setPageIcon: (id, icon) => {
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, icon } : p)) }))
    void window.api.updatePage({ id, icon })
  },

  setPageCover: (id, cover) => {
    set((s) => ({ pages: s.pages.map((p) => (p.id === id ? { ...p, cover } : p)) }))
    void window.api.updatePage({ id, cover })
  },

  deletePage: async (id) => {
    const { pages, currentPageId } = get()
    // Collect the whole descendant subtree up front, so the sidebar can drop it
    // in one pass. The database does the actual deletion through its FK cascade.
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
    set((s) => ({ pages: remaining, linksVersion: s.linksVersion + 1 }))
    if (currentPageId && removed.has(currentPageId)) {
      await get().selectPage(remaining[0]?.id ?? null)
    }
  },

  movePage: async (id, parentId, index) => {
    // A pending title edit has to reach the database first: the move returns
    // the full page list, and the replacement would carry the stored (older)
    // title and silently undo the rename.
    await flushPageSaves()
    // Persist first, then replace the whole list, so the renderer never assembles
    // a tree that disagrees with the database.
    const pages = await window.api.movePage({ id, parentId, index })
    set({ pages })
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
        // Content fix-ups so the block matches its new type: a divider has no
        // text, and only a todo carries `checked`.
        const content: BlockContent = { ...b.content }
        if (type === 'database') {
          content.database ??= createDatabaseData()
          content.text = databaseToText(content.database)
        }
        if (type === 'divider') content.text = ''
        if (type !== 'todo') delete content.checked
        // Converting to a table seeds default data; converting away keeps that
        // data around, so switching back restores the previous table.
        if (type === 'table' && !content.table) {
          content.table = createTableData()
          content.text = tableToText(content.table)
        }
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
    // The list is filtered after the delete returns, so an edit made to another
    // block while the request was in flight is not discarded.
    const wasLast = get().blocks.length === 1 && get().blocks[0].id === id
    await window.api.deleteBlock(id)
    set((s) => ({ blocks: s.blocks.filter((b) => b.id !== id) }))
    if (wasLast) {
      // A page always keeps at least one block, so an empty page gets a fresh
      // empty paragraph instead of being left without any content.
      await get().insertBlockAfter(null, 'paragraph', { text: '' })
    }
  },

  setBlocksOrder: (orderedIds) => {
    const { blocks, currentPageId } = get()
    const byId = new Map(blocks.map((b) => [b.id, b]))
    // Positions are spaced by 1024, matching the database, so a block can still
    // be inserted between two neighbours later without renumbering the layer.
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

  syncBlocksByIds: async (ids) => {
    const { currentPageId, blocks } = get()
    if (!currentPageId || ids.length === 0) return
    const local = new Set(blocks.map((b) => b.id))
    const relevant = new Set(ids.filter((id) => local.has(id)))
    if (relevant.size === 0) return

    const fresh = await window.api.listBlocks(currentPageId)
    const byId = new Map(fresh.map((b) => [b.id, b]))
    // The database version wins over a pending local edit here: the rewrite
    // came from a rename, and keeping the stale text would leave the link
    // pointing at a page that no longer exists.
    for (const id of relevant) {
      if (byId.has(id)) cancelSave(id)
    }
    set((s) => ({
      blocks: s.blocks.map((b) => {
        if (!relevant.has(b.id)) return b
        const f = byId.get(b.id)
        if (!f) return b
        return { ...b, content: f.content }
      })
    }))
  },

  refreshFromAi: async () => {
    // A pending title edit has to reach the database first, for the same reason
    // as in movePage.
    await flushPageSaves()
    // The database is read before the local edits are written back, so an edit
    // that is still inside its debounce window is merged in rather than being
    // overwritten by the snapshot. The merge keeps the local version unless
    // the database was written after the local edit started — that is the AI
    // changing a block the user is typing in, and the database wins there.
    const pages = await window.api.listPages()
    const { currentPageId } = get()
    if (currentPageId && pages.some((p) => p.id === currentPageId)) {
      const fresh = await window.api.listBlocks(currentPageId)
      // The user may have switched pages while the snapshot was loading; in
      // that case the new page already holds its own blocks and must not be
      // overwritten with the previous page's ones.
      if (get().currentPageId !== currentPageId) return
      set((s) => ({
        pages,
        blocks: mergeFreshBlocks(fresh),
        linksVersion: s.linksVersion + 1
      }))
    } else {
      set((s) => ({ pages, linksVersion: s.linksVersion + 1 }))
      await get().selectPage(pages[0]?.id ?? null)
    }
  }
}))
