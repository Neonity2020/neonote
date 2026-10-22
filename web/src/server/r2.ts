import { env } from 'cloudflare:workers'

interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>
  httpMetadata?: { contentType?: string }
}

interface R2BucketLike {
  put(
    key: string,
    value: Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string }
    },
  ): Promise<unknown>
  get(key: string): Promise<R2ObjectBodyLike | null>
}

interface ImageRuntimeEnv {
  NOTE_IMAGES?: R2BucketLike
  R2_PUBLIC_URL?: string
}

const imageEnv = env as unknown as ImageRuntimeEnv

export function hasR2ImageStorage(): boolean {
  return !!imageEnv.NOTE_IMAGES
}

export async function putR2Image(key: string, bytes: Uint8Array, mime: string): Promise<void> {
  const bucket = imageEnv.NOTE_IMAGES
  if (!bucket) throw new Error('R2 图片存储尚未配置')
  await bucket.put(key, bytes, {
    httpMetadata: {
      contentType: mime,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })
}

export async function getR2Image(
  key: string,
): Promise<{ buffer: ArrayBuffer; mime?: string } | null> {
  const object = await imageEnv.NOTE_IMAGES?.get(key)
  if (!object) return null
  return {
    buffer: await object.arrayBuffer(),
    mime: object.httpMetadata?.contentType,
  }
}

export function getR2PublicUrl(key: string): string | null {
  const base = imageEnv.R2_PUBLIC_URL?.trim().replace(/\/+$/, '')
  return base ? `${base}/${key}` : null
}
