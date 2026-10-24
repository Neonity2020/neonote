import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as db from './db'
import { getAssetsDir } from './assets'
import {
  CONTENT_WIDTHS,
  DEFAULT_SETTINGS,
  EDITOR_FONT_SIZES,
  type AppInfo,
  type AppSettings,
  type ContentWidth,
  type DeepPartial,
  type ThemeMode
} from '@neonity/neonote-shared'

/**
 * Settings service: every section (theme / editor / ai) is serialized into the
 * SQLite settings table as one JSON blob.
 * Reads merge the stored values with the defaults and validate them, so the
 * renderer always receives legal values.
 */

// Each section is one JSON blob stored under its own key in the settings table.
const SECTIONS = ['theme', 'editor', 'ai'] as const
// Bound on the user-supplied extra prompt; it is appended to the system prompt
// of every request.
const MAX_PROMPT_LEN = 4000

type Listener = (settings: AppSettings) => void
const listeners = new Set<Listener>()

/** Subscribe to settings changes (used inside the main process, e.g. the AI service rebuilds its session). */
export function onSettingsChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * The single validation chokepoint: every settings value that leaves this
 * module passes through here, so the renderer can never receive an illegal
 * value. Bad values always fall back to the default.
 */
export function sanitize(input: unknown): AppSettings {
  const raw = (input ?? {}) as DeepPartial<AppSettings>
  const editor = (raw.editor ?? {}) as DeepPartial<AppSettings['editor']>
  const ai = (raw.ai ?? {}) as DeepPartial<AppSettings['ai']>

  const fontSize =
    typeof editor.fontSize === 'number' && (EDITOR_FONT_SIZES as readonly number[]).includes(editor.fontSize)
      ? (editor.fontSize as AppSettings['editor']['fontSize'])
      : DEFAULT_SETTINGS.editor.fontSize

  const contentWidth = pickEnum<ContentWidth>(
    editor.contentWidth,
    Object.keys(CONTENT_WIDTHS) as ContentWidth[],
    DEFAULT_SETTINGS.editor.contentWidth
  )

  const newPageBackground =
    typeof editor.newPageBackground === 'boolean'
      ? editor.newPageBackground
      : DEFAULT_SETTINGS.editor.newPageBackground

  const model =
    typeof ai.model === 'string' && ai.model.trim() ? ai.model.trim() : null
  const extraPrompt =
    typeof ai.extraPrompt === 'string' ? ai.extraPrompt.slice(0, MAX_PROMPT_LEN) : ''

  return {
    theme: pickEnum<ThemeMode>(raw.theme, ['light', 'dark', 'system'], DEFAULT_SETTINGS.theme),
    editor: { fontSize, contentWidth, newPageBackground },
    ai: {
      model,
      autoContext: typeof ai.autoContext === 'boolean' ? ai.autoContext : DEFAULT_SETTINGS.ai.autoContext,
      extraPrompt
    }
  }
}

/** The current settings, merged with the defaults and sanitized. */
export function getSettings(): AppSettings {
  return sanitize(db.loadSettingsRaw())
}

/** Apply a partial patch, persist every section, and notify the subscribers. */
export function updateSettings(patch: DeepPartial<AppSettings>): AppSettings {
  const current = getSettings()
  // Sections are merged one level deep, so a patch such as { ai: { model } }
  // does not drop the other keys of the ai section.
  const next = sanitize({
    ...current,
    ...patch,
    editor: { ...current.editor, ...(patch.editor ?? {}) },
    ai: { ...current.ai, ...(patch.ai ?? {}) }
  })
  for (const section of SECTIONS) {
    db.saveSettingsSection(section, next[section])
  }
  for (const cb of listeners) {
    try {
      cb(next)
    } catch {
      // A failing subscriber must not stop the settings from being saved.
    }
  }
  return next
}

/** Clear the stored settings and fall back to the defaults. */
export function resetSettings(): AppSettings {
  db.clearSettings()
  // Run it through sanitize so the nested default objects are not handed out
  // by reference.
  const next = sanitize(DEFAULT_SETTINGS)
  for (const cb of listeners) {
    try {
      cb(next)
    } catch {
      // ignore
    }
  }
  return next
}

function dirSize(dir: string): { count: number; bytes: number } {
  if (!existsSync(dir)) return { count: 0, bytes: 0 }
  let count = 0
  let bytes = 0
  for (const name of readdirSync(dir)) {
    try {
      const st = statSync(join(dir, name))
      if (st.isFile()) {
        count += 1
        bytes += st.size
      }
    } catch {
      // Skip entries that cannot be read.
    }
  }
  return { count, bytes }
}

/** Version, runtime and on-disk storage information for the settings panel. */
export function getAppInfo(): AppInfo {
  const dataDir = app.getPath('userData')
  const assetsDir = getAssetsDir()
  const dbPath = join(dataDir, 'notion-clone.db')
  let dbBytes = 0
  try {
    dbBytes = statSync(dbPath).size
  } catch {
    dbBytes = 0
  }
  const assets = dirSize(assetsDir)
  const counts = db.countRows()
  return {
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: `${process.platform} ${process.arch}`,
    dataDir,
    assetsDir,
    dbPath,
    dbBytes,
    assetCount: assets.count,
    assetBytes: assets.bytes,
    pageCount: counts.pages,
    blockCount: counts.blocks
  }
}

/** Broadcast the latest settings to every renderer window. */
function broadcast(settings: AppSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', settings)
  }
}

/** Register the settings IPC handlers. */
export function registerSettings(): void {
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:set', (_e, patch: DeepPartial<AppSettings>) => {
    const next = updateSettings(patch ?? {})
    broadcast(next)
    return next
  })

  ipcMain.handle('settings:reset', () => {
    const next = resetSettings()
    broadcast(next)
    return next
  })

  ipcMain.handle('settings:app-info', () => getAppInfo())

  ipcMain.handle('settings:reveal', (_e, target: 'data' | 'assets') => {
    const dir = target === 'assets' ? getAssetsDir() : app.getPath('userData')
    if (!existsSync(dir)) return
    void shell.openPath(dir)
  })
}
