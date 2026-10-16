/// <reference types="vite/client" />

import type { AiApi, NotionApi, SettingsApi } from '../../shared/types'

declare global {
  interface Window {
    api: NotionApi
    ai: AiApi
    settings: SettingsApi
  }
}

export {}
