import {
  DEFAULT_SETTINGS,
  type AppInfo,
  type AppSettings,
  type DeepPartial,
  type SettingsApi,
} from '~/lib/shared'

const STORAGE_KEY = 'notion-clone-web:settings'

function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base
  if (typeof base === 'object' && base !== null && typeof patch === 'object' && patch !== null) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [key, value] of Object.entries(patch)) {
      out[key] = deepMerge((base as Record<string, unknown>)[key], value as DeepPartial<never>)
    }
    return out as T
  }
  return patch as T
}

function read(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(DEFAULT_SETTINGS)
    return deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw) as DeepPartial<AppSettings>)
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

function write(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

const listeners = new Set<(settings: AppSettings) => void>()

function webAppInfo(): AppInfo {
  const nav = navigator
  return {
    version: '0.1.0 (web)',
    electron: '—',
    chrome: /Chrome\/([\d.]+)/.exec(nav.userAgent)?.[1] ?? '—',
    node: '—',
    platform: nav.platform || 'web',
    dataDir: 'Turso（云端 libsql）',
    assetsDir: 'Turso（数据库内存表）',
    dbPath: 'TURSO_DATABASE_URL',
    dbBytes: 0,
    assetCount: 0,
    assetBytes: 0,
    pageCount: 0,
    blockCount: 0,
  }
}

/**
 * SettingsApi 的 Web 实现：localStorage 持久化 + 内存广播，取代 Electron 的
 * 主进程 settings 存储。多标签页之间不实时同步（Electron 版经主进程同步）。
 */
export const settingsApi: SettingsApi = {
  get: async () => read(),
  set: async (patch) => {
    const next = deepMerge(read(), patch)
    write(next)
    for (const listener of listeners) listener(next)
    return next
  },
  reset: async () => {
    localStorage.removeItem(STORAGE_KEY)
    const next = structuredClone(DEFAULT_SETTINGS)
    for (const listener of listeners) listener(next)
    return next
  },
  onChanged: (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  getAppInfo: async () => webAppInfo(),
  reveal: async () => {
    // Web 版没有本地数据目录可打开；保留为空操作。
  },
}
