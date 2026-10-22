import type { NotionApi, SaveImageInput, SavedImage } from '~/lib/shared'
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
import { saveImage } from '~/server/assets'

async function uploadImage(input: SaveImageInput): Promise<SavedImage> {
  // server fn 边界只走 JSON，ArrayBuffer 先转 base64。
  const bytes = new Uint8Array(input.data)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const dataBase64 = btoa(binary)
  return saveImage({ data: { name: input.name, mime: input.mime, dataBase64 } })
}

/** 浏览器版 pickImage：动态建一个文件选择框，取代 Electron 的系统对话框。 */
async function pickImage(): Promise<SavedImage | null> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
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
        const saved = await uploadImage({ name: file.name, mime: file.type || 'image/png', data: buffer })
        settle(saved)
      } catch (error) {
        reject(error)
      }
    })
    input.addEventListener('cancel', () => settle(null))
    input.click()
  })
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
}
