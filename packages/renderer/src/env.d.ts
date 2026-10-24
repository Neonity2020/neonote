/// <reference types="vite/client" />

import type { AiApi, NeoNoteApi, SettingsApi } from '@neonity/neonote-shared'

declare global {
  interface Window {
    // The three bridge surfaces injected by the preload script.
    api: NeoNoteApi
    ai: AiApi
    settings: SettingsApi
  }
}

export {}

// opencc-js 未自带类型声明；实际用到的只有 Converter。
declare module 'opencc-js' {
  export function Converter(options: { from: string; to: string }): (text: string) => string
}
