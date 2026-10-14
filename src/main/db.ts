import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import type {
  Block,
  BlockContent,
  BlockType,
  CreateBlockInput,
  CreatePageInput,
  PageMeta,
  SearchResult,
  UpdateBlockInput,
  UpdatePageInput
} from '../shared/types'

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

export function updatePage(input: UpdatePageInput): void {
  const ts = now()
  if (input.title !== undefined) {
    db.prepare('UPDATE pages SET title = ?, updated_at = ? WHERE id = ?').run(input.title, ts, input.id)
  }
  if (input.icon !== undefined) {
    db.prepare('UPDATE pages SET icon = ?, updated_at = ? WHERE id = ?').run(input.icon, ts, input.id)
  }
}

export function deletePage(id: string): void {
  // FK cascade removes child pages and their blocks
  db.prepare('DELETE FROM pages WHERE id = ?').run(id)
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

// ---------- Seed ----------

function seedIfEmpty(): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM pages').get() as { c: number }).c
  if (count > 0) return

  const page = createPage({ title: '欢迎使用 Notion Clone' })
  updatePage({ id: page.id, icon: '👋' })

  const seedBlocks: Array<{ type: BlockType; text: string; checked?: boolean }> = [
    { type: 'paragraph', text: '这是一个本地优先的块笔记应用,所有数据保存在本机 SQLite 数据库中。' },
    { type: 'heading1', text: '快速上手' },
    { type: 'bulletedList', text: '按 Enter 新建一个块' },
    { type: 'bulletedList', text: '在空块中输入 / 唤起命令菜单,切换块类型' },
    { type: 'bulletedList', text: '支持 Markdown 快捷输入:试试输入 # 加空格' },
    { type: 'heading2', text: '支持的块类型' },
    { type: 'numberedList', text: '段落、一到三级标题' },
    { type: 'numberedList', text: '无序 / 有序列表' },
    { type: 'numberedList', text: '待办事项、引用、代码块、分割线' },
    { type: 'todo', text: '试试勾选这个待办事项', checked: false },
    { type: 'todo', text: '已完成的事项会显示删除线', checked: true },
    { type: 'quote', text: '块可以拖动左侧手柄重新排序。' },
    { type: 'code', text: 'function hello() {\n  console.log("Hello, Notion Clone!")\n}' },
    { type: 'divider', text: '' },
    { type: 'paragraph', text: '在左侧边栏可以新建页面、组织层级、搜索全部内容。开始写作吧!' }
  ]

  let lastId: string | null = null
  for (const seed of seedBlocks) {
    const block = createBlock({
      pageId: page.id,
      type: seed.type,
      content: { text: seed.text, checked: seed.checked },
      afterId: lastId
    })
    lastId = block.id
  }
}
