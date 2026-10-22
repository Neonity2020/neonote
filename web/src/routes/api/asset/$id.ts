import { createFileRoute } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '~/lib/auth'
import { getAssetBytes } from '~/server/queries'

export const Route = createFileRoute('/api/asset/$id')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        const request = getRequest()
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) {
          return new Response('Unauthorized', { status: 401 })
        }
        const found = await getAssetBytes(session.user.id, params.id)
        if (!found) {
          return new Response('Not found', { status: 404 })
        }
        return new Response(found.buffer, {
          headers: {
            'Content-Type': found.mime,
            // 图片内容不可变（id 即地址），客户端可长期缓存。
            'Cache-Control': 'private, max-age=31536000, immutable',
          },
        })
      },
    },
  },
})
