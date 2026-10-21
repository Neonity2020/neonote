import { createAuthClient } from 'better-auth/react'

// Same origin as the auth server, so no baseURL needed.
export const authClient = createAuthClient()

export const { signIn, signUp, signOut, useSession } = authClient
