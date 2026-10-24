/// <reference types="vite/client" />

import type { AiApi, NotionApi, SettingsApi } from '@neonity/neonote-shared'

declare global {
  interface Window {
    // The three bridge surfaces injected by the preload script.
    api: NotionApi
    ai: AiApi
    settings: SettingsApi
  }
}

export {}

// opencc-js 未自带类型声明；实际用到的只有 Converter。
declare module 'opencc-js' {
  export function Converter(options: { from: string; to: string }): (text: string) => string
}
