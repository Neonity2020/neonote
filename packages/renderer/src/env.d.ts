/// <reference types="vite/client" />

import type { AiApi, NotionApi, SettingsApi } from '@neonity/notion-clone-shared'

declare global {
  interface Window {
    // The three bridge surfaces injected by the preload script.
    api: NotionApi
    ai: AiApi
    settings: SettingsApi
  }
}

export {}
