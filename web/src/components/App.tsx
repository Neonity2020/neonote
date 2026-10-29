import { useEffect, useState } from 'react'
import { Menu, Plus } from 'lucide-react'
import { useStore } from '~/store'
import { useSettings } from '~/settingsStore'
import { Sidebar } from './Sidebar'
import { Editor } from './Editor'
import { DailyNoteView } from './DailyNoteView'
import { SettingsPanel } from './SettingsPanel'
import { Button } from './ui/button'
import { TooltipProvider } from './ui/tooltip'
import { CONTENT_WIDTHS } from '~/lib/shared'
import { syncPageFavicon } from '~/lib/favicon'

// Web 版基于 Electron 版 App 复刻，去掉了 AI 助手入口（Web 端暂无 AI 后端）。
export default function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const currentPageId = useStore((s) => s.currentPageId)
  const activeView = useStore((s) => s.activeView)
  const currentPageIcon = useStore(
    (s) => s.pages.find((page) => page.id === s.currentPageId)?.icon
  )
  const createPage = useStore((s) => s.createPage)

  const loadSettings = useSettings((s) => s.load)
  const updateSettings = useSettings((s) => s.update)
  const theme = useSettings((s) => s.settings.theme)
  const editor = useSettings((s) => s.settings.editor)

  const [ready, setReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    void init()
    void loadSettings().finally(() => setReady(true))
  }, [init, loadSettings])

  useEffect(() => {
    syncPageFavicon(currentPageIcon)
    return () => syncPageFavicon(null)
  }, [currentPageIcon])

  // Pick up settings changed by the main process or by another window.
  useEffect(() => {
    return window.settings.onChanged((next) => {
      useSettings.setState({ settings: next })
    })
  }, [])

  // Track the system theme, used when the user picks "system".
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Any page navigation (row click, search hit, page creation) or a switch
  // between the page editor and the daily view closes the mobile drawer. The
  // state is invisible on md+, so firing there is harmless.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [currentPageId, activeView])

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen])

  // An explicit choice wins; "system" follows the OS preference.
  const dark = theme === 'dark' || (theme === 'system' && systemDark)

  useEffect(() => {
    // The `dark` class drives the Tailwind dark variant, `colorScheme` aligns
    // native form controls and scrollbars with it.
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])

  // The appearance settings are published as CSS custom properties that the
  // editor CSS consumes directly.
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--editor-font-size', `${editor.fontSize}px`)
    root.setProperty('--editor-max-width', `${CONTENT_WIDTHS[editor.contentWidth]}px`)
  }, [editor.fontSize, editor.contentWidth])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          dark={dark}
          onToggleTheme={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}
          onOpenSettings={() => setSettingsOpen(true)}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />
        <div className="relative isolate h-full min-w-0 flex-1">
          {/* Mobile-only hamburger: sits over the cover / top padding zone, Notion-style. */}
          {!mobileNavOpen && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="打开侧边栏"
              className="absolute left-2 top-2 z-30 bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm md:hidden"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu />
            </Button>
          )}
          <main className="h-full overflow-y-auto">
            {!ready ? null : activeView === 'daily' ? (
              <DailyNoteView />
            ) : currentPageId ? (
              // Remount the editor per page, so per-page state cannot leak between pages.
              <Editor key={currentPageId} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4">
                <p className="text-sm text-muted-foreground">还没有任何页面</p>
                <Button onClick={() => void createPage(null)}>
                  <Plus /> 创建第一个页面
                </Button>
              </div>
            )}
          </main>
        </div>
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </TooltipProvider>
  )
}
