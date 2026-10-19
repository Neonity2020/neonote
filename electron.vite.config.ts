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
    // @neonity/notion-clone-shared 是 .ts 源码包（main 指向 src/index.ts），不能被
    // 运行时 require，必须排除出外部化、直接打进 out/main
    plugins: [externalizeDepsPlugin({ exclude: ['@neonity/notion-clone-shared'] })],
    build: {
      rollupOptions: {
        external: ['node:sqlite']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@neonity/notion-clone-shared'] })]
  },
  renderer: {
    root: 'packages/renderer',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'packages/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // electron-vite 的默认 input 固定从 src/renderer/index.html 找，自定义 root 后必须显式指定
        input: resolve(__dirname, 'packages/renderer/index.html')
      }
    }
  }
})
