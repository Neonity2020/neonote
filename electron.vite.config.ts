import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// ELECTRON_RUN_AS_NODE leaks in when the terminal's parent process is itself an Electron
// app (e.g. an IDE). It forces Electron to run as plain Node, so `require('electron')`
// returns the binary path string instead of the Electron API -> `electron.app` is undefined.
// Drop it here so the spawned Electron process never inherits it.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node:sqlite']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
