/**
 * 本地数据源:IndexedDB 为持久化影子,内存全量为唯一读写面。
 *
 * 所有本地写操作同步改内存并立即发变更事件(UI 零等待),IDB 写入异步跟进;
 * 同步引擎(sync-engine)是唯一消费 dirty 行与 mergeRemote 的一方。
 * 时间戳是 Lamport 式单调钟:本地发戳永不回退,且抬升到见过的远端时间之上,
 * 这样自己的连续编辑不会输给历史远端版本,真离线并发才交给时间戳裁决。
 */
import { openDB, type IDBPDatabase } from 'idb'
import type { Block, PageMeta, PullChangesResult, Tombstone } from '~/lib/shared'

/** 本地行:数据行 + 是否有待推送修改。 */
interface LocalPage extends PageMeta {
  dirty: boolean
}
interface LocalBlock extends Block {
  dirty: boolean
}
/** 墓碑的 pushed=0 表示还没推给云端。 */
interface LocalTombstone extends Tombstone {
  pushed: boolean
}

interface SyncDBSchema {
  pages: { key: string; value: LocalPage }
  blocks: { key: string; value: LocalBlock }
  tombstones: { key: string; value: LocalTombstone }
  meta: { key: string; value: unknown }
}

const DB_NAME = 'notion-clone-sync'
const DB_VERSION = 1

let db: IDBPDatabase<SyncDBSchema> | null = null
const pages = new Map<string, LocalPage>()
const blocks = new Map<string, LocalBlock>()
const tombstones = new Map<string, LocalTombstone>()

// Lamport 时钟状态(boot 时从 meta 恢复)。
let clockOffset = 0
let lastStamp = 0
let lastPull = 0

export interface ChangeEvent {
  /** 页面行(含增删、墓碑)有变化,订阅方需重排页面列表。 */
  pages: boolean
  /** 这些页面的块有变化,当前页在其中时需重载块列表。 */
  blockPageIds: Set<string>
  /** local = 本地写穿;remote = 同步引擎的拉取合并(反链等派生数据只需关心远端)。 */
  origin: 'local' | 'remote'
}
type Listener = (ev: ChangeEvent) => void
const listeners = new Set<Listener>()

export function subscribeLocal(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function fire(pages: boolean, blockPageIds: Set<string>, origin: 'local' | 'remote'): void {
  const ev: ChangeEvent = { pages, blockPageIds, origin }
  for (const fn of listeners) fn(ev)
}

// ---------- 时钟 ----------

/** 本地发戳:不早于墙钟(+偏移),且严格大于上一次(本地或见过的远端)时间戳。 */
export function nextStamp(): number {
  const t = Math.max(Date.now() + clockOffset, lastStamp + 1)
  lastStamp = t
  return t
}

/** 见到远端时间戳(行时间或 serverTime)后抬升本地钟,保证后续本地写不会更旧。 */
function observeRemoteTs(ts: number): void {
  if (ts > lastStamp) lastStamp = ts
  const needed = ts - Date.now() + 1
  if (needed > clockOffset) clockOffset = needed
}

/** 供引擎吸收 push 响应里的 serverTime(拉取合并内部走同一条路)。 */
export function observeServerTime(ts: number): void {
  observeRemoteTs(ts)
}

/** 供引擎在同步周期后落盘时钟与游标(每周期一次,而不是每次发戳)。 */
export function saveClockMeta(): void {
  if (!db) return
  void db.put('meta', { offset: clockOffset, lastStamp }, 'clock')
  void db.put('meta', lastPull, 'lastPull')
}

// ---------- 启动 ----------

export async function openLocal(): Promise<void> {
  db = await openDB<SyncDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore('pages', { keyPath: 'id' })
      d.createObjectStore('blocks', { keyPath: 'id' })
      d.createObjectStore('tombstones', { keyPath: 'id' })
      d.createObjectStore('meta')
    },
  })
  const [pageRows, blockRows, tombRows, clock, pulled] = await Promise.all([
    db.getAll('pages'),
    db.getAll('blocks'),
    db.getAll('tombstones'),
    db.get('meta', 'clock'),
    db.get('meta', 'lastPull'),
  ])
  for (const row of pageRows) pages.set(row.id, row)
  for (const row of blockRows) blocks.set(row.id, row)
  for (const row of tombRows) tombstones.set(row.id, row)
  const c = clock as { offset: number; lastStamp: number } | undefined
  if (c) {
    clockOffset = c.offset
    lastStamp = c.lastStamp
  }
  lastPull = (pulled as number | undefined) ?? 0
}

// ---------- 读(内存,同步) ----------

/** 与服务端 listPages 相同的排序:顶层在前,同层按 position。 */
export function allPages(): PageMeta[] {
  return [...pages.values()].sort(
    (a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0) || a.position - b.position
  )
}

export function pageById(id: string): PageMeta | undefined {
  return pages.get(id)
}

export function blocksOf(pageId: string): Block[] {
  return [...blocks.values()]
    .filter((b) => b.pageId === pageId)
    .sort((a, b) => a.position - b.position)
}

export function blockById(id: string): Block | undefined {
  return blocks.get(id)
}

/** 是否还有待推送内容(供状态指示)。 */
export function pendingCount(): number {
  const n =
    [...pages.values()].filter((p) => p.dirty).length +
    [...blocks.values()].filter((b) => b.dirty).length +
    [...tombstones.values()].filter((t) => !t.pushed).length
  return n
}

/** 取一批待推送行(不清除 dirty;推送成功后由 clearDirty 处理)。 */
export function takeDirty(
  max: number
): { pages: PageMeta[]; blocks: Block[]; tombstones: Tombstone[] } | null {
  const out = {
    pages: [...pages.values()].filter((p) => p.dirty).slice(0, max).map(stripDirty),
    blocks: [] as Block[],
    tombstones: [] as Tombstone[],
  }
  if (out.pages.length < max) {
    out.blocks = [...blocks.values()]
      .filter((b) => b.dirty)
      .slice(0, max - out.pages.length)
      .map(stripDirty)
  }
  if (out.pages.length + out.blocks.length < max) {
    out.tombstones = [...tombstones.values()]
      .filter((t) => !t.pushed)
      .slice(0, max - out.pages.length - out.blocks.length)
      .map(({ pushed: _pushed, ...t }) => t)
  }
  if (out.pages.length === 0 && out.blocks.length === 0 && out.tombstones.length === 0) return null
  return out
}

function stripDirty<T extends { dirty: boolean }>(row: T): Omit<T, 'dirty'> {
  const { dirty: _dirty, ...clean } = row
  return clean
}

/** 推送成功后清除对应行的 dirty / 标记墓碑已推。 */
export function clearDirty(batch: {
  pages: PageMeta[]
  blocks: Block[]
  tombstones: Tombstone[]
}): void {
  if (!db) return
  for (const p of batch.pages) {
    const row = pages.get(p.id)
    if (row && row.dirty && row.updatedAt === p.updatedAt) {
      row.dirty = false
      void db.put('pages', row)
    }
  }
  for (const b of batch.blocks) {
    const row = blocks.get(b.id)
    if (row && row.dirty && row.updatedAt === b.updatedAt) {
      row.dirty = false
      void db.put('blocks', row)
    }
  }
  for (const t of batch.tombstones) {
    const row = tombstones.get(t.id)
    if (row && !row.pushed && row.deletedAt === t.deletedAt) {
      row.pushed = true
      void db.put('tombstones', row)
    }
  }
}

// ---------- 本地写(同步改内存 + 异步落 IDB) ----------

/** 写一行页面:打本地时间戳、置 dirty、广播。返回落库后的行。 */
export function writePage(p: PageMeta): PageMeta {
  const row: LocalPage = { ...p, updatedAt: nextStamp(), dirty: true }
  pages.set(row.id, row)
  if (db) void db.put('pages', row)
  fire(true, new Set(), 'local')
  return { ...row }
}

export function writeBlock(b: Block): Block {
  const row: LocalBlock = { ...b, updatedAt: nextStamp(), dirty: true }
  blocks.set(row.id, row)
  if (db) void db.put('blocks', row)
  fire(false, new Set([b.pageId]), 'local')
  return { ...row }
}

/** 同一时间戳批写多块(setBlocksOrder / 重播种:一批要么整体赢要么整体输)。 */
export function writeBlocks(list: Block[]): Block[] {
  const ts = nextStamp()
  const pageIds = new Set<string>()
  const out = list.map((b) => {
    const row: LocalBlock = { ...b, updatedAt: ts, dirty: true }
    blocks.set(row.id, row)
    if (db) void db.put('blocks', row)
    pageIds.add(b.pageId)
    return { ...row }
  })
  fire(false, pageIds, 'local')
  return out
}

/** 删除单个块(墓碑)。 */
export function deleteBlockLocal(id: string): void {
  const row = blocks.get(id)
  if (!row) return
  blocks.delete(id)
  const tomb: LocalTombstone = { id, kind: 'block', deletedAt: nextStamp(), pushed: false }
  tombstones.set(id, tomb)
  if (db) {
    void db.delete('blocks', id)
    void db.put('tombstones', tomb)
  }
  fire(false, new Set([row.pageId]), 'local')
}

/**
 * 删除整棵页面子树:页面与其所有后代页面、这些页面的全部块都写墓碑
 * (与服务端 deletePage 语义一致,跨端可传导)。返回被删的页面 id 集。
 */
export function deletePageTreeLocal(rootId: string): Set<string> {
  const removed = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const p of pages.values()) {
      if (p.parentId && removed.has(p.parentId) && !removed.has(p.id)) {
        removed.add(p.id)
        changed = true
      }
    }
  }
  const ts = nextStamp()
  const touchedPageBlockIds = new Set<string>()
  for (const id of removed) {
    pages.delete(id)
    const tomb: LocalTombstone = { id, kind: 'page', deletedAt: ts, pushed: false }
    tombstones.set(id, tomb)
    if (db) {
      void db.delete('pages', id)
      void db.put('tombstones', tomb)
    }
  }
  for (const b of blocks.values()) {
    if (!removed.has(b.pageId)) continue
    blocks.delete(b.id)
    const tomb: LocalTombstone = { id: b.id, kind: 'block', deletedAt: ts, pushed: false }
    tombstones.set(b.id, tomb)
    if (db) {
      void db.delete('blocks', b.id)
      void db.put('tombstones', tomb)
    }
    touchedPageBlockIds.add(b.pageId)
  }
  fire(true, touchedPageBlockIds, 'local')
  return removed
}

// ---------- 远端合并(仅同步引擎调用) ----------

/**
 * 行级 LWW 合并一次拉取结果。规则与服务端对称:
 * - 行:远端 updated_at 较新则采用;相等且本地无未推修改时采用远端(平局远端胜)。
 * - 墓碑:deletedAt 严格大于行 updatedAt 才删本地行;本地 dirty 行时间戳更新时保留待推(复活)。
 * 返回是否发生了任何实际变化(供引擎决定 bump linksVersion)。
 */
export function mergeRemote(res: PullChangesResult): boolean {
  if (!db) return false
  let changed = false
  let pagesChanged = false
  const touchedBlockPages = new Set<string>()

  const serverTombIds = new Set(res.tombstones.map((t) => t.id))
  // 先撤掉服务端已不存在的「已推」墓碑 = 那边的行被更新的编辑复活了。
  // 未推的本地墓碑保留(还没轮到服务端裁决)。
  for (const [id, local] of tombstones) {
    if (local.pushed && !serverTombIds.has(id)) {
      tombstones.delete(id)
      void db.delete('tombstones', id)
    }
  }

  for (const t of res.tombstones) {
    const existing = tombstones.get(t.id)
    if (!existing || t.deletedAt > existing.deletedAt) {
      tombstones.set(t.id, { ...t, pushed: true })
      void db.put('tombstones', { ...t, pushed: true })
    }
    const pageRow = pages.get(t.id)
    if (pageRow && t.deletedAt > pageRow.updatedAt) {
      pages.delete(t.id)
      void db.delete('pages', t.id)
      changed = true
      pagesChanged = true
    }
    const blockRow = blocks.get(t.id)
    if (blockRow && t.deletedAt > blockRow.updatedAt) {
      blocks.delete(t.id)
      void db.delete('blocks', t.id)
      touchedBlockPages.add(blockRow.pageId)
      changed = true
    }
  }

  for (const p of res.pages) {
    const tomb = tombstones.get(p.id)
    if (tomb && tomb.deletedAt >= p.updatedAt) continue // 本地删除更新,忽略远端行
    const local = pages.get(p.id)
    if (!local) {
      pages.set(p.id, { ...p, dirty: false })
      void db.put('pages', { ...p, dirty: false })
      changed = true
      pagesChanged = true
    } else if (p.updatedAt > local.updatedAt || (p.updatedAt === local.updatedAt && !local.dirty)) {
      pages.set(p.id, { ...p, dirty: false })
      void db.put('pages', { ...p, dirty: false })
      changed = true
      pagesChanged = true
    }
  }

  for (const b of res.blocks) {
    const tomb = tombstones.get(b.id)
    if (tomb && tomb.deletedAt >= b.updatedAt) continue
    // 所属页面已在本地删除:页面删除对子孙获胜,不收养游离块。
    if (tombstones.has(b.pageId)) continue
    const local = blocks.get(b.id)
    if (!local) {
      blocks.set(b.id, { ...b, dirty: false })
      void db.put('blocks', { ...b, dirty: false })
      touchedBlockPages.add(b.pageId)
      changed = true
    } else if (b.updatedAt > local.updatedAt || (b.updatedAt === local.updatedAt && !local.dirty)) {
      blocks.set(b.id, { ...b, dirty: false })
      void db.put('blocks', { ...b, dirty: false })
      touchedBlockPages.add(b.pageId)
      changed = true
    }
  }

  lastPull = res.serverTime
  let maxRowTs = res.serverTime
  for (const p of res.pages) if (p.updatedAt > maxRowTs) maxRowTs = p.updatedAt
  for (const b of res.blocks) if (b.updatedAt > maxRowTs) maxRowTs = b.updatedAt
  for (const t of res.tombstones) if (t.deletedAt > maxRowTs) maxRowTs = t.deletedAt
  observeRemoteTs(maxRowTs)

  if (changed) fire(pagesChanged, touchedBlockPages, 'remote')
  return changed
}

export function getLastPull(): number {
  return lastPull
}
