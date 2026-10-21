import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '~/lib/db'
import { note } from '~/db/schema'
import { getSession } from './session'
import type { Note } from '~/db/schema'

export const listNotes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Note[]> => {
    const session = await getSession()
    if (!session) return []
    return getDb()
      .select()
      .from(note)
      .where(eq(note.userId, session.user.id))
      .orderBy(desc(note.createdAt))
  },
)

interface CreateNoteInput {
  title: string
  content: string
}

export const createNote = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d as CreateNoteInput)
  .handler(async ({ data }): Promise<Note> => {
    const session = await getSession()
    if (!session) {
      throw new Error('Unauthorized')
    }
    const title = data.title.trim()
    if (!title || title.length > 200) {
      throw new Error('Title must be 1-200 characters')
    }
    const [created] = await getDb()
      .insert(note)
      .values({
        id: randomUUID(),
        title,
        content: data.content.trim(),
        userId: session.user.id,
      })
      .returning()
    return created
  })
