import type { PageMeta } from '~/lib/shared'
import { FileText, Plus } from 'lucide-react'
import { cn } from '~/lib/utils'

/** A picker entry: either an existing page or the "create this title" option. */
export interface LinkPickerItem {
  kind: 'page' | 'create'
  title: string
  page: PageMeta | null
}

interface LinkPickerProps {
  items: LinkPickerItem[]
  selectedIndex: number
  onSelect: (item: LinkPickerItem) => void
  onHover: (index: number) => void
}

/**
 * The wiki-link picker. It offers the matching pages plus a "create this title" entry when no
 * page has exactly that name.
 */
export function LinkPicker({
  items,
  selectedIndex,
  onSelect,
  onHover
}: LinkPickerProps): JSX.Element {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
      <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">链接到页面</div>
      <div className="max-h-72 overflow-y-auto p-1">
        {items.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">没有匹配的页面</div>
        )}
        {items.map((item, index) => {
          const icon = item.page?.icon
          return (
            <button
              key={`${item.kind}-${item.title}`}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left',
                index === selectedIndex ? 'bg-accent text-accent-foreground' : ''
              )}
              onMouseDown={(e) => {
                // Select on mousedown so the block keeps the focus and the caret.
                e.preventDefault()
                onSelect(item)
              }}
              onMouseEnter={() => onHover(index)}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-background text-lg">
                {item.kind === 'create' ? (
                  <Plus className="h-4 w-4" />
                ) : icon ? (
                  icon
                ) : (
                  <FileText className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.kind === 'create' ? '新建页面' : '链接到已有页面'}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
