import { useEffect, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { useStore } from './store'
import { useSettings } from './settingsStore'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { AssistantPanel } from './components/AssistantPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { Button } from './components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { CONTENT_WIDTHS } from '@neonity/notion-clone-shared'

export default function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const currentPageId = useStore((s) => s.currentPageId)
  const createPage = useStore((s) => s.createPage)
  const refreshFromAi = useStore((s) => s.refreshFromAi)

  const loadSettings = useSettings((s) => s.load)
  const updateSettings = useSettings((s) => s.update)
  const theme = useSettings((s) => s.settings.theme)
  const editor = useSettings((s) => s.settings.editor)

  const [ready, setReady] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  useEffect(() => {
    void init()
    void loadSettings().finally(() => setReady(true))
  }, [init, loadSettings])

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

  // The AI assistant changed a note: refresh the sidebar and the editor.
  useEffect(() => {
    return window.ai.onNotesChanged(() => {
      void refreshFromAi()
    })
  }, [refreshFromAi])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          dark={dark}
          onToggleTheme={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="relative isolate h-full min-w-0 flex-1">
          <main className="h-full overflow-y-auto">
            {!ready ? null : currentPageId ? (
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
          {!assistantOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute right-4 top-3 z-10 bg-background shadow-sm"
                  onClick={() => setAssistantOpen(true)}
                >
                  <Sparkles />
                </Button>
              </TooltipTrigger>
              <TooltipContent>AI 助手</TooltipContent>
            </Tooltip>
          )}
        </div>
        {assistantOpen && <AssistantPanel onClose={() => setAssistantOpen(false)} />}
      </div>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </TooltipProvider>
  )
}
