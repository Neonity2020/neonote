import { app, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
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

/** Store raw image bytes as a new asset; the id doubles as the file name. */
export function saveImage(input: SaveImageInput): SavedImage {
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
  const id = `${randomUUID()}${extname(src).toLowerCase() || '.png'}`
  copyFileSync(src, join(getAssetsDir(), id))
  return toSaved(id)
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
