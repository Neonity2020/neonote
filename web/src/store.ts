import { create } from 'zustand'
import type { Block, BlockContent, BlockType, PageMeta } from '~/lib/shared'
import { createTableData, tableToText, createDatabaseData, databaseToText, WELCOME_SEED_BLOCKS, welcomeSeedContent, WELCOME_PAGE_TITLE } from '~/lib/shared'
import { requestScrollTo } from '~/lib/caret'
import * as local from '~/lib/local-db'
import { startSync, syncNow } from '~/lib/sync-engine'
import { dailyPageIdOf, ensureDailyPage, todayKey } from '~/lib/daily'

/** 兄弟顺序间隔,与数据库/服务端一致。 */
const POSITION_STEP = 1024

/** 主区域当前展示的面:普通页面编辑器,或日记模式。 */
export type ActiveView = 'pages' | 'daily'

interface StoreState {
  pages: PageMeta[]
  currentPageId: string | null
  blocks: Block[]
  blocksLoading: boolean
  activeView: ActiveView
  /** 日记视图选中的天(YYYY-MM-DD);null 时视图回退到今天。 */
  dailyDate: string | null
  /**
   * Monotonic counter bumped whenever the resolution of the existing
   * `[[title]]` links may have changed.
   *
   * Block components and the link panel watch it to know that the links have to
   * be resolved again. Bumped when pages appear/disappear locally and when a
   * remote sync merge touches page rows (a rename arriving from another device
   * re-points links); deliberately NOT bumped on every keystroke of a local
   * rename — that would re-query the link panel per character.
   */
  linksVersion: number

  init: () => Promise<void>
  selectPage: (id: string | null, focusBlockId?: string) => Promise<void>
  /** 从侧边栏进入日记模式;dayKey 缺省沿用上次选中的天,再缺省为今天。 */
  openDailyView: (dayKey?: string) => void
  /** 日记视图内切换选中日期;该天已有日记时把编辑器指向它。 */
  selectDailyDate: (dayKey: string) => void
  /** 为某天创建日记页(幂等)并选中。 */
  createDailyPage: (dayKey: string) => void
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
  /** Pull the authoritative state now (the AI path on desktop; a stub on web). */
  refreshFromAi: () => Promise<void>
}

export const useStore = create<StoreState>((set, get) => ({
  pages: [],
  currentPageId: null,
  blocks: [],
  blocksLoading: false,
  activeView: 'pages',
  dailyDate: null,
  linksVersion: 0,

  init: async () => {
    // 本地库是第一数据源:打开即渲染缓存,云端同步由后台引擎补齐。
    try {
      await local.openLocal()
    } catch (err) {
      console.error('打开本地数据库失败,本次会话将只依赖云端拉取', err)
    }
    const pages = local.allPages()
    const first = pages[0]?.id ?? null
    set({
      pages,
      currentPageId: first,
      blocks: first ? local.blocksOf(first) : [],
      blocksLoading: false,
    })
    startSync()
  },

  selectPage: async (id, focusBlockId) => {
    // 全部数据已在本地,切换页面即时完成。任何「打开某个页面」的入口
    // (侧边栏、搜索、反链)都意味着离开日记视图回到页面编辑器。
    set({
      activeView: 'pages',
      currentPageId: id,
      blocks: id ? local.blocksOf(id) : [],
      blocksLoading: false,
    })
    // Arriving from a backlink: scroll the referenced block into view.
    if (focusBlockId) requestScrollTo(focusBlockId)
  },

  openDailyView: (dayKey) => {
    const key = dayKey ?? get().dailyDate ?? todayKey()
    set({ activeView: 'daily', dailyDate: key })
    const page = local.pageById(dailyPageIdOf(key))
    if (page) {
      set({ currentPageId: page.id, blocks: local.blocksOf(page.id), blocksLoading: false })
    }
  },

  selectDailyDate: (dayKey) => {
    // 该天已有日记则让编辑器指向它(块编辑依赖 currentPageId);
    // 没有则保持现状,视图按 pages 投影显示创建空态。
    const page = local.pageById(dailyPageIdOf(dayKey))
    set({
      dailyDate: dayKey,
      ...(page
        ? { currentPageId: page.id, blocks: local.blocksOf(page.id), blocksLoading: false }
        : null),
    })
  },

  createDailyPage: (dayKey) => {
    ensureDailyPage(dayKey)
    set((s) => ({ linksVersion: s.linksVersion + 1 }))
    get().selectDailyDate(dayKey)
  },

  createPage: async (parentId = null, title = '') => {
    const ts = local.nextStamp()
    const siblings = local
      .allPages()
      .filter((p) => p.parentId === parentId)
    const position = Math.max(0, ...siblings.map((p) => p.position)) + POSITION_STEP
    const id = crypto.randomUUID()
    local.writePage({
      id,
      title,
      icon: null,
      cover: null,
      parentId,
      position,
      createdAt: ts,
      updatedAt: ts,
    })
    // 每个新页面以一个空段落块开始(与旧服务端行为一致)。
    local.writeBlock({
      id: crypto.randomUUID(),
      pageId: id,
      type: 'paragraph',
      content: { text: '' },
      position: POSITION_STEP,
      createdAt: ts,
      updatedAt: ts,
    })
    set((s) => ({ linksVersion: s.linksVersion + 1 }))
    await get().selectPage(id)
    return id
  },

  renamePage: (id, title) => {
    const p = local.pageById(id)
    if (!p) return
    local.writePage({ ...p, title })
  },

  setPageIcon: (id, icon) => {
    const p = local.pageById(id)
    if (!p) return
    local.writePage({ ...p, icon })
  },

  setPageCover: (id, cover) => {
    const p = local.pageById(id)
    if (!p) return
    local.writePage({ ...p, cover })
  },

  deletePage: async (id) => {
    // 子树页面与其全部块写墓碑;当前页被删后的导航由下方订阅统一处理。
    local.deletePageTreeLocal(id)
    set((s) => ({ linksVersion: s.linksVersion + 1 }))
  },

  movePage: async (id, parentId, index) => {
    const p = local.pageById(id)
    if (!p) return
    // 与服务端一致的插入位置:排除自身后按 index 取两邻中点/末尾追加。
    const siblings = local
      .allPages()
      .filter((x) => x.parentId === parentId && x.id !== id)
      .sort((a, b) => a.position - b.position)
    const clamped = Math.max(0, Math.min(index, siblings.length))
    const prev = siblings[clamped - 1]
    const next = siblings[clamped]
    const position =
      prev && next
        ? (prev.position + next.position) / 2
        : prev
          ? prev.position + POSITION_STEP
          : next
            ? next.position - POSITION_STEP
            : POSITION_STEP
    local.writePage({ ...p, parentId, position })
  },

  resetWelcomePage: async () => {
    const target = local
      .allPages()
      .find((p) => p.title === WELCOME_PAGE_TITLE)
    if (!target) {
      throw new Error(`未找到标题为 "${WELCOME_PAGE_TITLE}" 的欢迎页面`)
    }
    const ts = local.nextStamp()
    for (const b of local.blocksOf(target.id)) {
      local.deleteBlockLocal(b.id)
    }
    local.writeBlocks(
      WELCOME_SEED_BLOCKS.map((seed, i) => ({
        id: crypto.randomUUID(),
        pageId: target.id,
        type: seed.type,
        content: welcomeSeedContent(seed),
        position: (i + 1) * POSITION_STEP,
        createdAt: ts,
        updatedAt: ts,
      }))
    )
    // 页面行也推一把,让其他端的 updatedAt 提示刷新。
    local.writePage({ ...target })
  },

  updateBlockLocal: (id, content) => {
    const b = local.blockById(id)
    if (!b) return
    local.writeBlock({ ...b, content })
  },

  setBlockType: (id, type) => {
    const b = local.blockById(id)
    if (!b) return
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
    local.writeBlock({ ...b, type, content })
  },

  setBlockChecked: (id, checked) => {
    const b = local.blockById(id)
    if (!b) return
    local.writeBlock({ ...b, content: { ...b.content, checked } })
  },

  insertBlockAfter: async (afterId, type = 'paragraph', content = { text: '' }) => {
    const { currentPageId } = get()
    if (!currentPageId) return null
    const blocks = local.blocksOf(currentPageId)
    const ts = local.nextStamp()
    let position: number
    if (afterId) {
      const idx = blocks.findIndex((b) => b.id === afterId)
      const after = blocks[idx]
      const next = blocks[idx + 1]
      position =
        after && next
          ? (after.position + next.position) / 2
          : (after?.position ?? 0) + POSITION_STEP
    } else {
      position = (blocks[blocks.length - 1]?.position ?? 0) + POSITION_STEP
    }
    return local.writeBlock({
      id: crypto.randomUUID(),
      pageId: currentPageId,
      type,
      content,
      position,
      createdAt: ts,
      updatedAt: ts,
    })
  },

  removeBlock: async (id) => {
    const { currentPageId } = get()
    const pageBlocks = currentPageId ? local.blocksOf(currentPageId) : []
    // A page always keeps at least one block, so an empty page gets a fresh
    // empty paragraph instead of being left without any content.
    const wasLast = pageBlocks.length === 1 && pageBlocks[0].id === id
    local.deleteBlockLocal(id)
    if (wasLast) {
      await get().insertBlockAfter(null, 'paragraph', { text: '' })
    }
  },

  setBlocksOrder: (orderedIds) => {
    const reordered = orderedIds
      .map((id) => local.blockById(id))
      .filter((b): b is Block => b !== undefined)
    if (reordered.length === 0) return
    // Positions are spaced by 1024, matching the database, so a block can still
    // be inserted between two neighbours later without renumbering the layer.
    local.writeBlocks(reordered.map((b, i) => ({ ...b, position: (i + 1) * POSITION_STEP })))
  },

  refreshFromAi: async () => {
    await syncNow()
  },
}))

/**
 * local-db 是唯一数据源:store 只是它的内存投影。所有写动作走 local-db,
 * 由这里的订阅把变更(本地写穿与远端合并 alike)刷回 zustand 状态。
 */
local.subscribeLocal((ev) => {
  const s = useStore.getState()
  const patch: Partial<StoreState> = {}
  // 当前页在本次事件处理中可能被切换(比如它刚被删掉),块刷新必须跟随切换后的页面,
  // 否则会用旧页 id 把刚装好的块清空。
  let currentPageId = s.currentPageId
  if (ev.pages) {
    patch.pages = local.allPages()
    if (ev.origin === 'remote') {
      patch.linksVersion = s.linksVersion + 1
    }
    // 当前页被删(本机或另一端):切到剩余的第一个页面。
    // 首次启动时本地为空、拉取刚带回数据,当前还没有选中页,同样选第一页。
    if ((!currentPageId || !local.pageById(currentPageId)) && patch.pages.length > 0) {
      currentPageId = patch.pages[0].id
      patch.currentPageId = currentPageId
      patch.blocks = local.blocksOf(currentPageId)
    }
  }
  if (currentPageId && ev.blockPageIds.has(currentPageId)) {
    patch.blocks = local.blocksOf(currentPageId)
  }
  if (patch.pages !== undefined || patch.blocks !== undefined || patch.linksVersion !== undefined) {
    useStore.setState(patch)
  }
})
