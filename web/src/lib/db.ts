import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from '~/db/schema'

function createDb() {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. Copy web/.dev.vars.example to web/.dev.vars for local dev.',
    )
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  return drizzle(client, { schema })
}

type Database = ReturnType<typeof createDb>

let instance: Database | undefined

// One client per isolate; reused across requests.
export function getDb(): Database {
  instance ??= createDb()
  return instance
}
