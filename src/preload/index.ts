import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateBlockInput,
  CreatePageInput,
  NotionApi,
  SaveImageInput,
  UpdateBlockInput,
  UpdatePageInput
} from '../shared/types'

const api: NotionApi = {
  listPages: () => ipcRenderer.invoke('pages:list'),
  createPage: (input: CreatePageInput) => ipcRenderer.invoke('pages:create', input),
  updatePage: (input: UpdatePageInput) => ipcRenderer.invoke('pages:update', input),
  deletePage: (id: string) => ipcRenderer.invoke('pages:delete', id),

  listBlocks: (pageId: string) => ipcRenderer.invoke('blocks:list', pageId),
  createBlock: (input: CreateBlockInput) => ipcRenderer.invoke('blocks:create', input),
  updateBlock: (input: UpdateBlockInput) => ipcRenderer.invoke('blocks:update', input),
  deleteBlock: (id: string) => ipcRenderer.invoke('blocks:delete', id),
  reorderBlocks: (pageId: string, orderedIds: string[]) =>
    ipcRenderer.invoke('blocks:reorder', pageId, orderedIds),

  search: (query: string) => ipcRenderer.invoke('search:query', query),

  saveImage: (input: SaveImageInput) => ipcRenderer.invoke('images:save', input),
  pickImage: () => ipcRenderer.invoke('images:pick')
}

contextBridge.exposeInMainWorld('api', api)
