import { useCallback, useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, FileText, Link2, Plus } from 'lucide-react'
import type { PageLinks } from '@neonity/notion-clone-shared'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

interface LinkPanelProps {
  pageId: string
}

/**
 * 页面底部的双向链接面板。
 *
 * - 「引用了本页」= 反向链接:哪些页面的正文里写了 `[[本页标题]]`
 * - 「本页引用」= 出链:本页正文里写了哪些 `[[标题]]`
 *
 * 链接本身没有单独的表,`[[标题]]` 就是块正文里的一段纯文本,
 * 所以这里查的是实时解析出来的结果,永远和正文一致。
 */
export function LinkPanel({ pageId }: LinkPanelProps): JSX.Element | null {
  const [links, setLinks] = useState<PageLinks | null>(null)
  const selectPage = useStore((s) => s.selectPage)
  const createPage = useStore((s) => s.createPage)
  // 页面增删改名会让已有链接的解析结果变化,这个版本号用来触发刷新
  const linksVersion = useStore((s) => s.linksVersion)
  const blocks = useStore((s) => s.blocks)

  const load = useCallback(async (): Promise<void> => {
    const res = await window.api.getPageLinks(pageId)
    setLinks(res)
  }, [pageId])

  useEffect(() => {
    void load()
  }, [load, linksVersion])

  // 正文改动也会影响链接关系,但编辑是高频动作,停手一会儿再查
  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 600)
    return () => clearTimeout(timer)
  }, [blocks, load])

  if (!links) return null
  const { outgoing, backlinks } = links
  if (outgoing.length === 0 && backlinks.length === 0) return null

  /** 打开出链目标;页面不存在就按标题建一个 */
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

      {/* ---------- 反向链接 ---------- */}
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

      {/* ---------- 出链 ---------- */}
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
