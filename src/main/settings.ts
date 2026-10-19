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
} from '@neonity/notion-clone-shared'

/**
 * 设置服务:设置按分区(theme / editor / ai)序列化进 SQLite 的 settings 表。
 * 读取时与默认值深度合并并做一次校验,保证渲染层永远拿到合法值。
 */

const SECTIONS = ['theme', 'editor', 'ai'] as const
const MAX_PROMPT_LEN = 4000

type Listener = (settings: AppSettings) => void
const listeners = new Set<Listener>()

/** 订阅设置变更(主进程内部使用,比如 AI 服务需要重建会话) */
export function onSettingsChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** 把任意输入收敛成合法设置(坏值一律回落到默认) */
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

  const model =
    typeof ai.model === 'string' && ai.model.trim() ? ai.model.trim() : null
  const extraPrompt =
    typeof ai.extraPrompt === 'string' ? ai.extraPrompt.slice(0, MAX_PROMPT_LEN) : ''

  return {
    theme: pickEnum<ThemeMode>(raw.theme, ['light', 'dark', 'system'], DEFAULT_SETTINGS.theme),
    editor: { fontSize, contentWidth },
    ai: {
      model,
      autoContext: typeof ai.autoContext === 'boolean' ? ai.autoContext : DEFAULT_SETTINGS.ai.autoContext,
      extraPrompt
    }
  }
}

export function getSettings(): AppSettings {
  return sanitize(db.loadSettingsRaw())
}

export function updateSettings(patch: DeepPartial<AppSettings>): AppSettings {
  const current = getSettings()
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
      // 单个订阅者出错不影响设置保存
    }
  }
  return next
}

export function resetSettings(): AppSettings {
  db.clearSettings()
  // 走一遍 sanitize,避免把 DEFAULT_SETTINGS 的嵌套对象引用泄漏出去
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
      // 忽略读不到的条目
    }
  }
  return { count, bytes }
}

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

/** 广播最新设置给所有渲染窗口 */
function broadcast(settings: AppSettings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', settings)
  }
}

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
