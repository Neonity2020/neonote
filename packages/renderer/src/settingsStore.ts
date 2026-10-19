import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from '@neonity/notion-clone-shared'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: DeepPartial<AppSettings>) => Promise<void>
  resetAll: () => Promise<void>
}

export const useSettings = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const settings = await window.settings.get()
    set({ settings, loaded: true })
  },

  update: async (patch) => {
    // 主进程负责校验与落库,回传的就是最终生效值
    const settings = await window.settings.set(patch)
    set({ settings })
  },

  resetAll: async () => {
    const settings = await window.settings.reset()
    set({ settings })
  }
}))
