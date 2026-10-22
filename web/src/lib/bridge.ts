import { api } from './api'
import { settingsApi } from './settingsApi'
import { aiApi } from './aiApi'

/**
 * 桥接注入：UI 包的组件与 store 通过 window.api / window.settings / window.ai
 * 工作（与 Electron 端的 contextBridge 同构），这里在 Web 端提供同名实现。
 * 必须在进入工作区路由前导入。
 */
if (typeof window !== 'undefined') {
  window.api = api
  window.settings = settingsApi
  window.ai = aiApi
}
