import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '~/server/session'
import App from '~/components/App'
// 桥接注入（window.api / window.settings / window.ai）必须先于工作区组件加载。
import '~/lib/bridge'

export const Route = createFileRoute('/dashboard')({
  // 纯客户端工作区：状态都在 zustand + window 桥里，SSR 没有意义还容易踩 window 引用。
  ssr: false,
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: '/login' })
    }
    return { session }
  },
  component: WorkspacePage,
})

function WorkspacePage() {
  return <App />
}
