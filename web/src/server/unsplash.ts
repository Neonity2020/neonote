// 本文件只允许导出 createServerFn 对象（客户端会原样 import 这个模块，
// 其他导出会把 drizzle/libsql 拖进浏览器 bundle）。
// Unsplash 搜索代理：key 只留在服务端，浏览器拿不到；结果做内存缓存，
// 避免把 demo 模式 50 次/小时的配额烧光。
import { createServerFn } from '@tanstack/react-start'

import { getSession } from './session'

export interface UnsplashPhoto {
  id: string
  // 封面用大图：官方 raw 直链 + 裁剪参数，仍是 images.unsplash.com hotlink
  full: string
  // 选择器网格里的缩略图
  thumb: string
  photographer: string
  photographerUrl: string
  photoUrl: string
  color: string
}

export type UnsplashSearchResult =
  | { ok: true; photos: UnsplashPhoto[]; total: number }
  | { ok: false; error: string }

const PER_PAGE = 24
const CACHE_TTL = 10 * 60 * 1000
const CACHE_MAX = 60

const cache = new Map<string, { at: number; photos: UnsplashPhoto[]; total: number }>()

interface UnsplashApiPhoto {
  id: string
  color: string
  links?: { html?: string }
  user?: { name?: string; links?: { html?: string } }
  urls?: { raw?: string; full?: string; small?: string }
}

function toPhoto(photo: UnsplashApiPhoto): UnsplashPhoto | null {
  const raw = photo.urls?.raw
  const thumb = photo.urls?.small
  if (!raw || !thumb) return null
  const sep = raw.includes('?') ? '&' : '?'
  return {
    id: photo.id,
    full: `${raw}${sep}w=1600&q=80&auto=format&fit=crop`,
    thumb,
    photographer: photo.user?.name ?? 'Unknown',
    photographerUrl: photo.user?.links?.html ?? 'https://unsplash.com',
    photoUrl: photo.links?.html ?? 'https://unsplash.com',
    color: photo.color || '#334155',
  }
}

async function fetchPhotos(endpoint: string, accessKey: string): Promise<UnsplashSearchResult> {
  const res = await fetch(endpoint, {
    headers: { Authorization: `Client-ID ${accessKey}` },
  })
  if (res.status === 401) {
    return { ok: false, error: 'UNSPLASH_ACCESS_KEY 无效，请检查 .dev.vars / wrangler secret' }
  }
  if (res.status === 429) {
    return { ok: false, error: 'Unsplash 请求达到限额（demo 模式 50 次/小时），稍后再试' }
  }
  if (!res.ok) {
    return { ok: false, error: `Unsplash 请求失败（HTTP ${res.status}）` }
  }
  const json: unknown = await res.json()
  const list: UnsplashApiPhoto[] = Array.isArray(json)
    ? (json as UnsplashApiPhoto[])
    : ((json as { results?: UnsplashApiPhoto[] }).results ?? [])
  const photos = list.map(toPhoto).filter((p): p is UnsplashPhoto => p !== null)
  const total =
    Array.isArray(json) ? photos.length : ((json as { total?: number }).total ?? photos.length)
  return { ok: true, photos, total }
}

export const searchUnsplashPhotos = createServerFn({ method: 'GET' })
  .validator((d: unknown) => {
    const raw = (d ?? {}) as { query?: string; page?: number }
    return {
      query: (raw.query ?? '').trim().slice(0, 100),
      page: Math.max(1, Math.min(5, Math.floor(Number(raw.page) || 1))),
    }
  })
  .handler(async ({ data }): Promise<UnsplashSearchResult> => {
    const session = await getSession()
    if (!session) return { ok: false, error: '请先登录' }

    const accessKey = process.env.UNSPLASH_ACCESS_KEY
    if (!accessKey) {
      return {
        ok: false,
        error:
          '未配置 UNSPLASH_ACCESS_KEY：在 unsplash.com/developers 免费创建应用，把 Access Key 写入 web/.dev.vars（部署用 wrangler secret put UNSPLASH_ACCESS_KEY）',
      }
    }

    const cacheKey = `${data.page}:${data.query}`
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      return { ok: true, photos: hit.photos, total: hit.total }
    }

    // 空查询走精选列表（和搜索同一套结果形状）
    const endpoint = data.query
      ? `https://api.unsplash.com/search/photos?query=${encodeURIComponent(data.query)}&per_page=${PER_PAGE}&page=${data.page}&content_filter=high`
      : `https://api.unsplash.com/photos?per_page=${PER_PAGE}&page=${data.page}&order_by=popular`
    const result = await fetchPhotos(endpoint, accessKey)
    if (result.ok) {
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(cacheKey, { at: Date.now(), photos: result.photos, total: result.total })
    }
    return result
  })
