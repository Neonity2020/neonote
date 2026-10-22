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
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
}
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
}

interface SaveImageInputData {
  name: string
  mime: string
  /** ArrayBuffer 经 base64 编码后的字符串（server fn 边界只走 JSON）。 */
  dataBase64: string
}

interface SaveMediaOptions {
  label: string
  maxBytes: number
  extensions: Record<string, string>
}

/** 存储一段媒体字节：R2 可用时写对象存储，否则 base64 落库。 */
async function saveMedia(data: SaveImageInputData, options: SaveMediaOptions): Promise<SavedImage> {
  const userId = await requireUser()
  const maxBase64Length = Math.ceil(options.maxBytes / 3) * 4 + 4
  if (data.dataBase64.length > maxBase64Length) {
    throw new Error(`${options.label}过大，请选择 ${Math.floor(options.maxBytes / 1024 / 1024)}MB 以内的文件`)
  }
  const extension = options.extensions[data.mime]
  if (!extension) throw new Error(`不支持该${options.label}格式`)

  const id = randomUUID()
  const bytes = Buffer.from(data.dataBase64, 'base64')
  if (bytes.byteLength > options.maxBytes) {
    throw new Error(`${options.label}过大，请选择 ${Math.floor(options.maxBytes / 1024 / 1024)}MB 以内的文件`)
  }

  let storedData = data.dataBase64
  let url = `/api/asset/${id}`
  if (hasR2ImageStorage()) {
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const key = `users/${safeUserId}/${id}.${extension}`
    await putR2Image(key, new Uint8Array(bytes), data.mime)
    storedData = `r2:${key}`
    url = getR2PublicUrl(key) ?? url
  }

  await getDb().insert(asset).values({
    id,
    mime: data.mime,
    data: storedData,
    createdAt: Date.now(),
    userId,
  })
  return { id, url }
}

export const saveImage = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as SaveImageInputData)
  .handler(async ({ data }): Promise<SavedImage> =>
    saveMedia(
      { ...data, mime: data.mime || 'image/png' },
      { label: '图片', maxBytes: MAX_IMAGE_BYTES, extensions: IMAGE_EXTENSIONS },
    ),
  )

export const saveAudio = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as SaveImageInputData)
  .handler(async ({ data }): Promise<SavedImage> =>
    saveMedia(
      { ...data, mime: data.mime || 'audio/mpeg' },
      { label: '音频', maxBytes: MAX_AUDIO_BYTES, extensions: AUDIO_EXTENSIONS },
    ),
  )
