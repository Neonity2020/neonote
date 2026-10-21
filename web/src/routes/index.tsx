import * as React from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useSession } from '~/lib/auth-client'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  const { data: session, isPending } = useSession()

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Notion Clone
          <span className="text-neutral-400"> Web</span>
        </h1>
        <p className="text-lg text-neutral-500 dark:text-neutral-400">
          TanStack Start + better-auth + drizzle + Turso, running on Cloudflare
          Workers.
        </p>
      </div>

      <div className="flex items-center gap-3">
        {isPending ? (
          <span className="text-neutral-400">Loading…</span>
        ) : session ? (
          <Link
            to="/dashboard"
            className="rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Open dashboard
          </Link>
        ) : (
          <>
            <Link
              to="/signup"
              className="rounded-lg bg-neutral-900 px-5 py-2.5 font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Get started
            </Link>
            <Link
              to="/login"
              className="rounded-lg border border-neutral-300 px-5 py-2.5 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Log in
            </Link>
          </>
        )}
      </div>
    </main>
  )
}
