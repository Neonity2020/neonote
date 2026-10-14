import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sun,
  Trash2
} from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Separator } from './ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import type { PageMeta, SearchResult } from '../../../shared/types'

interface SidebarProps {
  dark: boolean
  onToggleTheme: () => void
}

export function Sidebar({ dark, onToggleTheme }: SidebarProps): JSX.Element {
  const pages = useStore((s) => s.pages)
  const currentPageId = useStore((s) => s.currentPageId)
  const selectPage = useStore((s) => s.selectPage)
  const createPage = useStore((s) => s.createPage)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

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
        {tree.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            还没有页面,点击上方 + 创建
          </div>
        ) : (
          tree.map((node) => <PageTreeItem key={node.page.id} node={node} depth={0} />)
        )}
      </div>

      <Separator />
      <div className="px-4 py-2 text-[11px] text-muted-foreground">
        共 {pages.length} 个页面 · 数据保存在本地
      </div>
    </aside>
  )
}

interface TreeNode {
  page: PageMeta
  children: TreeNode[]
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

function PageTreeItem({ node, depth }: { node: TreeNode; depth: number }): JSX.Element {
  const { page, children } = node
  const currentPageId = useStore((s) => s.currentPageId)
  const selectPage = useStore((s) => s.selectPage)
  const createPage = useStore((s) => s.createPage)
  const renamePage = useStore((s) => s.renamePage)
  const deletePage = useStore((s) => s.deletePage)

  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(page.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const active = currentPageId === page.id

  const commitRename = (): void => {
    renamePage(page.id, draft.trim())
    setEditing(false)
  }

  return (
    <div>
      <div
        className={cn(
          'group relative flex cursor-pointer items-center gap-1 rounded-md py-1 pr-1 text-sm',
          active ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-accent/60'
        )}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        onClick={() => void selectPage(page.id)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(page.title)
          setEditing(true)
        }}
      >
        <button
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20',
            children.length === 0 && 'invisible'
          )}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
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
            className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs outline-none"
          />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="min-w-0 flex-1 truncate"
                title={page.title || '无标题'}
              >
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
      {expanded &&
        children.map((child) => <PageTreeItem key={child.page.id} node={child} depth={depth + 1} />)}
    </div>
  )
}
