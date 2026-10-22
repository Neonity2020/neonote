import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', {
    mode: 'timestamp',
  }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', {
    mode: 'timestamp',
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

// ---------- Workspace（复刻 Electron 版 pages/blocks 表结构，增加 userId 隔离） ----------

// 兄弟顺序用小数 position，插入取中点；时间戳是 epoch 毫秒，与 PageMeta 契约一致。
export const page = sqliteTable('page', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  icon: text('icon'),
  parentId: text('parent_id').references((): AnySQLiteColumn => page.id, {
    onDelete: 'cascade',
  }),
  position: real('position').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const block = sqliteTable('block', {
  id: text('id').primaryKey(),
  pageId: text('page_id')
    .notNull()
    .references(() => page.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('paragraph'),
  // JSON TEXT 单列，块类型差异都收在 content 里（与 Electron 版一致）。
  content: text('content').notNull().default('{}'),
  position: real('position').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  // 冗余 userId：搜索 / 反链要全表扫描块，带这一列就不用每次 join page 判权属。
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

// 图片块资产：base64 存库，通过 /api/asset/$id 路由回源（Electron 版存本地文件）。
export const asset = sqliteTable('asset', {
  id: text('id').primaryKey(),
  mime: text('mime').notNull(),
  data: text('data').notNull(),
  createdAt: integer('created_at').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})
