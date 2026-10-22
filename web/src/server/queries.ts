// 纯服务端数据访问辅助函数。只允许被 server fn 模块和服务器路由引用，
// 绝不能进入客户端 import 图（这里拖着 drizzle / libsql）。
import { and, asc, eq, ne, sql } from 'drizzle-orm'

import { randomUUID } from 'node:crypto'
import { getDb } from '~/lib/db'
import { block, page, asset } from '~/db/schema'
import { getSession } from './session'
import {
  parseWikiLinks,
  replaceWikiLinkTitle,
  tableToText,
  WELCOME_PAGE_TITLE,
} from '~/lib/shared'
import type {
  Block,
  BlockContent,
  BlockType,
  PageMeta,
  TableData,
} from '~/lib/shared'

// 与 Electron 版一致：兄弟顺序间隔 1024，插入取中点，单次插入不用重排整层。
export const POSITION_STEP = 1024

export async function requireUser(): Promise<string> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  return session.user.id
}

export function now(): number {
  return Date.now()
}

type PageRow = typeof page.$inferSelect
type BlockRow = typeof block.$inferSelect

// 行的其余字段正好就是 PageMeta 的形状（userId 之外）。
export function pageFromRow(row: PageRow): PageMeta {
  return {
    id: row.id,
    title: row.title,
    icon: row.icon,
    parentId: row.parentId,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function blockFromRow(row: BlockRow): Block {
  let content: BlockContent = {}
  try {
    content = JSON.parse(row.content) as BlockContent
  } catch {
    content = { text: row.content }
  }
  return {
    id: row.id,
    pageId: row.pageId,
    type: row.type as BlockType,
    content,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function createPageRow(
  userId: string,
  parentId: string | null,
  title: string,
): Promise<PageMeta> {
  const id = randomUUID()
  const ts = now()
  const [max] = await getDb()
    .select({ m: sql<number | null>`max(${page.position})` })
    .from(page)
    .where(
      parentId
        ? and(eq(page.userId, userId), eq(page.parentId, parentId))
        : and(eq(page.userId, userId), sql`${page.parentId} IS NULL`),
    )
  const position = (max?.m ?? 0) + POSITION_STEP
  await getDb().insert(page).values({ id, title, icon: null, parentId, position, createdAt: ts, updatedAt: ts, userId })
  // 每个新页面以一个空段落块开始
  await insertBlockRow(userId, { pageId: id, type: 'paragraph', content: { text: '' }, afterId: null })
  return { id, title, icon: null, parentId, position, createdAt: ts, updatedAt: ts }
}

/** 确认页面属于当前用户；不属于时抛错。 */
export async function requireOwnedPage(userId: string, pageId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: page.id })
    .from(page)
    .where(and(eq(page.id, pageId), eq(page.userId, userId)))
  if (!row) throw new Error('页面不存在')
}

export async function touchPage(userId: string, pageId: string, ts: number): Promise<void> {
  await getDb()
    .update(page)
    .set({ updatedAt: ts })
    .where(and(eq(page.id, pageId), eq(page.userId, userId)))
}

export interface InsertBlockInput {
  pageId: string
  type?: BlockType
  content?: BlockContent
  afterId?: string | null
}

/**
 * 插入一个块：afterId 给定时取两邻块中点，否则接在末尾。
 * 页面权属由调用方保证（server fn 入口和种子流程各自校验）。
 */
export async function insertBlockRow(userId: string, input: InsertBlockInput): Promise<Block> {
  const id = randomUUID()
  const ts = now()
  const db = getDb()
  let position: number
  if (input.afterId) {
    const [after] = await db
      .select({ position: block.position })
      .from(block)
      .where(and(eq(block.id, input.afterId), eq(block.userId, userId)))
    const [next] = await db
      .select({ position: block.position })
      .from(block)
      .where(
        and(
          eq(block.userId, userId),
          eq(block.pageId, input.pageId),
          sql`${block.position} > ${after?.position ?? 0}`,
        ),
      )
      .orderBy(asc(block.position))
      .limit(1)
    if (after && next) {
      position = (after.position + next.position) / 2
    } else {
      position = (after?.position ?? 0) + POSITION_STEP
    }
  } else {
    const [max] = await db
      .select({ m: sql<number | null>`max(${block.position})` })
      .from(block)
      .where(and(eq(block.userId, userId), eq(block.pageId, input.pageId)))
    position = (max?.m ?? 0) + POSITION_STEP
  }
  const content = JSON.stringify(input.content ?? { text: '' })
  const type = input.type ?? 'paragraph'
  await db.insert(block).values({
    id,
    pageId: input.pageId,
    type,
    content,
    position,
    createdAt: ts,
    updatedAt: ts,
    userId,
  })
  await touchPage(userId, input.pageId, ts)
  return {
    id,
    pageId: input.pageId,
    type,
    content: input.content ?? { text: '' },
    position,
    createdAt: ts,
    updatedAt: ts,
  }
}

// ---------- 欢迎页种子（复刻 Electron 版） ----------

export const WELCOME_SEED_BLOCKS: Array<{ type: BlockType; text: string; checked?: boolean; table?: TableData }> = [
  { type: 'paragraph', text: '这是一个本地优先的块笔记应用,所有数据保存在本机 SQLite 数据库中。' },
  { type: 'heading1', text: '快速上手' },
  { type: 'bulletedList', text: '按 Enter 新建一个块' },
  { type: 'bulletedList', text: '在空块中输入 / 唤起命令菜单,切换块类型' },
  { type: 'bulletedList', text: '支持 Markdown 快捷输入:试试输入 # 加空格' },
  { type: 'heading2', text: '支持的块类型' },
  { type: 'numberedList', text: '段落、一到三级标题' },
  { type: 'numberedList', text: '无序 / 有序列表' },
  { type: 'numberedList', text: '待办事项、引用、代码块、分割线' },
  {
    type: 'table',
    text: '',
    table: {
      header: true,
      rows: [
        ['块类型', '说明'],
        ['文本', '段落、标题、列表、待办'],
        ['表格', '就是这张表,可以增删行列'],
      ],
    },
  },
  { type: 'todo', text: '试试勾选这个待办事项', checked: false },
  { type: 'todo', text: '已完成的事项会显示删除线', checked: true },
  { type: 'quote', text: '块可以拖动左侧手柄重新排序。' },
  { type: 'code', text: 'function hello() {\n  console.log("Hello, Notion Clone!")\n}' },
  { type: 'divider', text: '' },
  { type: 'paragraph', text: '在左侧边栏可以新建页面、组织层级、搜索全部内容。开始写作吧!' },
]

function seedContent(seed: { text: string; checked?: boolean; table?: TableData }): BlockContent {
  return {
    text: seed.table ? tableToText(seed.table) : seed.text,
    checked: seed.checked,
    ...(seed.table ? { table: seed.table } : {}),
  }
}

// 用户第一次进入工作区时种出欢迎页（Electron 版在数据库初始化时做，Web 版按用户做）。
export async function seedIfEmpty(userId: string): Promise<void> {
  const [row] = await getDb()
    .select({ c: sql<number>`count(*)` })
    .from(page)
    .where(eq(page.userId, userId))
  if ((row?.c ?? 0) > 0) return

  const created = await createPageRow(userId, null, WELCOME_PAGE_TITLE)
  await getDb().update(page).set({ icon: '👋' }).where(eq(page.id, created.id))

  let lastId: string | null = null
  for (const seed of WELCOME_SEED_BLOCKS) {
    const blockRow = await insertBlockRow(userId, {
      pageId: created.id,
      type: seed.type,
      content: seedContent(seed),
      afterId: lastId,
    })
    lastId = blockRow.id
  }
}

/**
 * 改标题时把指向旧标题的 wiki 链接一并改写（Electron 版同名逻辑）。
 * 旧标题或新标题不唯一时跳过改写，避免链接被静默改指到同名页面。
 */
export async function propagateTitleRename(
  userId: string,
  pageId: string,
  oldTitle: string,
  newTitle: string,
): Promise<string[]> {
  const db = getDb()
  const [dupOld] = await db
    .select({ c: sql<number>`count(*)` })
    .from(page)
    .where(
      and(
        eq(page.userId, userId),
        ne(page.id, pageId),
        sql`lower(${page.title}) = lower(${oldTitle})`,
      ),
    )
  if ((dupOld?.c ?? 0) > 0) return []

  const [dupNew] = await db
    .select({ c: sql<number>`count(*)` })
    .from(page)
    .where(
      and(
        eq(page.userId, userId),
        ne(page.id, pageId),
        sql`lower(${page.title}) = lower(${newTitle})`,
      ),
    )
  if ((dupNew?.c ?? 0) > 0) return []

  const rows = await db
    .select({ id: block.id, pageId: block.pageId, content: block.content })
    .from(block)
    .where(and(eq(block.userId, userId), sql`instr(${block.content}, '[[') > 0`))

  const updated: string[] = []
  const ts = now()
  const touchedPages = new Set<string>()
  for (const row of rows) {
    let content: BlockContent
    try {
      content = JSON.parse(row.content) as BlockContent
    } catch {
      content = { text: row.content }
    }
    const text = content.text ?? ''
    if (!text.toLowerCase().includes(oldTitle.toLowerCase())) continue
    const next = replaceWikiLinkTitle(text, oldTitle, newTitle)
    if (next === text) continue
    await db
      .update(block)
      .set({ content: JSON.stringify({ ...content, text: next }), updatedAt: ts })
      .where(eq(block.id, row.id))
    updated.push(row.id)
    touchedPages.add(row.pageId)
  }
  for (const pid of touchedPages) {
    await db.update(page).set({ updatedAt: ts }).where(and(eq(page.id, pid), eq(page.userId, userId)))
  }
  return updated
}

/** candidateId 是否是 targetId 自身或其子孙（防止把页面移进自己的子树形成环）。 */
export async function isSelfOrDescendant(
  userId: string,
  candidateId: string,
  targetId: string,
): Promise<boolean> {
  const db = getDb()
  let cur: string | null = candidateId
  const seen = new Set<string>()
  while (cur) {
    if (cur === targetId) return true
    if (seen.has(cur)) return false
    seen.add(cur)
    const [row] = await db
      .select({ parentId: page.parentId })
      .from(page)
      .where(and(eq(page.id, cur), eq(page.userId, userId)))
    cur = row?.parentId ?? null
  }
  return false
}

// ---------- 资产 ----------

/** 读取资产字节（供 /api/asset/$id 路由使用）。权属校验：仅本人可读。 */
export async function getAssetBytes(
  userId: string,
  id: string,
): Promise<{ mime: string; buffer: ArrayBuffer } | null> {
  const [row] = await getDb()
    .select({ mime: asset.mime, data: asset.data })
    .from(asset)
    .where(and(eq(asset.id, id), eq(asset.userId, userId)))
    .limit(1)
  if (!row) return null
  const buf = Buffer.from(row.data, 'base64')
  // 复制到独立的 ArrayBuffer，作为 Response body（workers 的 BodyInit 类型）。
  const out = new ArrayBuffer(buf.byteLength)
  new Uint8Array(out).set(buf)
  return { mime: row.mime, buffer: out }
}

/** 收集仍被图片块引用的资产 id（预留：GC 未在 Web 版启用）。 */
export async function listImageAssetIds(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ content: block.content })
    .from(block)
    .where(and(eq(block.userId, userId), eq(block.type, 'image')))
  const ids = new Set<string>()
  for (const row of rows) {
    try {
      const content = JSON.parse(row.content) as { src?: string }
      const match = content.src?.match(/\/api\/asset\/([a-f0-9-]+)$/)
      if (match) ids.add(match[1])
    } catch {
      // 忽略损坏的 content
    }
  }
  return ids
}
