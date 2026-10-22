// 本文件只允许导出 createServerFn 对象（客户端会原样 import 这个模块，
// 其他导出会把 drizzle/libsql 拖进浏览器 bundle）。纯辅助函数在 queries.ts。
import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'

import { randomUUID } from 'node:crypto'
import { getDb } from '~/lib/db'
import { block, page } from '~/db/schema'
import {
  buildPageTitleIndex,
  lookupPageByTitle,
  parseWikiLinks,
  stripWikiLinkMarkers,
  tableToText,
  WELCOME_PAGE_TITLE,
} from '~/lib/shared'
import type {
  BacklinkRef,
  BlockContent,
  CreatePageInput,
  MovePageInput,
  OutgoingLink,
  PageLinks,
  PageMeta,
  PageUpdateResult,
  SearchResult,
  UpdatePageInput,
} from '~/lib/shared'
import {
  POSITION_STEP,
  requireUser,
  now,
  pageFromRow,
  createPageRow,
  seedIfEmpty,
  propagateTitleRename,
  isSelfOrDescendant,
  WELCOME_SEED_BLOCKS,
} from './queries'
import type { TableData } from '~/lib/shared'

/** 种子块转块内容：表格摊平成纯文本存进 content.text（与 Electron 版一致）。 */
function seedContent(seed: { text: string; checked?: boolean; table?: TableData }): BlockContent {
  return {
    text: seed.table ? tableToText(seed.table) : seed.text,
    checked: seed.checked,
    ...(seed.table ? { table: seed.table } : {}),
  }
}

export const listPages = createServerFn({ method: 'GET' }).handler(async (): Promise<PageMeta[]> => {
  const userId = await requireUser()
  await seedIfEmpty(userId)
  const rows = await getDb()
    .select()
    .from(page)
    .where(eq(page.userId, userId))
    // 顶层页面排前面，各组内部按 position（与 Electron 版 ORDER BY 一致）。
    .orderBy(sql`${page.parentId} IS NOT NULL`, asc(page.position))
  return rows.map(pageFromRow)
})

export const createPage = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as CreatePageInput)
  .handler(async ({ data }): Promise<PageMeta> => {
    const userId = await requireUser()
    return createPageRow(userId, data.parentId ?? null, data.title ?? '')
  })

export const updatePage = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as UpdatePageInput)
  .handler(async ({ data }): Promise<PageUpdateResult> => {
    const userId = await requireUser()
    const ts = now()
    const db = getDb()
    const updatedBlockIds: string[] = []
    if (data.title !== undefined) {
      const [row] = await db
        .select({ title: page.title })
        .from(page)
        .where(and(eq(page.id, data.id), eq(page.userId, userId)))
      await db
        .update(page)
        .set({ title: data.title, updatedAt: ts })
        .where(and(eq(page.id, data.id), eq(page.userId, userId)))
      if (row && row.title && row.title !== data.title) {
        updatedBlockIds.push(...(await propagateTitleRename(userId, data.id, row.title, data.title)))
      }
    }
    if (data.icon !== undefined) {
      await db
        .update(page)
        .set({ icon: data.icon, updatedAt: ts })
        .where(and(eq(page.id, data.id), eq(page.userId, userId)))
    }
    if (data.cover !== undefined) {
      await db
        .update(page)
        .set({ cover: data.cover, updatedAt: ts })
        .where(and(eq(page.id, data.id), eq(page.userId, userId)))
    }
    return { updatedBlockIds }
  })

export const deletePage = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as string)
  .handler(async ({ data: id }): Promise<void> => {
    const userId = await requireUser()
    const db = getDb()
    // 先收集整个子树，再在同一事务里显式删除块和页面（不依赖 FK 级联）。
    const rows = await db
      .select({ id: page.id, parentId: page.parentId })
      .from(page)
      .where(eq(page.userId, userId))
    const removed = new Set<string>([id])
    let changed = true
    while (changed) {
      changed = false
      for (const r of rows) {
        if (r.parentId && removed.has(r.parentId) && !removed.has(r.id)) {
          removed.add(r.id)
          changed = true
        }
      }
    }
    const ids = [...removed]
    await db.transaction(async (tx) => {
      await tx.delete(block).where(inArray(block.pageId, ids))
      await tx.delete(page).where(inArray(page.id, ids))
    })
  })

export const movePage = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as MovePageInput)
  .handler(async ({ data }): Promise<PageMeta[]> => {
    const userId = await requireUser()
    const db = getDb()
    const { id, parentId } = data
    const [exists] = await db
      .select({ id: page.id })
      .from(page)
      .where(and(eq(page.id, id), eq(page.userId, userId)))
    if (!exists) throw new Error('页面不存在')
    if (parentId === id) throw new Error('不能把页面移动到它自己下面')
    if (parentId && (await isSelfOrDescendant(userId, parentId, id))) {
      throw new Error('不能把页面移动到它自己的子页面下面')
    }

    const siblings = await db
      .select({ id: page.id, position: page.position })
      .from(page)
      .where(
        and(
          eq(page.userId, userId),
          ne(page.id, id),
          parentId ? eq(page.parentId, parentId) : sql`${page.parentId} IS NULL`,
        ),
      )
      .orderBy(asc(page.position))

    const index = Math.max(0, Math.min(data.index, siblings.length))
    const prev = siblings[index - 1]
    const next = siblings[index]
    let position: number
    if (prev && next) {
      position = (prev.position + next.position) / 2
    } else if (prev) {
      position = prev.position + POSITION_STEP
    } else if (next) {
      position = next.position - POSITION_STEP
    } else {
      position = POSITION_STEP
    }

    await db
      .update(page)
      .set({ parentId, position, updatedAt: now() })
      .where(and(eq(page.id, id), eq(page.userId, userId)))

    const rows = await db
      .select()
      .from(page)
      .where(eq(page.userId, userId))
      .orderBy(sql`${page.parentId} IS NOT NULL`, asc(page.position))
    return rows.map(pageFromRow)
  })

/**
 * 重新种出欢迎页的示例块：页面本身保留（id、标题、图标不变）。
 * 找不到欢迎页时抛错（与 Electron 版一致）。
 */
export const resetWelcomePage = createServerFn({ method: 'POST' }).handler(
  async (): Promise<PageMeta> => {
    const userId = await requireUser()
    const db = getDb()
    const [row] = await db
      .select()
      .from(page)
      .where(and(eq(page.userId, userId), eq(page.title, WELCOME_PAGE_TITLE)))
      .orderBy(asc(page.createdAt))
      .limit(1)
    if (!row) {
      throw new Error(`未找到标题为 "${WELCOME_PAGE_TITLE}" 的欢迎页面`)
    }

    const ts = now()
    await db.transaction(async (tx) => {
      await tx.delete(block).where(eq(block.pageId, row.id))
      let position = POSITION_STEP
      for (const seed of WELCOME_SEED_BLOCKS) {
        await tx.insert(block).values({
          id: randomUUID(),
          pageId: row.id,
          type: seed.type,
          content: JSON.stringify(seedContent(seed)),
          position,
          createdAt: ts,
          updatedAt: ts,
          userId,
        })
        position += POSITION_STEP
      }
      await tx.update(page).set({ updatedAt: ts }).where(eq(page.id, row.id))
    })

    return { ...pageFromRow(row), updatedAt: ts }
  },
)

/** 转义 LIKE 通配符，让 "100%"、"a_b" 按字面匹配。 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export const search = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as string)
  .handler(async ({ data: query }): Promise<SearchResult[]> => {
    const userId = await requireUser()
    const db = getDb()
    const q = `%${escapeLike(query)}%`
    const results: SearchResult[] = []

    const pageRows = await db
      .select({ id: page.id, title: page.title, icon: page.icon })
      .from(page)
      .where(and(eq(page.userId, userId), sql`${page.title} LIKE ${q} ESCAPE '\\'`))
      .orderBy(desc(page.updatedAt))
      .limit(20)
    for (const row of pageRows) {
      results.push({
        pageId: row.id,
        pageTitle: row.title || '无标题',
        pageIcon: row.icon,
        blockId: null,
        snippet: row.title || '无标题',
      })
    }

    const blockRows = await db
      .select({
        blockId: block.id,
        pageId: block.pageId,
        pageTitle: page.title,
        pageIcon: page.icon,
        text: sql<string | null>`json_extract(${block.content}, '$.text')`,
      })
      .from(block)
      .innerJoin(page, eq(page.id, block.pageId))
      .where(
        and(
          eq(block.userId, userId),
          sql`json_extract(${block.content}, '$.text') LIKE ${q} ESCAPE '\\'`,
        ),
      )
      .orderBy(desc(block.updatedAt))
      .limit(30)
    for (const row of blockRows) {
      const text = row.text ?? ''
      // 命中位置前后各留一段窗口，两端被截断时补省略号。
      const idx = text.toLowerCase().indexOf(query.toLowerCase())
      const start = Math.max(0, idx - 20)
      const snippet =
        (start > 0 ? '…' : '') + text.slice(start, start + 60) + (start + 60 < text.length ? '…' : '')
      results.push({
        pageId: row.pageId,
        pageTitle: row.pageTitle || '无标题',
        pageIcon: row.pageIcon,
        blockId: row.blockId,
        snippet,
      })
    }

    return results
  })

function makeSnippet(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function textOf(content: string): string {
  try {
    const parsed = JSON.parse(content) as BlockContent
    return parsed.text ?? ''
  } catch {
    return content
  }
}

export const getPageLinks = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as string)
  .handler(async ({ data: pageId }): Promise<PageLinks> => {
    const userId = await requireUser()
    const db = getDb()
    const pages = (await db.select().from(page).where(eq(page.userId, userId))).map(pageFromRow)
    const target = pages.find((p) => p.id === pageId)
    if (!target) return { outgoing: [], backlinks: [] }
    const titleIndex = buildPageTitleIndex(pages)

    // 出链：本页面块里的 [[标题]]
    const outgoingMap = new Map<string, OutgoingLink>()
    const ownBlocks = await db
      .select({ id: block.id, content: block.content })
      .from(block)
      .where(and(eq(block.userId, userId), eq(block.pageId, pageId)))
      .orderBy(asc(block.position))
    for (const blockRow of ownBlocks) {
      let content: BlockContent
      try {
        content = JSON.parse(blockRow.content) as BlockContent
      } catch {
        content = { text: blockRow.content }
      }
      const text = content.text ?? ''
      for (const link of parseWikiLinks(text)) {
        const hit = lookupPageByTitle(titleIndex, link.title)
        const existing = outgoingMap.get(link.title)
        if (existing) {
          if (!existing.blockIds.includes(blockRow.id)) existing.blockIds.push(blockRow.id)
        } else {
          outgoingMap.set(link.title, {
            title: link.title,
            pageId: hit?.id ?? null,
            pageIcon: hit?.icon ?? null,
            blockIds: [blockRow.id],
          })
        }
      }
    }

    // 反链：其他页面里指向本页的块。先按 '[[' 粗筛再解析。
    const rows = await db
      .select({
        blockId: block.id,
        pageId: block.pageId,
        content: block.content,
        pageTitle: page.title,
        pageIcon: page.icon,
      })
      .from(block)
      .innerJoin(page, eq(page.id, block.pageId))
      .where(and(eq(block.userId, userId), sql`instr(${block.content}, '[[') > 0`))
      .orderBy(desc(block.updatedAt))

    const backlinks: BacklinkRef[] = []
    for (const row of rows) {
      if (row.pageId === pageId) continue
      const text = textOf(row.content)
      if (!text) continue
      const links = parseWikiLinks(text)
      if (links.length === 0) continue
      if (!links.some((l) => lookupPageByTitle(titleIndex, l.title)?.id === target.id)) continue
      backlinks.push({
        blockId: row.blockId,
        pageId: row.pageId,
        pageTitle: row.pageTitle || '无标题',
        pageIcon: row.pageIcon,
        snippet: makeSnippet(stripWikiLinkMarkers(text)),
      })
    }

    return { outgoing: [...outgoingMap.values()], backlinks }
  })
