import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { getDb } from './db'
import * as schema from '~/db/schema'

// Server-only. Handles /api/auth/* requests and is used inside server functions.
export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'sqlite',
    schema,
  }),
  emailAndPassword: { enabled: true },
  plugins: [tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
