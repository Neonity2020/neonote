import { app, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { SaveImageInput, SavedImage } from '../shared/types'

export const ASSET_SCHEME = 'nc-asset'

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

export function saveImage(input: SaveImageInput): SavedImage {
  const id = `${randomUUID()}${extFor(input)}`
  writeFileSync(join(getAssetsDir(), id), Buffer.from(input.data))
  return toSaved(id)
}

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

/** Remove asset files that are no longer referenced by any image block. */
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
