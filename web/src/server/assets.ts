// 本文件只允许导出 createServerFn 对象（客户端会原样 import 这个模块）。
// 纯辅助函数在 queries.ts。
import { createServerFn } from '@tanstack/react-start'

import { randomUUID } from 'node:crypto'
import { getDb } from '~/lib/db'
import { asset } from '~/db/schema'
import type { SavedImage } from '~/lib/shared'
import { requireUser } from './queries'

// base64 后的体积上限（约 2MB 原始数据）。资产存数据库而非对象存储，先用小上限兜底。
const MAX_BASE64_LENGTH = 2.8 * 1024 * 1024

interface SaveImageInputData {
  name: string
  mime: string
  /** ArrayBuffer 经 base64 编码后的字符串（server fn 边界只走 JSON）。 */
  dataBase64: string
}

export const saveImage = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as SaveImageInputData)
  .handler(async ({ data }): Promise<SavedImage> => {
    const userId = await requireUser()
    if (data.dataBase64.length > MAX_BASE64_LENGTH) {
      throw new Error('图片过大，请选择 2MB 以内的图片')
    }
    const id = randomUUID()
    await getDb().insert(asset).values({
      id,
      mime: data.mime || 'image/png',
      data: data.dataBase64,
      createdAt: Date.now(),
      userId,
    })
    return { id, url: `/api/asset/${id}` }
  })
