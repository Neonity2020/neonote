import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import type {
  BacklinkRef,
  Block,
  BlockContent,
  BlockType,
  CreateBlockInput,
  CreatePageInput,
  MovePageInput,
  OutgoingLink,
  PageLinks,
  PageMeta,
  PageUpdateResult,
  SearchResult,
  TableData,
  UpdateBlockInput,
  UpdatePageInput
} from '@neonity/notion-clone-shared'
import {
  buildPageTitleIndex,
  lookupPageByTitle,
  parseWikiLinks,
  replaceWikiLinkTitle,
  stripWikiLinkMarkers,
  tableToText,
  WELCOME_PAGE_TITLE
} from '@neonity/notion-clone-shared'

const POSITION_STEP = 1024

let db: DatabaseSync

function now(): number {
  return Date.now()
}

export function initDb(): void {
  const dbPath = join(app.getPath('userData'), 'notion-clone.db')
  db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      icon TEXT,
      parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
      position REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'paragraph',
      content TEXT NOT NULL DEFAULT '{}',
      position REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(page_id, position);
    CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, position);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  seedIfEmpty()
}

interface PageRow {
  id: string
  title: string
  icon: string | null
  parent_id: string | null
  position: number
  created_at: number
  updated_at: number
}

interface BlockRow {
  id: string
  page_id: string
  type: string
  content: string
  position: number
  created_at: number
  updated_at: number
}

function pageFromRow(row: PageRow): PageMeta {
  return {
    id: row.id,
    title: row.title,
    icon: row.icon,
    parentId: row.parent_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function blockFromRow(row: BlockRow): Block {
  let content: BlockContent = {}
  try {
    content = JSON.parse(row.content) as BlockContent
  } catch {
    content = { text: row.content }
  }
  return {
    id: row.id,
    pageId: row.page_id,
    type: row.type as BlockType,
    content,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function touchPage(pageId: string, ts: number): void {
  db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run(ts, pageId)
}

// ---------- Pages ----------

export function listPages(): PageMeta[] {
  const rows = db
    .prepare('SELECT * FROM pages ORDER BY parent_id IS NOT NULL, position')
    .all() as unknown as PageRow[]
  return rows.map(pageFromRow)
}

export function createPage(input: CreatePageInput): PageMeta {
  const id = randomUUID()
  const ts = now()
  const parentId = input.parentId ?? null
  const maxPos = parentId
    ? (db.prepare('SELECT MAX(position) AS m FROM pages WHERE parent_id = ?').get(parentId) as { m: number | null }).m
    : (db.prepare('SELECT MAX(position) AS m FROM pages WHERE parent_id IS NULL').get() as { m: number | null }).m
  const position = (maxPos ?? 0) + POSITION_STEP
  db.prepare(
    'INSERT INTO pages (id, title, icon, parent_id, position, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)'
  ).run(id, input.title ?? '', parentId, position, ts, ts)
  // Every new page starts with one empty paragraph block
  insertBlock({ pageId: id, type: 'paragraph', content: { text: '' }, afterId: null })
  return {
    id,
    title: input.title ?? '',
    icon: null,
    parentId,
    position,
    createdAt: ts,
    updatedAt: ts
  }
}

export function updatePage(input: UpdatePageInput): PageUpdateResult {
  const ts = now()
  const updatedBlockIds: string[] = []
  if (input.title !== undefined) {
    const row = db.prepare('SELECT title FROM pages WHERE id = ?').get(input.id) as
      | { title: string }
      | undefined
    db.prepare('UPDATE pages SET title = ?, updated_at = ? WHERE id = ?').run(input.title, ts, input.id)
    // 标题变了,指向旧标题的双链要跟着改,否则链接会指向一个不存在的页面
    if (row && row.title && row.title !== input.title) {
      updatedBlockIds.push(...propagateTitleRename(input.id, row.title, input.title))
    }
  }
  if (input.icon !== undefined) {
    db.prepare('UPDATE pages SET icon = ?, updated_at = ? WHERE id = ?').run(input.icon, ts, input.id)
  }
  return { updatedBlockIds }
}

/**
 * 页面改名后,同步改写全库指向旧标题的双链,返回被改写的块 id。
 *
 * 只有旧标题在库里唯一时才改写:存在同名页面时,`[[旧标题]]` 究竟指哪一个页面
 * 是不确定的,贸然改写反而会把链接指错。不确定就保持原样 ——
 * 链接要么落到同名页上,要么显示为"未创建",都由用户自己收拾。
 */
function propagateTitleRename(pageId: string, oldTitle: string, newTitle: string): string[] {
  const dup = db.prepare('SELECT COUNT(*) AS c FROM pages WHERE title = ? AND id != ?').get(oldTitle, pageId) as {
    c: number
  }
  if (dup.c > 0) return []

  const rows = db.prepare("SELECT id, page_id, content FROM blocks WHERE instr(content, '[[') > 0").all() as unknown as Array<{
    id: string
    page_id: string
    content: string
  }>

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
    if (!text.includes(oldTitle)) continue
    const next = replaceWikiLinkTitle(text, oldTitle, newTitle)
    if (next === text) continue
    db.prepare('UPDATE blocks SET content = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify({ ...content, text: next }),
      ts,
      row.id
    )
    updated.push(row.id)
    touchedPages.add(row.page_id)
  }
  for (const pid of touchedPages) touchPage(pid, ts)
  return updated
}

export function deletePage(id: string): void {
  // FK cascade removes child pages and their blocks
  db.prepare('DELETE FROM pages WHERE id = ?').run(id)
}

/** candidate 是否等于 target 或位于 target 的子树中(用于阻止把页面拖进自己的后代) */
function isSelfOrDescendant(candidateId: string, targetId: string): boolean {
  let cur: string | null = candidateId
  const seen = new Set<string>()
  while (cur) {
    if (cur === targetId) return true
    if (seen.has(cur)) return false
    seen.add(cur)
    const row = db.prepare('SELECT parent_id AS pid FROM pages WHERE id = ?').get(cur) as
      | { pid: string | null }
      | undefined
    cur = row?.pid ?? null
  }
  return false
}

/**
 * 移动页面:改父级 + 在目标父级的兄弟序列里插入到 index 位置。
 * position 用前后邻居的中点,避免为了插入一个节点重写整层。
 */
export function movePage(input: MovePageInput): PageMeta[] {
  const { id, parentId } = input
  if (!db.prepare('SELECT 1 FROM pages WHERE id = ?').get(id)) {
    throw new Error('页面不存在')
  }
  if (parentId === id) throw new Error('不能把页面移动到它自己下面')
  if (parentId && isSelfOrDescendant(parentId, id)) {
    throw new Error('不能把页面移动到它自己的子页面下面')
  }

  const siblings = db
    .prepare('SELECT id, position FROM pages WHERE parent_id IS ? AND id != ? ORDER BY position')
    .all(parentId, id) as unknown as Array<{ id: string; position: number }>

  const index = Math.max(0, Math.min(input.index, siblings.length))
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

  db.prepare('UPDATE pages SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?').run(
    parentId,
    position,
    now(),
    id
  )
  return listPages()
}

// ---------- Blocks ----------

export function listBlocks(pageId: string): Block[] {
  const rows = db
    .prepare('SELECT * FROM blocks WHERE page_id = ? ORDER BY position')
    .all(pageId) as unknown as BlockRow[]
  return rows.map(blockFromRow)
}

function insertBlock(input: CreateBlockInput): Block {
  const id = randomUUID()
  const ts = now()
  let position: number
  if (input.afterId) {
    const after = db.prepare('SELECT position FROM blocks WHERE id = ?').get(input.afterId) as
      | { position: number }
      | undefined
    const next = db
      .prepare('SELECT position FROM blocks WHERE page_id = ? AND position > ? ORDER BY position LIMIT 1')
      .get(input.pageId, after?.position ?? 0) as { position: number } | undefined
    if (after && next) {
      position = (after.position + next.position) / 2
    } else {
      position = (after?.position ?? 0) + POSITION_STEP
    }
  } else {
    const maxPos = (
      db.prepare('SELECT MAX(position) AS m FROM blocks WHERE page_id = ?').get(input.pageId) as {
        m: number | null
      }
    ).m
    position = (maxPos ?? 0) + POSITION_STEP
  }
  const content = JSON.stringify(input.content ?? { text: '' })
  db.prepare(
    'INSERT INTO blocks (id, page_id, type, content, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, input.pageId, input.type ?? 'paragraph', content, position, ts, ts)
  touchPage(input.pageId, ts)
  return {
    id,
    pageId: input.pageId,
    type: input.type ?? 'paragraph',
    content: input.content ?? { text: '' },
    position,
    createdAt: ts,
    updatedAt: ts
  }
}

export function createBlock(input: CreateBlockInput): Block {
  return insertBlock(input)
}

export function getBlock(id: string): Block | undefined {
  const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id) as BlockRow | undefined
  return row ? blockFromRow(row) : undefined
}

export function updateBlock(input: UpdateBlockInput): void {
  const ts = now()
  const row = db.prepare('SELECT page_id FROM blocks WHERE id = ?').get(input.id) as
    | { page_id: string }
    | undefined
  if (!row) return
  if (input.type !== undefined) {
    db.prepare('UPDATE blocks SET type = ?, updated_at = ? WHERE id = ?').run(input.type, ts, input.id)
  }
  if (input.content !== undefined) {
    db.prepare('UPDATE blocks SET content = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(input.content),
      ts,
      input.id
    )
  }
  touchPage(row.page_id, ts)
}

export function deleteBlock(id: string): void {
  const row = db.prepare('SELECT page_id FROM blocks WHERE id = ?').get(id) as
    | { page_id: string }
    | undefined
  db.prepare('DELETE FROM blocks WHERE id = ?').run(id)
  if (row) touchPage(row.page_id, now())
}

export function reorderBlocks(pageId: string, orderedIds: string[]): void {
  const ts = now()
  const stmt = db.prepare('UPDATE blocks SET position = ?, updated_at = ? WHERE id = ? AND page_id = ?')
  db.exec('BEGIN')
  try {
    orderedIds.forEach((id, index) => {
      stmt.run((index + 1) * POSITION_STEP, ts, id, pageId)
    })
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  touchPage(pageId, ts)
}

/** Collect asset file ids still referenced by image blocks (for garbage collection). */
export function listImageAssetIds(): Set<string> {
  const rows = db.prepare("SELECT content FROM blocks WHERE type = 'image'").all() as unknown as Array<{
    content: string
  }>
  const ids = new Set<string>()
  for (const row of rows) {
    try {
      const content = JSON.parse(row.content) as { src?: string }
      const match = content.src?.match(/^nc-asset:\/\/asset\/(.+)$/)
      if (match) ids.add(match[1])
    } catch {
      // ignore malformed content
    }
  }
  return ids
}

// ---------- Settings (raw key/value) ----------

/** 读取全部设置分区,值是反序列化后的对象;解析失败的条目会被忽略 */
export function loadSettingsRaw(): Record<string, unknown> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as Array<{
    key: string
    value: string
  }>
  const out: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      out[row.key] = JSON.parse(row.value)
    } catch {
      // 忽略损坏的条目,回落到默认值
    }
  }
  return out
}

export function saveSettingsSection(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), now())
}

export function clearSettings(): void {
  db.prepare('DELETE FROM settings').run()
}

/** 页面 / 块数量统计(设置面板用) */
export function countRows(): { pages: number; blocks: number } {
  const pages = (db.prepare('SELECT COUNT(*) AS c FROM pages').get() as { c: number }).c
  const blocks = (db.prepare('SELECT COUNT(*) AS c FROM blocks').get() as { c: number }).c
  return { pages, blocks }
}

// ---------- Search ----------

export function search(query: string): SearchResult[] {
  const q = `%${query}%`
  const results: SearchResult[] = []

  const pageRows = db
    .prepare('SELECT id, title, icon FROM pages WHERE title LIKE ? ORDER BY updated_at DESC LIMIT 20')
    .all(q) as unknown as Array<{ id: string; title: string; icon: string | null }>
  for (const row of pageRows) {
    results.push({
      pageId: row.id,
      pageTitle: row.title || '无标题',
      pageIcon: row.icon,
      blockId: null,
      snippet: row.title || '无标题'
    })
  }

  const blockRows = db
    .prepare(
      `SELECT b.id AS block_id, b.page_id, p.title AS page_title, p.icon AS page_icon,
              json_extract(b.content, '$.text') AS text
       FROM blocks b JOIN pages p ON p.id = b.page_id
       WHERE json_extract(b.content, '$.text') LIKE ?
       ORDER BY b.updated_at DESC LIMIT 30`
    )
    .all(q) as unknown as Array<{
    block_id: string
    page_id: string
    page_title: string
    page_icon: string | null
    text: string | null
  }>
  for (const row of blockRows) {
    const text = row.text ?? ''
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    const start = Math.max(0, idx - 20)
    const snippet = (start > 0 ? '…' : '') + text.slice(start, start + 60) + (start + 60 < text.length ? '…' : '')
    results.push({
      pageId: row.page_id,
      pageTitle: row.page_title || '无标题',
      pageIcon: row.page_icon,
      blockId: row.block_id,
      snippet
    })
  }

  return results
}

// ---------- Wiki Links (双链) ----------

/** 把一段文本压成单行摘要,用于反向链接列表 */
function makeSnippet(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 解析块 content 里的纯文本,坏数据按纯文本兜底(与 blockFromRow 一致) */
function textOf(content: string): string {
  try {
    const parsed = JSON.parse(content) as BlockContent
    return parsed.text ?? ''
  } catch {
    return content
  }
}

/**
 * 取页面的双向链接:出链 + 反向链接。
 *
 * 双链没有单独的表 —— `[[标题]]` 就是块正文里的一段纯文本。
 * 这里在查询时解析正文并按标题解析目标页面,好处是链接的"真身"始终是正文,
 * 不会出现索引和正文对不上的情况;代价是每次查询要扫一遍含 `[[` 的块,
 * 对本地 SQLite 来说完全够用。
 */
export function getPageLinks(pageId: string): PageLinks {
  const pages = listPages()
  const target = pages.find((p) => p.id === pageId)
  if (!target) return { outgoing: [], backlinks: [] }
  const titleIndex = buildPageTitleIndex(pages)

  // ---------- 出链:本页块里的双链 ----------
  const outgoingMap = new Map<string, OutgoingLink>()
  for (const block of listBlocks(pageId)) {
    const text = block.content.text ?? ''
    for (const link of parseWikiLinks(text)) {
      const hit = lookupPageByTitle(titleIndex, link.title)
      const existing = outgoingMap.get(link.title)
      if (existing) {
        if (!existing.blockIds.includes(block.id)) existing.blockIds.push(block.id)
      } else {
        outgoingMap.set(link.title, {
          title: link.title,
          pageId: hit?.id ?? null,
          pageIcon: hit?.icon ?? null,
          blockIds: [block.id]
        })
      }
    }
  }

  // ---------- 反向链接:全库指向本页的块 ----------
  const backlinks: BacklinkRef[] = []
  const rows = db
    .prepare(
      `SELECT b.id AS block_id, b.page_id, b.content, p.title AS page_title, p.icon AS page_icon
       FROM blocks b JOIN pages p ON p.id = b.page_id
       WHERE instr(b.content, '[[') > 0
       ORDER BY b.updated_at DESC`
    )
    .all() as unknown as Array<{
    block_id: string
    page_id: string
    content: string
    page_title: string
    page_icon: string | null
  }>

  for (const row of rows) {
    // 本页自己的链接在"出链"里已经列过,不重复算成反向链接
    if (row.page_id === pageId) continue
    const text = textOf(row.content)
    if (!text) continue
    const links = parseWikiLinks(text)
    if (links.length === 0) continue
    // 一段文字里只要有一条链接指向本页,整块就算一条反向链接
    if (!links.some((l) => lookupPageByTitle(titleIndex, l.title)?.id === target.id)) continue
    backlinks.push({
      blockId: row.block_id,
      pageId: row.page_id,
      pageTitle: row.page_title || '无标题',
      pageIcon: row.page_icon,
      snippet: makeSnippet(stripWikiLinkMarkers(text))
    })
  }

  return { outgoing: [...outgoingMap.values()], backlinks }
}

// ---------- Seed ----------

/** Seed blocks for the welcome page. Reused by both the first-run seed and resetWelcomePage(). */
const WELCOME_SEED_BLOCKS: Array<{ type: BlockType; text: string; checked?: boolean; table?: TableData }> = [
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
        ['表格', '就是这张表,可以增删行列']
      ]
    }
  },
  { type: 'todo', text: '试试勾选这个待办事项', checked: false },
  { type: 'todo', text: '已完成的事项会显示删除线', checked: true },
  { type: 'quote', text: '块可以拖动左侧手柄重新排序。' },
  { type: 'code', text: 'function hello() {\n  console.log("Hello, Notion Clone!")\n}' },
  { type: 'divider', text: '' },
  { type: 'paragraph', text: '在左侧边栏可以新建页面、组织层级、搜索全部内容。开始写作吧!' }
]

/** 种子/重置时把表格的纯文本摘要一并写进 content.text */
function seedContent(seed: { text: string; checked?: boolean; table?: TableData }): BlockContent {
  return {
    text: seed.table ? tableToText(seed.table) : seed.text,
    checked: seed.checked,
    ...(seed.table ? { table: seed.table } : {})
  }
}

function seedIfEmpty(): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM pages').get() as { c: number }).c
  if (count > 0) return

  const page = createPage({ title: WELCOME_PAGE_TITLE })
  updatePage({ id: page.id, icon: '👋' })

  seedWelcomeBlocks(page.id)
}

/** Insert the welcome seed blocks for a given page id, in sequence. */
function seedWelcomeBlocks(pageId: string): void {
  let lastId: string | null = null
  for (const seed of WELCOME_SEED_BLOCKS) {
    const block = createBlock({
      pageId,
      type: seed.type,
      content: seedContent(seed),
      afterId: lastId
    })
    lastId = block.id
  }
}

/**
 * Re-seed the welcome page's example blocks. The page itself is preserved
 * (same id, title, icon); only its blocks are wiped and re-inserted.
 * Throws if no page with the welcome title exists.
 */
export function resetWelcomePage(): PageMeta {
  const row = db
    .prepare('SELECT * FROM pages WHERE title = ? ORDER BY created_at ASC LIMIT 1')
    .get(WELCOME_PAGE_TITLE) as PageRow | undefined
  if (!row) {
    throw new Error(`未找到标题为 "${WELCOME_PAGE_TITLE}" 的欢迎页面`)
  }

  const ts = now()
  // Clear existing blocks for this page, then re-seed inside a single transaction.
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM blocks WHERE page_id = ?').run(row.id)

    const ts2 = now()
    let position = POSITION_STEP
    const insert = db.prepare(
      'INSERT INTO blocks (id, page_id, type, content, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const seed of WELCOME_SEED_BLOCKS) {
      const id = randomUUID()
      const content = JSON.stringify(seedContent(seed))
      insert.run(id, row.id, seed.type, content, position, ts2, ts2)
      position += POSITION_STEP
    }
    db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run(ts2, row.id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return {
    id: row.id,
    title: row.title,
    icon: row.icon,
    parentId: row.parent_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: ts
  }
}
