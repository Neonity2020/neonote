import { defineConfig } from 'drizzle-kit'

// drizzle-kit's sqlite dialect only accepts `url`; the libsql auth token is
// appended as a URL query param (@libsql/client supports `?authToken=`).
const url = process.env.TURSO_DATABASE_URL ?? 'http://127.0.0.1:8080'
const token = process.env.TURSO_AUTH_TOKEN

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: token ? `${url}?authToken=${encodeURIComponent(token)}` : url,
  },
})
