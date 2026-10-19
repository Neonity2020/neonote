/// <reference types="vite/client" />

import type { AiApi, NotionApi, SettingsApi } from '@neonity/notion-clone-shared'

declare global {
  interface Window {
    api: NotionApi
    ai: AiApi
    settings: SettingsApi
  }
}

export {}
