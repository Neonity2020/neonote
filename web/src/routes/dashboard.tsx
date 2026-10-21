import * as React from 'react'
import {
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { signOut } from '~/lib/auth-client'
import { getSession } from '~/server/session'
import { createNote, listNotes } from '~/server/notes'
import type { Note } from '~/db/schema'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) {
      throw redirect({ to: '/login' })
    }
    return { session }
  },
  loader: () => listNotes(),
  component: DashboardPage,
})

function DashboardPage() {
  const { session } = Route.useRouteContext()
  const notes = Route.useLoaderData()
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [content, setContent] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCreating(true)
    try {
      await createNote({ data: { title, content } })
      setTitle('')
      setContent('')
      // Re-run the loader so the new note shows up.
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note')
    } finally {
      setCreating(false)
    }
  }

  async function handleSignOut() {
    await signOut()
    await router.navigate({ to: '/login' })
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-neutral-500">
            Signed in as {session.user.email}
          </p>
        </div>
        <button
          onClick={handleSignOut}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Sign out
        </button>
      </header>

      <form onSubmit={handleCreate} className="mb-10 space-y-3">
        <h2 className="font-semibold">New note</h2>
        <input
          type="text"
          required
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
        />
        <textarea
          placeholder="Content (optional)"
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
        />
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {creating ? 'Saving…' : 'Add note'}
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="font-semibold">Notes ({notes.length})</h2>
        {notes.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No notes yet — create your first one above. Stored in Turso via
            drizzle.
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n: Note) => (
              <li
                key={n.id}
                className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <p className="font-medium">{n.title}</p>
                {n.content && (
                  <p className="mt-1 text-sm text-neutral-500">{n.content}</p>
                )}
                <p className="mt-1 text-xs text-neutral-400">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
