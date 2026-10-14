import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { Button } from './components/ui/button'
import { TooltipProvider } from './components/ui/tooltip'

export default function App(): JSX.Element {
  const init = useStore((s) => s.init)
  const currentPageId = useStore((s) => s.currentPageId)
  const createPage = useStore((s) => s.createPage)
  const [ready, setReady] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')

  useEffect(() => {
    void init().finally(() => setReady(true))
  }, [init])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar dark={dark} onToggleTheme={() => setDark((v) => !v)} />
        <main className="h-full min-w-0 flex-1 overflow-y-auto">
          {!ready ? null : currentPageId ? (
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
    </TooltipProvider>
  )
}
