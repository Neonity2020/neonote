import { contextBridge, ipcRenderer } from 'electron'
import type {
  AiApi,
  AiEvent,
  AiModelInfo,
  AiPageContext,
  AppInfo,
  AppSettings,
  CreateBlockInput,
  CreatePageInput,
  DeepPartial,
  MovePageInput,
  NotionApi,
  PageUpdateResult,
  SaveImageInput,
  SettingsApi,
  UpdateBlockInput,
  UpdatePageInput
} from '@neonity/notion-clone-shared'

/**
 * The renderer only ever sees these three surfaces, exposed through
 * contextBridge. Nothing from Node or Electron is reachable from the renderer:
 * every call goes through an explicit, typed IPC channel.
 */

const api: NotionApi = {
  listPages: () => ipcRenderer.invoke('pages:list'),
  createPage: (input: CreatePageInput) => ipcRenderer.invoke('pages:create', input),
  updatePage: (input: UpdatePageInput): Promise<PageUpdateResult> =>
    ipcRenderer.invoke('pages:update', input),
  deletePage: (id: string) => ipcRenderer.invoke('pages:delete', id),
  movePage: (input: MovePageInput) => ipcRenderer.invoke('pages:move', input),
  resetWelcomePage: () => ipcRenderer.invoke('pages:reset-welcome'),

  listBlocks: (pageId: string) => ipcRenderer.invoke('blocks:list', pageId),
  createBlock: (input: CreateBlockInput) => ipcRenderer.invoke('blocks:create', input),
  updateBlock: (input: UpdateBlockInput) => ipcRenderer.invoke('blocks:update', input),
  deleteBlock: (id: string) => ipcRenderer.invoke('blocks:delete', id),
  reorderBlocks: (pageId: string, orderedIds: string[]) =>
    ipcRenderer.invoke('blocks:reorder', pageId, orderedIds),

  search: (query: string) => ipcRenderer.invoke('search:query', query),

  getPageLinks: (pageId: string) => ipcRenderer.invoke('links:page-links', pageId),

  saveImage: (input: SaveImageInput) => ipcRenderer.invoke('images:save', input),
  pickImage: () => ipcRenderer.invoke('images:pick')
}

// The notes and pages surface.
contextBridge.exposeInMainWorld('api', api)

const aiApi: AiApi = {
  send: (text: string, context: AiPageContext | null) =>
    ipcRenderer.invoke('ai:send', text, context),
  abort: () => ipcRenderer.invoke('ai:abort'),
  getStatus: () => ipcRenderer.invoke('ai:status'),
  listModels: (): Promise<AiModelInfo[]> => ipcRenderer.invoke('ai:models'),
  reset: () => ipcRenderer.invoke('ai:reset'),
  // The subscription helpers return an unsubscribe function, so the renderer
  // can drop the listener when the component that registered it unmounts.
  onEvent: (cb: (event: AiEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, event: AiEvent): void => cb(event)
    ipcRenderer.on('ai:event', listener)
    return () => ipcRenderer.removeListener('ai:event', listener)
  },
  onNotesChanged: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('ai:notes-changed', listener)
    return () => ipcRenderer.removeListener('ai:notes-changed', listener)
  }
}

// The AI assistant surface.
contextBridge.exposeInMainWorld('ai', aiApi)

const settingsApi: SettingsApi = {
  get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  set: (patch: DeepPartial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),
  reset: (): Promise<AppSettings> => ipcRenderer.invoke('settings:reset'),
  // Like the other subscription helpers, this returns an unsubscribe function.
  onChanged: (cb: (settings: AppSettings) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, settings: AppSettings): void => cb(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('settings:app-info'),
  reveal: (target: 'data' | 'assets') => ipcRenderer.invoke('settings:reveal', target)
}

// The settings surface.
contextBridge.exposeInMainWorld('settings', settingsApi)
