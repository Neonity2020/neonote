// 本文件只允许导出 createServerFn 对象（客户端会原样 import 这个模块）。
// 纯辅助函数在 queries.ts。
import { createServerFn } from '@tanstack/react-start'

import { randomUUID } from 'node:crypto'
import { getDb } from '~/lib/db'
import { asset } from '~/db/schema'
import type { SavedImage } from '~/lib/shared'
import { requireUser } from './queries'
import { getR2PublicUrl, hasR2ImageStorage, putR2Image } from './r2'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4
const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
}

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
      throw new Error('图片过大，请选择 10MB 以内的图片')
    }
    const mime = data.mime || 'image/png'
    const extension = MIME_EXTENSIONS[mime]
    if (!extension) throw new Error('不支持该图片格式')

    const id = randomUUID()
    const bytes = Buffer.from(data.dataBase64, 'base64')
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('图片过大，请选择 10MB 以内的图片')
    }

    let storedData = data.dataBase64
    let url = `/api/asset/${id}`
    if (hasR2ImageStorage()) {
      const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
      const key = `users/${safeUserId}/${id}.${extension}`
      await putR2Image(key, new Uint8Array(bytes), mime)
      storedData = `r2:${key}`
      url = getR2PublicUrl(key) ?? url
    }

    await getDb().insert(asset).values({
      id,
      mime,
      data: storedData,
      createdAt: Date.now(),
      userId,
    })
    return { id, url }
  })
