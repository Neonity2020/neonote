import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Trash2
} from 'lucide-react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Separator } from './ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { WELCOME_PAGE_TITLE } from '../../../shared/types'
import type { PageMeta, SearchResult } from '../../../shared/types'

/** 每级缩进宽度,行内 padding 与拖拽投影必须用同一个值 */
const INDENT = 14
/** 行文本左侧的基础留白(不含层级缩进) */
const ROW_PAD = 4

interface SidebarProps {
  dark: boolean
  onToggleTheme: () => void
  onOpenSettings: () => void
}

export function Sidebar({ dark, onToggleTheme, onOpenSettings }: SidebarProps): JSX.Element {
  const pages = useStore((s) => s.pages)
  const selectPage = useStore((s) => s.selectPage)
  const createPage = useStore((s) => s.createPage)
  const movePage = useStore((s) => s.movePage)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  /** 折叠的页面 id(默认全部展开) */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DropPreview | null>(null)

  /** 拖拽过程的落点结果,用 ref 保存以免 state 异步导致松手时读到旧值 */
  const pendingMove = useRef<{ parentId: string | null; index: number } | null>(null)
  /** 拖拽起点(指针位置 + 被拖行的层级),用于把横向位移换算成层级变化 */
  const dragStart = useRef<{ x: number; depth: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  /** 拖拽结束后紧跟的一次 click 不应该触发页面切换 */
  const suppressClick = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        setResults(await window.api.search(q))
      } catch {
        setResults([])
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearching(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const tree = useMemo(() => buildTree(pages), [pages])
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed])
  const activeRow = activeId ? rows.find((r) => r.page.id === activeId) : undefined

  function toggleCollapsed(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSelect(id: string): void {
    if (suppressClick.current) return
    void selectPage(id)
  }

  /**
   * 用指针位置(而不是 dnd-kit 的 over)算落点:
   * - 纵向:与每一行的中线比较,得到"插到第几个间隙"
   * - 横向:换算成缩进层级,"往右拖 = 变成上一行的子页面"
   * 这样判定完全可预测,也不会被"拖影本身仍在列表里"干扰。
   */
  function updatePreview(draggingId: string, clientX: number, clientY: number): void {
    const wrap = wrapRef.current
    if (!wrap) return
    const measured = measureRows(wrap, draggingId)
    if (measured.length === 0) {
      pendingMove.current = { parentId: null, index: 0 }
      setPreview(null)
      return
    }

    const wrapRect = wrap.getBoundingClientRect()

    let gap = measured.length
    for (let i = 0; i < measured.length; i += 1) {
      const rect = measured[i].rect
      if (clientY < rect.top + rect.height / 2) {
        gap = i
        break
      }
    }

    const anchor = gap > 0 ? measured[gap - 1] : null
    const maxDepth = anchor ? anchor.depth + 1 : 0
    // 层级看"相对按下位置的横向位移",而不是指针绝对横坐标:
    // 前者按住不动就是原层级,右移约 14px 才深一级;后者随手抓在行中段就已经深了两级。
    const start = dragStart.current
    const shift = start ? Math.round((clientX - start.x) / INDENT) : 0
    const depth = Math.max(0, Math.min((start?.depth ?? 0) + shift, maxDepth))

    let parentId: string | null = null
    let index = 0
    let displayGap = gap
    let insideId: string | null = null

    if (!anchor) {
      parentId = null
      index = 0
    } else if (depth === anchor.depth + 1) {
      // 比锚点更深一级 → 成为锚点的最后一个子页面
      parentId = anchor.id
      index = siblingCount(pages, anchor.id, activeId)
      insideId = anchor.id
      // 作为子页面插入后,视觉上落在锚点整棵子树之后,指示线也要画在那儿
      let i = gap
      while (i < measured.length && measured[i].depth > anchor.depth) i += 1
      displayGap = i
    } else {
      // 与某个祖先同级 → 插到该行之后
      let ref: MeasuredRow | null = null
      for (let i = gap - 1; i >= 0; i -= 1) {
        if (measured[i].depth === depth) {
          ref = measured[i]
          break
        }
        if (measured[i].depth < depth) break
      }
      if (ref) {
        parentId = pageParent(pages, ref.id)
        index = siblingIndexOf(pages, parentId, ref.id, activeId) + 1
      }
    }

    pendingMove.current = { parentId, index }

    const last = measured[measured.length - 1]
    const top =
      displayGap < measured.length
        ? measured[displayGap].rect.top - wrapRect.top
        : last.rect.bottom - wrapRect.top

    setPreview({
      y: Math.round(top),
      left: depth * INDENT + ROW_PAD - 2,
      depth,
      insideId
    })
  }

  function pointerOf(event: DragStartEvent | DragMoveEvent | DragEndEvent): {
    x: number
    y: number
  } | null {
    const activator = event.activatorEvent as unknown as PointerEvent | undefined
    if (!activator || typeof activator.clientX !== 'number') return null
    // DragStartEvent 没有 delta(拖拽尚未开始),用 0 代替
    const delta = 'delta' in event ? event.delta : { x: 0, y: 0 }
    return { x: activator.clientX + delta.x, y: activator.clientY + delta.y }
  }

  function handleDragStart(event: DragStartEvent): void {
    const id = String(event.active.id)
    setActiveId(id)
    setPreview(null)
    pendingMove.current = null
    const p = pointerOf(event)
    const row = rows.find((r) => r.page.id === id)
    dragStart.current = p ? { x: p.x, depth: row?.depth ?? 0 } : null
    if (p) updatePreview(id, p.x, p.y)
  }

  function handleDragMove(event: DragMoveEvent): void {
    const p = pointerOf(event)
    if (p) updatePreview(String(event.active.id), p.x, p.y)
  }

  function handleDragEnd(event: DragEndEvent): void {
    const draggingId = String(event.active.id)
    const p = pointerOf(event)
    if (p) updatePreview(draggingId, p.x, p.y)
    const target = pendingMove.current
    setActiveId(null)
    setPreview(null)
    pendingMove.current = null
    dragStart.current = null
    if (!target) return

    // 拖拽产生的 pointerup 会紧跟一次 click,拦掉它免得误切页面
    suppressClick.current = true
    setTimeout(() => {
      suppressClick.current = false
    }, 220)

    void applyMove(draggingId, target)
  }

  function handleDragCancel(): void {
    setActiveId(null)
    setPreview(null)
    pendingMove.current = null
    dragStart.current = null
  }

  async function applyMove(
    draggingId: string,
    target: { parentId: string | null; index: number }
  ): Promise<void> {
    if (target.parentId === draggingId) return
    if (target.parentId && isSelfOrDescendant(pages, target.parentId, draggingId)) return
    if (positionUnchanged(pages, draggingId, target)) return

    await movePage(draggingId, target.parentId, target.index)

    // 拖进折叠的页面里时自动展开,否则用户看不到刚移进去的页面
    if (target.parentId) {
      setCollapsed((prev) => {
        if (!prev.has(target.parentId as string)) return prev
        const next = new Set(prev)
        next.delete(target.parentId as string)
        return next
      })
    }
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-foreground text-[10px] font-bold text-background">
            N
          </span>
          Notion Clone
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onToggleTheme}>
              {dark ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{dark ? '切换为浅色' : '切换为深色'}</TooltipContent>
        </Tooltip>
      </div>

      <div className="px-3" ref={searchRef}>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSearching(true)
            }}
            onFocus={() => query.trim() && setSearching(true)}
            placeholder="搜索页面和内容…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        {searching && query.trim() && (
          <div className="absolute z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {results.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">没有找到匹配的结果</div>
            ) : (
              results.map((r, i) => (
                <button
                  key={`${r.pageId}-${r.blockId ?? 'page'}-${i}`}
                  className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    void selectPage(r.pageId)
                    setQuery('')
                    setSearching(false)
                  }}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    <span>{r.pageIcon ?? <FileText className="h-3 w-3" />}</span>
                    <span className="truncate">{r.pageTitle}</span>
                  </span>
                  {r.blockId && (
                    <span className="truncate pl-5 text-[11px] text-muted-foreground">{r.snippet}</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between px-4 py-1">
        <span className="text-xs font-medium text-muted-foreground">页面</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={() => void createPage(null)}>
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>新建页面</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            还没有页面,点击上方 + 创建
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <PageList>
              <div ref={wrapRef} className="relative">
                {rows.map((row) => (
                  <PageRow
                    key={row.page.id}
                    row={row}
                    collapsed={collapsed.has(row.page.id)}
                    active={activeId === row.page.id}
                    highlighted={preview?.insideId === row.page.id}
                    onToggle={() => toggleCollapsed(row.page.id)}
                    onSelect={handleSelect}
                  />
                ))}

                {/* 插入指示线:纵向位置 = 落点间隙,横向缩进 = 拖出来的层级 */}
                {preview && (
                  <div
                    data-drop-indicator
                    data-depth={preview.depth}
                    className="pointer-events-none absolute z-20"
                    style={{ top: preview.y - 1, left: preview.left, right: 6 }}
                  >
                    <div className="relative h-0.5 rounded-full bg-primary">
                      <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full border-2 border-primary bg-background" />
                    </div>
                  </div>
                )}
              </div>
            </PageList>

            <DragOverlay dropAnimation={null}>
              {activeRow ? (
                <div className="flex w-56 items-center gap-1 rounded-md bg-popover px-2 py-1 text-sm shadow-xl ring-1 ring-border">
                  <span className="w-5 shrink-0 text-center text-sm">
                    {activeRow.page.icon ?? (
                      <FileText className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="truncate">{activeRow.page.title || '无标题'}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <Separator />
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="min-w-0 truncate px-2 text-[11px] text-muted-foreground">
          共 {pages.length} 个页面 · 本地保存
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} className="shrink-0">
              <Settings />
            </Button>
          </TooltipTrigger>
          <TooltipContent>设置</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}

/** 让整个列表成为一个可放置区域,拖到空白处也能落在列表末尾 */
function PageList({ children }: { children: ReactNode }): JSX.Element {
  const { setNodeRef } = useDroppable({ id: 'pages-root' })
  return <div ref={setNodeRef}>{children}</div>
}

/* ---------- 拖拽落点 ---------- */

interface DropPreview {
  /** 指示线相对列表容器顶部的偏移 */
  y: number
  /** 指示线相对容器左侧的缩进 */
  left: number
  depth: number
  /** 拖成"子页面"时要高亮的父行 */
  insideId: string | null
}

interface MeasuredRow {
  id: string
  depth: number
  rect: DOMRect
}

/** 量出每一行的位置;拖拽中的那一行本身跳过,否则会干扰间隙计算 */
function measureRows(wrap: HTMLElement, draggingId: string | null): MeasuredRow[] {
  const els = Array.from(wrap.querySelectorAll<HTMLElement>('[data-page-row]'))
  const out: MeasuredRow[] = []
  for (const el of els) {
    const id = el.dataset.pageId
    if (!id || id === draggingId) continue
    out.push({ id, depth: Number(el.dataset.depth ?? 0), rect: el.getBoundingClientRect() })
  }
  return out
}

function pageParent(pages: PageMeta[], id: string): string | null {
  return pages.find((p) => p.id === id)?.parentId ?? null
}

function siblingsOf(pages: PageMeta[], parentId: string | null, excludeId: string | null): PageMeta[] {
  return pages
    .filter((p) => p.parentId === parentId && p.id !== excludeId)
    .sort((a, b) => a.position - b.position)
}

function siblingIndexOf(
  pages: PageMeta[],
  parentId: string | null,
  id: string,
  excludeId: string | null
): number {
  const at = siblingsOf(pages, parentId, excludeId).findIndex((p) => p.id === id)
  return at < 0 ? 0 : at
}

function siblingCount(pages: PageMeta[], parentId: string, excludeId: string | null): number {
  return siblingsOf(pages, parentId, excludeId).length
}

/** 落点和当前状态一致时不必打 IPC */
function positionUnchanged(
  pages: PageMeta[],
  id: string,
  target: { parentId: string | null; index: number }
): boolean {
  const self = pages.find((p) => p.id === id)
  if (!self || self.parentId !== target.parentId) return false
  return siblingIndexOf(pages, target.parentId, id, id) === target.index
}

/** target 是否等于 candidate 或位于其子树中(用于阻止把页面拖进自己的后代) */
function isSelfOrDescendant(pages: PageMeta[], targetId: string, candidateId: string): boolean {
  const byId = new Map(pages.map((p) => [p.id, p]))
  let cur: string | null | undefined = targetId
  const seen = new Set<string>()
  while (cur) {
    if (cur === candidateId) return true
    if (seen.has(cur)) return false
    seen.add(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}

/* ---------- 树 ---------- */

interface TreeNode {
  page: PageMeta
  children: TreeNode[]
}

interface FlatRow {
  page: PageMeta
  depth: number
  hasChildren: boolean
}

function buildTree(pages: PageMeta[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []
  for (const p of pages) {
    map.set(p.id, { page: p, children: [] })
  }
  const sorted = [...pages].sort((a, b) => a.position - b.position)
  for (const p of sorted) {
    const node = map.get(p.id)
    if (!node) continue
    if (p.parentId && map.has(p.parentId)) {
      map.get(p.parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortChildren = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => a.page.position - b.page.position)
    nodes.forEach((n) => sortChildren(n.children))
  }
  sortChildren(roots)
  return roots
}

/** 把树按当前折叠状态压成一行一行,方便拖拽排序时拿到线性顺序 */
function flattenTree(tree: TreeNode[], collapsed: Set<string>): FlatRow[] {
  const rows: FlatRow[] = []
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      rows.push({ page: node.page, depth, hasChildren: node.children.length > 0 })
      if (node.children.length > 0 && !collapsed.has(node.page.id)) {
        walk(node.children, depth + 1)
      }
    }
  }
  walk(tree, 0)
  return rows
}

/* ---------- 单行 ---------- */

interface PageRowProps {
  row: FlatRow
  collapsed: boolean
  active: boolean
  highlighted: boolean
  onToggle: () => void
  onSelect: (id: string) => void
}

function PageRow({
  row,
  collapsed,
  active,
  highlighted,
  onToggle,
  onSelect
}: PageRowProps): JSX.Element {
  const { page, depth, hasChildren } = row
  const createPage = useStore((s) => s.createPage)
  const renamePage = useStore((s) => s.renamePage)
  const deletePage = useStore((s) => s.deletePage)
  const resetWelcomePage = useStore((s) => s.resetWelcomePage)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(page.title)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging
  } = useDraggable({ id: page.id })

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commitRename = (): void => {
    renamePage(page.id, draft.trim())
    setEditing(false)
  }

  return (
    <div
      ref={setDragRef}
      data-page-row
      data-page-id={page.id}
      data-depth={depth}
      {...attributes}
      {...listeners}
      className={cn(
        'group relative flex cursor-grab touch-none select-none items-center gap-1 rounded-md py-1 pr-1 text-sm active:cursor-grabbing',
        active ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-accent/60',
        highlighted && 'bg-primary/10 ring-1 ring-inset ring-primary',
        isDragging && 'opacity-40'
      )}
      style={{ paddingLeft: `${depth * INDENT + ROW_PAD}px` }}
      onClick={() => onSelect(page.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setDraft(page.title)
        setEditing(true)
      }}
    >
      <button
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20',
          !hasChildren && 'invisible'
        )}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      <span className="w-5 shrink-0 text-center text-sm">
        {page.icon ?? <FileText className="mx-auto h-3.5 w-3.5 text-muted-foreground" />}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs outline-none"
        />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="min-w-0 flex-1 truncate" title={page.title || '无标题'}>
              {page.title || '无标题'}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-[16rem] break-words">
            {page.title || '无标题'}
          </TooltipContent>
        </Tooltip>
      )}
      <span
        className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="h-5 w-5">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36">
            <DropdownMenuItem
              onClick={() => {
                setDraft(page.title)
                setEditing(true)
              }}
            >
              <Pencil /> 重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void createPage(page.id)}>
              <Plus /> 新建子页面
            </DropdownMenuItem>
            {page.title === WELCOME_PAGE_TITLE && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    if (
                      window.confirm(
                        `确定要恢复「${WELCOME_PAGE_TITLE}」的示例内容吗?这会清除当前该页面的所有块。`
                      )
                    ) {
                      void resetWelcomePage()
                    }
                  }}
                >
                  <RotateCcw /> 恢复示例内容
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => void deletePage(page.id)}
            >
              <Trash2 /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-5 w-5"
              onClick={() => void createPage(page.id)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>新建子页面</TooltipContent>
        </Tooltip>
      </span>
    </div>
  )
}
