import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '~/lib/auth'

export const getSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionInfo | null> => {
    const request = getRequest()
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return null
    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
      expiresAt: session.session.expiresAt.toISOString(),
    }
  },
)

export interface SessionInfo {
  user: {
    id: string
    name: string
    email: string
    image: string | null
  }
  expiresAt: string
}
