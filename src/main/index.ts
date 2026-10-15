import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { basename, extname } from 'node:path'
import * as db from './db'
import { ASSET_SCHEME, MIME_BY_EXT, gcAssets, getAssetsDir, pickImage, saveImage } from './assets'
import type {
  CreateBlockInput,
  CreatePageInput,
  SaveImageInput,
  UpdateBlockInput,
  UpdatePageInput
} from '../shared/types'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Notion Clone',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('pages:list', () => db.listPages())
  ipcMain.handle('pages:create', (_e, input: CreatePageInput) => db.createPage(input))
  ipcMain.handle('pages:update', (_e, input: UpdatePageInput) => db.updatePage(input))
  ipcMain.handle('pages:delete', (_e, id: string) => db.deletePage(id))
  ipcMain.handle('pages:reset-welcome', () => db.resetWelcomePage())

  ipcMain.handle('blocks:list', (_e, pageId: string) => db.listBlocks(pageId))
  ipcMain.handle('blocks:create', (_e, input: CreateBlockInput) => db.createBlock(input))
  ipcMain.handle('blocks:update', (_e, input: UpdateBlockInput) => db.updateBlock(input))
  ipcMain.handle('blocks:delete', (_e, id: string) => db.deleteBlock(id))
  ipcMain.handle('blocks:reorder', (_e, pageId: string, orderedIds: string[]) =>
    db.reorderBlocks(pageId, orderedIds)
  )

  ipcMain.handle('search:query', (_e, query: string) => db.search(query))

  ipcMain.handle('images:save', (_e, input: SaveImageInput) => saveImage(input))
  ipcMain.handle('images:pick', () => pickImage())
}

function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const id = basename(decodeURIComponent(url.pathname))
      const filePath = join(getAssetsDir(), id)
      const res = await net.fetch(pathToFileURL(filePath).toString())
      const headers = new Headers(res.headers)
      headers.set('Content-Type', MIME_BY_EXT[extname(id).toLowerCase()] ?? 'application/octet-stream')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

app.setName('notion-clone')

protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

app.whenReady().then(() => {
  db.initDb()
  gcAssets(db.listImageAssetIds())
  registerAssetProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
