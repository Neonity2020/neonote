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
    // @neonity/notion-clone-shared is a TypeScript-source package whose `main`
    // points at src/index.ts, so it cannot be required at runtime. It is
    // excluded from externalization and bundled into out/main instead.
    plugins: [externalizeDepsPlugin({ exclude: ['@neonity/notion-clone-shared'] })],
    build: {
      rollupOptions: {
        // node:sqlite is a Node built-in, it must stay an external require.
        external: ['node:sqlite']
      }
    }
  },
  preload: {
    // Same reason as in the main process: the shared package ships TypeScript
    // sources, so it has to be bundled rather than required at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['@neonity/notion-clone-shared'] })]
  },
  renderer: {
    // The renderer lives in packages/renderer, not in src/renderer.
    root: 'packages/renderer',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'packages/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // electron-vite looks for src/renderer/index.html by default, so the
        // input has to be spelled out once the root is overridden.
        input: resolve(__dirname, 'packages/renderer/index.html')
      }
    }
  }
})
