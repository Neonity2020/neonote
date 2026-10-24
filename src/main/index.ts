import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell } from 'electron'
import { join } from 'path'
import { existsSync, renameSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { basename, extname } from 'node:path'
import * as db from './db'
import { registerAi } from './ai'
import { registerSettings, getSettings } from './settings'
import { ASSET_SCHEME, MIME_BY_EXT, fetchAssetBytes, gcAssets, getAssetsDir, pickAudio, pickImage, saveAudio, saveImage } from './assets'
import type {
  CreateBlockInput,
  CreatePageInput,
  MovePageInput,
  SaveImageInput,
  UpdateBlockInput,
  UpdatePageInput
} from '@neonity/neonote-shared'

/** The window background follows the theme setting, so a dark start-up does not flash white. */
function resolvedTheme(): 'light' | 'dark' {
  const theme = getSettings().theme
  if (theme === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return theme
}

/**
 * The app runs as three Electron processes: the main process (Node, owns the
 * database and the AI session), the preload script (the bridge), and the
 * renderer (the UI). The renderer is untrusted UI code, so it runs with
 * contextIsolation on and nodeIntegration off and reaches the main process
 * only through the surfaces the preload script exposes.
 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    // The window is created hidden and shown on 'ready-to-show', so the user
    // never sees a white flash before the first paint.
    show: false,
    backgroundColor: resolvedTheme() === 'dark' ? '#0a0a0b' : '#ffffff',
    title: 'NeoNote',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // The renderer gets no Node or Electron API of its own; everything goes
      // through the preload bridge.
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only web and mail links are handed to the operating system. Any other
    // scheme (file://, custom handlers) could be used to reach resources the
    // app should not open on the user's behalf.
    if (/^(https?|mailto):/i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Register the IPC handlers for pages, blocks, search, links and images. */
function registerIpc(): void {
  ipcMain.handle('pages:list', () => db.listPages())
  ipcMain.handle('pages:create', (_e, input: CreatePageInput) => db.createPage(input))
  ipcMain.handle('pages:update', (_e, input: UpdatePageInput) => db.updatePage(input))
  ipcMain.handle('pages:delete', (_e, id: string) => db.deletePage(id))
  ipcMain.handle('pages:move', (_e, input: MovePageInput) => db.movePage(input))
  ipcMain.handle('pages:reset-welcome', () => db.resetWelcomePage())

  ipcMain.handle('blocks:list', (_e, pageId: string) => db.listBlocks(pageId))
  ipcMain.handle('blocks:create', (_e, input: CreateBlockInput) => db.createBlock(input))
  ipcMain.handle('blocks:update', (_e, input: UpdateBlockInput) => db.updateBlock(input))
  ipcMain.handle('blocks:delete', (_e, id: string) => db.deleteBlock(id))
  ipcMain.handle('blocks:reorder', (_e, pageId: string, orderedIds: string[]) =>
    db.reorderBlocks(pageId, orderedIds)
  )

  ipcMain.handle('search:query', (_e, query: string) => db.search(query))

  ipcMain.handle('links:page-links', (_e, pageId: string) => db.getPageLinks(pageId))

  ipcMain.handle('images:save', (_e, input: SaveImageInput) => saveImage(input))
  ipcMain.handle('images:pick', () => pickImage())
  ipcMain.handle('audio:save', (_e, input: SaveImageInput) => saveAudio(input))
  ipcMain.handle('audio:pick', () => pickAudio())
  ipcMain.handle('assets:fetch', (_e, url: string) => fetchAssetBytes(url))
}

/** Serve the files in the asset directory to the renderer over the custom protocol. */
function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      // basename() strips any directory part from the requested path, so a
      // crafted URL cannot escape the asset directory.
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

app.setName('neonote')

/**
 * One-time migration from the old "notion-clone" identity: move the whole user
 * data directory (db + WAL files + assets + preferences) to the neonote path,
 * then rename the db files inside. Skipped whenever the neonote-side target
 * already exists, so a fresh install and a migrated install are idempotent.
 * Must run before anything touches the database or the assets directory.
 */
function migrateLegacyUserData(): void {
  const newPath = app.getPath('userData')
  const oldDir = join(app.getPath('appData'), 'notion-clone')
  try {
    if (!existsSync(newPath) && existsSync(oldDir)) {
      renameSync(oldDir, newPath)
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const from = join(newPath, `notion-clone.db${suffix}`)
      const to = join(newPath, `neonote.db${suffix}`)
      if (existsSync(from) && !existsSync(to)) renameSync(from, to)
    }
  } catch (err) {
    // 迁移失败不阻塞启动:以全新目录运行,旧数据原样保留可手工找回。
    console.error('旧数据目录迁移失败,将以新目录启动:', err)
  }
}

// A custom scheme has to be declared as privileged before the app is ready, so
// the renderer can treat nc-asset:// like a normal, secure origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

app.whenReady()
  .then(() => {
    // In development the dock keeps Electron's default icon. Point it at the
    // real one so the icon can be judged while running; packaged builds take
    // theirs from the bundle (build/icon.icns, generated by electron-builder).
    if (process.platform === 'darwin' && !app.isPackaged) {
      const devIcon = join(__dirname, '../../build/icon.png')
      if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
    }
    migrateLegacyUserData()
    db.initDb()
    // Drop the asset files that no image block references any more.
    gcAssets(db.listImageAssetIds())
    registerAssetProtocol()
    registerIpc()
    registerSettings()
    registerAi()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
  .catch((err) => {
    // A corrupt database or an unwritable data directory used to leave the
    // process alive with no window and no message, so the user only saw a
    // dock icon that did nothing. Report it and quit.
    const message = err instanceof Error ? err.message : String(err)
    dialog.showErrorBox('NeoNote 启动失败', `无法初始化本地数据库：\n${message}`)
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
