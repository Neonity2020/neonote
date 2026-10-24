import { createFileRoute, redirect, isRedirect } from '@tanstack/react-router'
import { getSession } from '~/server/session'
import App from '~/components/App'
// 桥接注入（window.api / window.settings / window.ai）必须先于工作区组件加载。
import '~/lib/bridge'

export const Route = createFileRoute('/dashboard')({
  // 纯客户端工作区：状态都在 zustand + window 桥里，SSR 没有意义还容易踩 window 引用。
  ssr: false,
  beforeLoad: async () => {
    // 断网/服务端不可达时放行:工作区数据在 IndexedDB 里,离线照常可用,
    // 同步引擎会在侧栏显示离线状态。明确拿到「无会话」才跳登录页。
    try {
      const session = await getSession()
      if (!session) {
        throw redirect({ to: '/login' })
      }
      return { session }
    } catch (err) {
      if (isRedirect(err)) throw err
      return { session: null }
    }
  },
  component: WorkspacePage,
})

function WorkspacePage() {
  return <App />
}
