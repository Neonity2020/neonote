/// <reference types="vite/client" />

import type { NotionApi } from '../../shared/types'

declare global {
  interface Window {
    api: NotionApi
  }
}

export {}
