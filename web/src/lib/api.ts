import type { AssetBytes, NotionApi, SaveImageInput, SavedImage } from '~/lib/shared'
import {
  listPages,
  createPage,
  updatePage,
  deletePage,
  movePage,
  resetWelcomePage,
  search,
  getPageLinks,
} from '~/server/pages'
import {
  listBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  reorderBlocks,
} from '~/server/blocks'
import { fetchAssetBytes, saveImage, saveAudio } from '~/server/assets'

function toBase64(buffer: ArrayBuffer): string {
  // server fn 边界只走 JSON，ArrayBuffer 先转 base64。
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function uploadImage(input: SaveImageInput): Promise<SavedImage> {
  const dataBase64 = toBase64(input.data)
  return saveImage({ data: { name: input.name, mime: input.mime, dataBase64 } })
}

async function uploadAudio(input: SaveImageInput): Promise<SavedImage> {
  const dataBase64 = toBase64(input.data)
  return saveAudio({ data: { name: input.name, mime: input.mime, dataBase64 } })
}

/** 浏览器版文件选择框，取代 Electron 的系统对话框。accept 限定类型。 */
function pickFile(
  accept: string,
  upload: (input: SaveImageInput) => Promise<SavedImage>,
  fallbackMime: string,
): Promise<SavedImage | null> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (value: SavedImage | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return settle(null)
      try {
        const buffer = await file.arrayBuffer()
        const saved = await upload({ name: file.name, mime: file.type || fallbackMime, data: buffer })
        settle(saved)
      } catch (error) {
        reject(error)
      }
    })
    input.addEventListener('cancel', () => settle(null))
    input.click()
  })
}

const pickImage = (): Promise<SavedImage | null> => pickFile('image/*', uploadImage, 'image/png')
const pickAudio = (): Promise<SavedImage | null> => pickFile('audio/*', uploadAudio, 'audio/mpeg')

function base64ToArrayBuffer(dataBase64: string): ArrayBuffer {
  const binary = atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/** 读回应用自产资产的字节（R2 公网 URL 无 CORS 头，浏览器 fetch 不到时走这里）。 */
async function readAssetBytes(url: string): Promise<AssetBytes | null> {
  const result = await fetchAssetBytes({ data: url })
  if (!result) return null
  return { mime: result.mime, data: base64ToArrayBuffer(result.dataBase64) }
}

/**
 * NotionApi 的 Web 实现：每个方法对应一个 server 函数（走 TanStack Start 的
 * RPC fetch）。组件通过 window.api 使用它，与 Electron 端的 contextBridge 同构。
 */
export const api: NotionApi = {
  listPages: () => listPages(),
  createPage: (input) => createPage({ data: input }),
  updatePage: (input) => updatePage({ data: input }),
  deletePage: (id) => deletePage({ data: id }),
  movePage: (input) => movePage({ data: input }),
  resetWelcomePage: () => resetWelcomePage(),
  listBlocks: (pageId) => listBlocks({ data: pageId }),
  createBlock: (input) => createBlock({ data: input }),
  updateBlock: (input) => updateBlock({ data: input }),
  deleteBlock: (id) => deleteBlock({ data: id }),
  reorderBlocks: (pageId, orderedIds) => reorderBlocks({ data: { pageId, orderedIds } }),
  search: (query) => search({ data: query }),
  getPageLinks: (pageId) => getPageLinks({ data: pageId }),
  saveImage: (input) => uploadImage(input),
  pickImage,
  saveAudio: (input) => uploadAudio(input),
  pickAudio,
  fetchAssetBytes: readAssetBytes,
}
