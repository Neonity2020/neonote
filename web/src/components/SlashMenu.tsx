import type { BlockTypeMeta } from '~/lib/blockTypes'
import { cn } from '~/lib/utils'

interface SlashMenuProps {
  items: BlockTypeMeta[]
  selectedIndex: number
  onSelect: (item: BlockTypeMeta) => void
  onHover: (index: number) => void
}

/**
 * The slash menu: the block-type picker, listing the block types the current block is converted
 * into.
 */
export function SlashMenu({ items, selectedIndex, onSelect, onHover }: SlashMenuProps): JSX.Element {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
      <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">基本块</div>
      <div className="max-h-72 overflow-y-auto p-1">
        {items.length === 0 && (
          <div className="px-3 py-2 text-sm text-muted-foreground">没有匹配的块类型</div>
        )}
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <button
              key={item.type}
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
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-background">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm">{item.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
