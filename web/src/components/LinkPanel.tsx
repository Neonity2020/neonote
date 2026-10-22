import { useCallback, useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, FileText, Link2, Plus } from 'lucide-react'
import type { PageLinks } from '~/lib/shared'
import { useStore } from '~/store'
import { cn } from '~/lib/utils'

interface LinkPanelProps {
  pageId: string
}

/**
 * The bidirectional link panel at the bottom of a page.
 *
 * - "references this page" = the backlinks: pages whose body contains `[[this page's title]]`
 * - "this page references" = the outgoing links: the `[[title]]` links in this page's body
 *
 * There is no separate link table: a `[[title]]` is plain text inside a block body, so the links
 * are parsed live from the blocks and are always consistent with the text.
 */
export function LinkPanel({ pageId }: LinkPanelProps): JSX.Element | null {
  const [links, setLinks] = useState<PageLinks | null>(null)
  const selectPage = useStore((s) => s.selectPage)
  const createPage = useStore((s) => s.createPage)
  // Creating, renaming or deleting a page changes how existing links resolve; this counter
  // triggers a refresh.
  const linksVersion = useStore((s) => s.linksVersion)
  const blocks = useStore((s) => s.blocks)

  const load = useCallback(async (): Promise<void> => {
    const res = await window.api.getPageLinks(pageId)
    setLinks(res)
  }, [pageId])

  useEffect(() => {
    void load()
  }, [load, linksVersion])

  // Body edits also change the link relations, but typing is high-frequency and every query scans
  // the blocks, so the refresh is debounced.
  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 600)
    return () => clearTimeout(timer)
  }, [blocks, load])

  if (!links) return null
  const { outgoing, backlinks } = links
  if (outgoing.length === 0 && backlinks.length === 0) return null

  /** Open an outgoing link target; create the page from the title when it does not exist. */
  const openOutgoing = async (title: string, targetId: string | null): Promise<void> => {
    if (targetId) {
      await selectPage(targetId)
      return
    }
    await createPage(null, title)
  }

  return (
    <section className="mt-10 border-t pt-4 text-sm">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />
        链接
      </div>

      {/* ---------- Backlinks ---------- */}
      {backlinks.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDownLeft className="h-3.5 w-3.5" />
            引用了本页
            <span className="text-muted-foreground/60">({backlinks.length})</span>
          </div>
          <ul className="space-y-1">
            {backlinks.map((b) => (
              <li key={`${b.pageId}-${b.blockId}`}>
                <button
                  className="group w-full rounded px-1.5 py-1 text-left hover:bg-accent/60"
                  onClick={() => void selectPage(b.pageId, b.blockId)}
                  title="跳到引用本页的那一块"
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <span>{b.pageIcon ?? <FileText className="h-3 w-3" />}</span>
                    <span className="truncate">{b.pageTitle}</span>
                  </span>
                  {b.snippet && (
                    <span className="mt-0.5 block truncate pl-5 text-[11px] text-muted-foreground">
                      {b.snippet}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- Outgoing links ---------- */}
      {outgoing.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowUpRight className="h-3.5 w-3.5" />
            本页引用
            <span className="text-muted-foreground/60">({outgoing.length})</span>
          </div>
          <ul className="space-y-1">
            {outgoing.map((o) => (
              <li key={o.title}>
                <button
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent/60"
                  onClick={() => void openOutgoing(o.title, o.pageId)}
                  title={o.pageId ? `打开「${o.title}」` : `创建「${o.title}」`}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center text-center text-sm',
                      !o.pageId && 'text-muted-foreground'
                    )}
                  >
                    {o.pageId ? (
                      o.pageIcon ?? <FileText className="h-3 w-3" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'truncate',
                      o.pageId ? 'font-medium' : 'text-muted-foreground'
                    )}
                  >
                    {o.title}
                  </span>
                  {!o.pageId && <span className="text-[11px] text-muted-foreground">未创建</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
