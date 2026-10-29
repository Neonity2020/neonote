// 本文件只允许导出 createServerFn 对象（客户端会原样 import 这个模块，
// 其他导出会把 drizzle/libsql 拖进浏览器 bundle）。纯辅助函数在 queries.ts。
//
// 离线同步协议（状态式，行级 LWW）：
// - 客户端生成 id / position / 时间戳，本地 IndexedDB 为第一写入点；
// - pushChanges 收整行 upsert + 删除墓碑，服务端逐行按时间戳裁决，顺序无关；
// - pullChanges 按 updatedAt 增量下发（含墓碑），客户端用同一套 LWW 合并。
import { createServerFn } from '@tanstack/react-start'
import { and, eq, gt, sql } from 'drizzle-orm'

import { getDb } from '~/lib/db'
import { block, page, tombstone } from '~/db/schema'
import type {
  BlockContent,
  PageMeta,
  PullChangesInput,
  PullChangesResult,
  PushChangesInput,
  PushChangesResult,
  Tombstone,
} from '~/lib/shared'
import { now, pageFromRow, blockFromRow, propagateTitleRename, requireUser, seedIfEmpty } from './queries'

/**
 * 增量拉取的重叠窗口（毫秒）。游标与写入同毫秒的边界行靠它兜住，
 * 重叠行会被两端 LWW 幂等吸收，多拉不产生副作用。
 */
const PULL_OVERLAP_MS = 2000

export const pullChanges = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as PullChangesInput)
  .handler(async ({ data }): Promise<PullChangesResult> => {
    const userId = await requireUser()
    await seedIfEmpty(userId)
    const db = getDb()
    const since = data.since - PULL_OVERLAP_MS

    const pageRows = await db
      .select()
      .from(page)
      .where(and(eq(page.userId, userId), gt(page.updatedAt, since)))
    const blockRows = await db
      .select()
      .from(block)
      .where(and(eq(block.userId, userId), gt(block.updatedAt, since)))
    // 墓碑全量下发(只增不重的行,体量极小):客户端据此同步「墓碑撤销」——
    // 行被更新的编辑复活后墓碑会消失,增量下发传不了这个信号。
    const tombRows = await db
      .select()
      .from(tombstone)
      .where(eq(tombstone.userId, userId))

    return {
      serverTime: now(),
      pages: pageRows.map(pageFromRow),
      blocks: blockRows.map(blockFromRow),
      tombstones: tombRows.map((r) => ({ id: r.id, kind: r.kind, deletedAt: r.deletedAt })),
    }
  })

export const pushChanges = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as PushChangesInput)
  .handler(async ({ data }): Promise<PushChangesResult> => {
    const userId = await requireUser()
    const db = getDb()

    // 改名扇出（[[旧标题]] 改写）在事务外跑：propagateTitleRename 走独立连接，
    // 与事务内的写混用会有隔离性问题。事务先落行，扇出随后补写。
    const renames: Array<{ pageId: string; oldTitle: string; newTitle: string; ts: number }> = []

    await db.transaction(async (tx) => {
      // ---------- 页面先行（块的 FK 指向页面，同批新建的父子页要能对上） ----------
      // 第一遍筛出会真正落库的页面（LWW + 墓碑预检），它们的 id 才能作为 parentId 的依据。
      const applicable: Array<{ incoming: PageMeta; storedTitle: string | null }> = []
      for (const p of data.pages) {
        const [tomb] = await tx
          .select({ deletedAt: tombstone.deletedAt })
          .from(tombstone)
          .where(and(eq(tombstone.id, p.id), eq(tombstone.userId, userId)))
        if (tomb && tomb.deletedAt >= p.updatedAt) continue // 后删胜
        const [stored] = await tx
          .select({ title: page.title, updatedAt: page.updatedAt })
          .from(page)
          .where(and(eq(page.id, p.id), eq(page.userId, userId)))
        if (stored && stored.updatedAt >= p.updatedAt) continue // 服务端已有更新版本
        applicable.push({ incoming: p, storedTitle: stored?.title ?? null })
      }

      const idsAfterBatch = new Set(applicable.map((a) => a.incoming.id))
      for (const { incoming: p, storedTitle } of applicable) {
        // 父页面不存在（比如已被另一端删除）时兜底挂到顶层，救回数据而不是丢行。
        let parentId = p.parentId
        if (parentId && !idsAfterBatch.has(parentId)) {
          const [parent] = await tx
            .select({ id: page.id })
            .from(page)
            .where(and(eq(page.id, parentId), eq(page.userId, userId)))
          if (!parent) parentId = null
        }
        const values = {
          id: p.id,
          title: p.title,
          icon: p.icon,
          cover: p.cover,
          parentId,
          position: p.position,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          userId,
        }
        await tx
          .insert(page)
          .values(values)
          .onConflictDoUpdate({
            target: page.id,
            set: {
              title: values.title,
              icon: values.icon,
              cover: values.cover,
              parentId: values.parentId,
              position: values.position,
              updatedAt: values.updatedAt,
            },
          })
        // 行复活（曾墓碑、现在有更新的写入）：清掉墓碑。
        await tx
          .delete(tombstone)
          .where(and(eq(tombstone.id, p.id), eq(tombstone.userId, userId)))
        // 与存量标题比较决定是否扇出改写；改写时间戳压过客户端可能的超前时钟。
        if (storedTitle && storedTitle !== p.title) {
          renames.push({
            pageId: p.id,
            oldTitle: storedTitle,
            newTitle: p.title,
            ts: Math.max(now(), p.updatedAt),
          })
        }
      }

      // ---------- 块 ----------
      for (const b of data.blocks) {
        const [tomb] = await tx
          .select({ deletedAt: tombstone.deletedAt })
          .from(tombstone)
          .where(and(eq(tombstone.id, b.id), eq(tombstone.userId, userId)))
        if (tomb && tomb.deletedAt >= b.updatedAt) continue // 后删胜
        const [stored] = await tx
          .select({ updatedAt: block.updatedAt })
          .from(block)
          .where(and(eq(block.id, b.id), eq(block.userId, userId)))
        if (stored && stored.updatedAt >= b.updatedAt) continue
        // 所属页面不存在 → 页面删除对子孙事实上获胜，块不再复活。
        const [pg] = await tx
          .select({ id: page.id })
          .from(page)
          .where(and(eq(page.id, b.pageId), eq(page.userId, userId)))
        if (!pg) continue
        const values = {
          id: b.id,
          pageId: b.pageId,
          type: b.type,
          content: JSON.stringify(b.content ?? ({} as BlockContent)),
          position: b.position,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          userId,
        }
        await tx
          .insert(block)
          .values(values)
          .onConflictDoUpdate({
            target: block.id,
            set: {
              type: values.type,
              content: values.content,
              position: values.position,
              updatedAt: values.updatedAt,
            },
          })
        await tx.delete(tombstone).where(and(eq(tombstone.id, b.id), eq(tombstone.userId, userId)))
      }

      // ---------- 墓碑 ----------
      for (const t of data.tombstones) {
        if (t.kind === 'page') {
          const [stored] = await tx
            .select({ updatedAt: page.updatedAt })
            .from(page)
            .where(and(eq(page.id, t.id), eq(page.userId, userId)))
          if (stored && stored.updatedAt >= t.deletedAt) {
            // 后编辑胜:行保留,并清掉可能残留的旧墓碑(行复活的信号靠墓碑消失传播)。
            await tx
              .delete(tombstone)
              .where(and(eq(tombstone.id, t.id), eq(tombstone.userId, userId)))
            continue
          }
          if (stored) {
            // FK 级联会把子页和块一并删掉；被级联删掉的块补上墓碑，
            // 其他端才能把「页面已删」传导到本地残留的块行。
            const cascaded = await tx
              .select({ id: block.id })
              .from(block)
              .where(and(eq(block.pageId, t.id), eq(block.userId, userId)))
            for (const c of cascaded) {
              await putTombstone(tx, { id: c.id, kind: 'block', deletedAt: t.deletedAt }, userId)
            }
            await tx.delete(page).where(and(eq(page.id, t.id), eq(page.userId, userId)))
          }
        } else {
          const [stored] = await tx
            .select({ updatedAt: block.updatedAt })
            .from(block)
            .where(and(eq(block.id, t.id), eq(block.userId, userId)))
          if (stored && stored.updatedAt >= t.deletedAt) {
            await tx
              .delete(tombstone)
              .where(and(eq(tombstone.id, t.id), eq(tombstone.userId, userId)))
            continue
          }
          if (stored) {
            await tx.delete(block).where(and(eq(block.id, t.id), eq(block.userId, userId)))
          }
        }
        // 行本来就不存在（另一端已删 / 幂等重放）也要留痕，供迟加入的设备学习删除。
        await putTombstone(tx, t, userId)
      }
    })

    for (const r of renames) {
      await propagateTitleRename(userId, r.pageId, r.oldTitle, r.newTitle, r.ts)
    }

    return { serverTime: now() }
  })

/** 记墓碑（事务内）。已有更晚的墓碑时不回退。 */
async function putTombstone(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  t: Tombstone,
  userId: string,
): Promise<void> {
  await tx
    .insert(tombstone)
    .values({ id: t.id, kind: t.kind, deletedAt: t.deletedAt, userId })
    .onConflictDoUpdate({
      target: tombstone.id,
      set: { deletedAt: sql`max(excluded.deleted_at, ${tombstone.deletedAt})` },
    })
}
