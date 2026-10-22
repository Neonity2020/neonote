import { app, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { AwsClient } from 'aws4fetch'
import type { SaveImageInput, SavedImage } from '@neonity/notion-clone-shared'

/**
 * Custom protocol used to serve local assets to the renderer.
 * Assets live as flat files named "<uuid><ext>" under userData/assets, so the
 * file name carries no user-supplied path and is stable for the lifetime of
 * the asset.
 */
export const ASSET_SCHEME = 'nc-asset'

/** MIME type to file extension, for the image types the app accepts. */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/x-icon': '.ico'
}

/** File extension to MIME type, used when serving assets over the custom protocol. */
export const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon'
}

/** The asset directory under userData, created on demand. */
export function getAssetsDir(): string {
  const dir = join(app.getPath('userData'), 'assets')
  mkdirSync(dir, { recursive: true })
  return dir
}

function extFor(input: { name?: string; mime?: string }): string {
  if (input.mime && EXT_BY_MIME[input.mime]) return EXT_BY_MIME[input.mime]
  const ext = input.name ? extname(input.name).toLowerCase() : ''
  return ext || '.png'
}

function toSaved(id: string): SavedImage {
  return { id, url: `${ASSET_SCHEME}://asset/${id}` }
}

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicUrl: string
}

function getR2Config(): R2Config | null {
  const values = {
    accountId: process.env.R2_ACCOUNT_ID?.trim() ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim() ?? '',
    bucket: process.env.R2_BUCKET?.trim() ?? '',
    publicUrl: process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, '') ?? '',
  }
  if (Object.values(values).every((value) => !value)) return null
  if (Object.values(values).some((value) => !value)) {
    throw new Error(
      'R2 配置不完整，需要 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET 和 R2_PUBLIC_URL',
    )
  }
  return values
}

async function uploadToR2(input: SaveImageInput, config: R2Config): Promise<SavedImage> {
  const id = `${randomUUID()}${extFor(input)}`
  const key = `images/${id}`
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: 'auto',
  })
  const response = await client.fetch(
    `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': input.mime || 'image/png' },
      body: input.data,
    },
  )
  if (!response.ok) {
    throw new Error(`R2 图片上传失败（HTTP ${response.status}）`)
  }
  return { id: key, url: `${config.publicUrl}/${key}` }
}

/** Store raw image bytes in R2 when configured, otherwise keep the local-first behavior. */
export async function saveImage(input: SaveImageInput): Promise<SavedImage> {
  const r2 = getR2Config()
  if (r2) return uploadToR2(input, r2)
  const id = `${randomUUID()}${extFor(input)}`
  writeFileSync(join(getAssetsDir(), id), Buffer.from(input.data))
  return toSaved(id)
}

/** Let the user pick an image file and copy it into the asset directory. */
export async function pickImage(): Promise<SavedImage | null> {
  const res = await dialog.showOpenDialog({
    title: '选择图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'] }
    ]
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const src = res.filePaths[0]
  const bytes = readFileSync(src)
  const extension = extname(src).toLowerCase()
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return saveImage({
    name: src,
    mime: MIME_BY_EXT[extension] || 'image/png',
    data,
  })
}

/**
 * Remove asset files that are no longer referenced by any image block.
 * Called at startup, once the database is loaded, so assets orphaned by a
 * deleted image block do not pile up on disk.
 */
export function gcAssets(keepIds: Set<string>): void {
  try {
    const dir = getAssetsDir()
    for (const file of readdirSync(dir)) {
      if (!keepIds.has(file)) {
        rmSync(join(dir, file), { force: true })
      }
    }
  } catch {
    // best-effort cleanup only
  }
}
