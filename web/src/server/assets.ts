// 本文件只允许导出 createServerFn 对象（客户端会原样 import 这个模块）。
// 纯辅助函数在 queries.ts。
import { createServerFn } from '@tanstack/react-start'

import { randomUUID } from 'node:crypto'
import { getDb } from '~/lib/db'
import { asset } from '~/db/schema'
import type { SavedImage } from '~/lib/shared'
import { requireUser, getAssetBytes } from './queries'
import { getR2PublicUrl, getR2Image, hasR2ImageStorage, putR2Image } from './r2'

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

/**
 * 读回资产字节（语音识别用）：R2 公网 URL 没有 CORS 头、浏览器 fetch 不到
 * 时走这里。三条路径，都没有跨域问题：
 *   1. 同源 /api/asset/<id> —— 查库，r2: 引用或 base64 都能取；
 *   2. R2_PUBLIC_URL 下的自有 key —— 校验属于当前用户后经绑定读取；
 *   3. 其他 http(s) 音频 URL —— 服务端代抓（Workers 出口无 CORS），
 *      仅接受音频类响应、上限 30MB。桌面版主进程等价能力。
 */
export const fetchAssetBytes = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as string)
  .handler(async ({ data: url }): Promise<{ mime: string; dataBase64: string } | null> => {
    const userId = await requireUser()
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_')

    // 同源资产路由：id 查库，r2: 引用或 base64 都由 getAssetBytes 处理。
    const assetPrefix = '/api/asset/'
    const index = url.indexOf(assetPrefix)
    if (index >= 0) {
      const id = url.slice(index + assetPrefix.length).split(/[?#]/)[0]
      if (!/^[\w-]+$/.test(id)) return null
      const bytes = await getAssetBytes(userId, id)
      if (!bytes) return null
      return { mime: bytes.mime, dataBase64: Buffer.from(bytes.buffer).toString('base64') }
    }

    // R2 公网 URL：key 必须属于当前用户，经绑定读取（不走公网）。
    const publicBase = (getR2PublicUrl('') ?? '').replace(/\/+$/, '')
    if (publicBase && url.startsWith(`${publicBase}/`)) {
      const key = url.slice(publicBase.length + 1).split(/[?#]/)[0]
      if (!key.startsWith(`users/${safeUserId}/`)) return null
      const object = await getR2Image(key)
      if (!object) return null
      return {
        mime: object.mime || 'application/octet-stream',
        dataBase64: Buffer.from(object.buffer).toString('base64'),
      }
    }

    // 其他 http(s) 音频直链：服务端代抓。仅接受音频类响应、≤30MB；
    // 非音频（HTML 错误页等）按不可读返回。
    if (/^https?:\/\//.test(url)) {
      try {
        const response = await fetch(url)
        if (!response.ok) return null
        const mime = (response.headers.get('content-type') || '').split(';')[0].trim()
        // mp4 容器常装 AAC 音频（播客下载多为 .mp4/.m4a），<audio> 能播，放行。
        const looksAudio =
          mime.startsWith('audio/') ||
          mime === 'video/mp4' ||
          mime === 'application/octet-stream' ||
          mime === ''
        if (!looksAudio) return null
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength > 30 * 1024 * 1024) return null
        return { mime: mime || 'audio/mpeg', dataBase64: Buffer.from(buffer).toString('base64') }
      } catch {
        return null
      }
    }

    return null
  })
