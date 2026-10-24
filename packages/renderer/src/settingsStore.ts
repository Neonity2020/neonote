import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from '@neonity/neonote-shared'

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
    // The main process owns validation and persistence, so the value it returns
    // is already the final effective settings.
    const settings = await window.settings.set(patch)
    set({ settings })
  },

  resetAll: async () => {
    const settings = await window.settings.reset()
    set({ settings })
  }
}))
