/// <reference types="vite/client" />

import type { AiApi, NeoNoteApi, SettingsApi } from '~/lib/shared'
import type { JSX as ReactJSX } from 'react'

declare global {
  interface Window {
    // Web 端的三个桥接面（lib/bridge.ts 注入），与 Electron preload 注入的同构。
    api: NeoNoteApi
    ai: AiApi
    settings: SettingsApi
  }

  // 组件沿用了 Electron 端的 `JSX.Element` 返回类型注解；React 19 的类型不再
  // 提供全局 JSX 命名空间，这里补一个别名，组件代码保持与桌面版逐字一致。
  namespace JSX {
    type Element = ReactJSX.Element
  }
}

export {}

// opencc-js 未自带类型声明；实际用到的只有 Converter。
declare module 'opencc-js' {
  export function Converter(options: { from: string; to: string }): (text: string) => string
}
