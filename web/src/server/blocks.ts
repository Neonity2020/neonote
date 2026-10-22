// 本文件只允许导出 createServerFn 对象（客户端会原样 import 这个模块）。
// 纯辅助函数在 queries.ts。
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq } from 'drizzle-orm'

import { getDb } from '~/lib/db'
import { block } from '~/db/schema'
import type { Block, CreateBlockInput, UpdateBlockInput } from '~/lib/shared'
import {
  POSITION_STEP,
  requireUser,
  now,
  requireOwnedPage,
  touchPage,
  blockFromRow,
  insertBlockRow,
} from './queries'

export const listBlocks = createServerFn({ method: 'GET' })
  .validator((d: unknown) => d as string)
  .handler(async ({ data: pageId }): Promise<Block[]> => {
    const userId = await requireUser()
    await requireOwnedPage(userId, pageId)
    const rows = await getDb()
      .select()
      .from(block)
      .where(and(eq(block.userId, userId), eq(block.pageId, pageId)))
      .orderBy(asc(block.position))
    return rows.map(blockFromRow)
  })

export const createBlock = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as CreateBlockInput)
  .handler(async ({ data }): Promise<Block> => {
    const userId = await requireUser()
    await requireOwnedPage(userId, data.pageId)
    return insertBlockRow(userId, data)
  })

export const updateBlock = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as UpdateBlockInput)
  .handler(async ({ data }): Promise<void> => {
    const userId = await requireUser()
    const ts = now()
    const db = getDb()
    const [row] = await db
      .select({ pageId: block.pageId })
      .from(block)
      .where(and(eq(block.id, data.id), eq(block.userId, userId)))
    if (!row) return
    const patch: { updatedAt: number; type?: string; content?: string } = { updatedAt: ts }
    if (data.type !== undefined) patch.type = data.type
    if (data.content !== undefined) patch.content = JSON.stringify(data.content)
    await db.update(block).set(patch).where(and(eq(block.id, data.id), eq(block.userId, userId)))
    await touchPage(userId, row.pageId, ts)
  })

export const deleteBlock = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as string)
  .handler(async ({ data: id }): Promise<void> => {
    const userId = await requireUser()
    const ts = now()
    const db = getDb()
    const [row] = await db
      .select({ pageId: block.pageId })
      .from(block)
      .where(and(eq(block.id, id), eq(block.userId, userId)))
    await db.delete(block).where(and(eq(block.id, id), eq(block.userId, userId)))
    if (row) await touchPage(userId, row.pageId, ts)
  })

/** 按给定顺序整体重排一页的块，位置重置为 POSITION_STEP 的整数倍（一个事务）。 */
export const reorderBlocks = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as { pageId: string; orderedIds: string[] })
  .handler(async ({ data: { pageId, orderedIds } }): Promise<void> => {
    const userId = await requireUser()
    await requireOwnedPage(userId, pageId)
    const ts = now()
    const db = getDb()
    await db.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx
          .update(block)
          .set({ position: (index + 1) * POSITION_STEP, updatedAt: ts })
          .where(and(eq(block.id, id), eq(block.userId, userId), eq(block.pageId, pageId)))
      }
    })
    await touchPage(userId, pageId, ts)
  })
