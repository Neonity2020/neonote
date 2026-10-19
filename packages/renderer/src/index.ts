// npm 发布入口：导出可复用的 App、状态 store 与主要组件。
// main.tsx 是 Electron 宿主的应用启动入口（index.html 引用），不属于对外 API。
export { default as App } from './App'
export { useStore } from './store'
export { useSettings } from './settingsStore'
export { Editor } from './components/Editor'
export { Sidebar } from './components/Sidebar'
export { cn } from './lib/utils'
