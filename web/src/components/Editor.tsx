import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { FileText, ImagePlus, Trash2 } from 'lucide-react'
import { useStore } from '~/store'
import { useSettings } from '~/settingsStore'
import { filterBlockTypes, type BlockTypeMeta } from '~/lib/blockTypes'
import { focusBlock, requestCellFocus, requestFocus, setBlockElementText } from '~/lib/caret'
import { createTableData, tableToText, createDatabaseData, databaseToText } from '~/lib/shared'
import { BlockItem } from './BlockItem'
import { EmojiPicker } from './EmojiPicker'
import { LinkPanel } from './LinkPanel'
import { CoverPicker, getCoverBackground } from './CoverPicker'
import { Button } from './ui/button'
import { cn } from '~/lib/utils'
import newNoteWizardBackground from '~/assets/new-note-wizard-bg.webp'

interface SlashState {
  blockId: string
  filter: string
}

/**
 * `hideHeader`:日记模式内嵌时隐藏页面题头(封面、图标、标题编辑)——
 * 日期标题由外层 DailyNoteView 提供,页面题头在日记语境里是重复信息。
 */
export function Editor({ hideHeader = false }: { hideHeader?: boolean }): JSX.Element {
  const pages = useStore((s) => s.pages)
  const currentPageId = useStore((s) => s.currentPageId)
  const blocks = useStore((s) => s.blocks)
  const blocksLoading = useStore((s) => s.blocksLoading)
  const selectPage = useStore((s) => s.selectPage)
  const renamePage = useStore((s) => s.renamePage)
  const setPageIcon = useStore((s) => s.setPageIcon)
  const setPageCover = useStore((s) => s.setPageCover)
  const setBlockType = useStore((s) => s.setBlockType)
  const updateBlockLocal = useStore((s) => s.updateBlockLocal)
  const insertBlockAfter = useStore((s) => s.insertBlockAfter)
  const setBlocksOrder = useStore((s) => s.setBlocksOrder)

  const page = pages.find((p) => p.id === currentPageId)
  const childPages = useMemo(
    () =>
      pages
        .filter((candidate) => candidate.parentId === page?.id)
        .sort((a, b) => a.position - b.position),
    [page?.id, pages]
  )

  const [title, setTitle] = useState(page?.title ?? '')
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)

  const slashItems = useMemo(() => (slash ? filterBlockTypes(slash.filter) : []), [slash])
  // The illustration only shows on a page that has not been written yet, and
  // only when the user left it switched on.
  const newPageBackground = useSettings((s) => s.settings.editor.newPageBackground)
  const showNewNoteBackground =
    newPageBackground &&
    !hideHeader &&
    !blocksLoading &&
    !title.trim() &&
    blocks.length === 1 &&
    blocks[0].type === 'paragraph' &&
    !(blocks[0].content.text ?? '').trim()

  // Keep the draft in sync with the stored title. It has to react to the title
  // itself, not only to a page switch: a rename made in the sidebar would
  // otherwise be overwritten by the next character typed here.
  useEffect(() => {
    setTitle(page?.title ?? '')
    setCoverPickerOpen(false)
  }, [currentPageId, page?.title])

  // Keep the title tall enough both when its text changes and when the editor
  // width changes. A width change can add wrapped lines without changing title.
  useEffect(() => {
    const ta = titleRef.current
    if (!ta) return

    const resize = (): void => {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
    }

    resize()
    let previousWidth = ta.clientWidth
    const observer = new ResizeObserver(() => {
      const width = ta.clientWidth
      if (width === previousWidth) return
      previousWidth = width
      resize()
    })
    observer.observe(ta)

    return () => observer.disconnect()
  }, [title])

  useEffect(() => {
    setSlashIndex(0)
  }, [slash?.filter])

  // Numbering restarts whenever a non-numbered block interrupts the run, so the numbers match
  // what the user sees on screen.
  const numbers = useMemo(() => {
    const map = new Map<string, number>()
    let counter = 0
    for (const b of blocks) {
      if (b.type === 'numberedList') {
        counter += 1
        map.set(b.id, counter)
      } else {
        counter = 0
      }
    }
    return map
  }, [blocks])

  // A 4px activation distance keeps a plain click inside the text from starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex((b) => b.id === active.id)
      const newIndex = blocks.findIndex((b) => b.id === over.id)
      setBlocksOrder(arrayMove(blocks, oldIndex, newIndex).map((b) => b.id))
    }
  }

  const handleSlashChange = (blockId: string, filter: string | null): void => {
    setSlash(filter === null ? null : { blockId, filter })
  }

  const applySlash = (item: BlockTypeMeta): void => {
    if (!slash) return
    const blockId = slash.blockId
    setSlash(null)

    if (item.type === 'database') {
      const database = createDatabaseData()
      setBlockElementText(blockId, '')
      setBlockType(blockId, 'database')
      updateBlockLocal(blockId, { database, text: databaseToText(database) })
      requestCellFocus(blockId)
      return
    }

    if (item.type === 'table') {
      // A table has no single editable element, so the focus goes to the first cell.
      const table = createTableData()
      setBlockElementText(blockId, '')
      setBlockType(blockId, 'table')
      updateBlockLocal(blockId, { table, text: tableToText(table) })
      requestCellFocus(blockId)
      return
    }

    setBlockElementText(blockId, '')
    setBlockType(blockId, item.type)
    updateBlockLocal(blockId, item.type === 'todo' ? { text: '', checked: false } : { text: '' })
    focusBlock(blockId, 0)
  }

  const handleSlashKey = (e: React.KeyboardEvent): boolean => {
    if (!slash) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (slashItems.length > 0) setSlashIndex((i) => (i + 1) % slashItems.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (slashItems.length > 0) setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length)
      return true
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = slashItems[slashIndex]
      if (item) applySlash(item)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setSlash(null)
      return true
    }
    return false
  }

  const appendAtEnd = (): void => {
    const last = blocks[blocks.length - 1]
    if (last && last.type === 'paragraph' && !(last.content.text ?? '').trim()) {
      focusBlock(last.id, 0)
      return
    }
    void insertBlockAfter(last?.id ?? null, 'paragraph', { text: '' }).then((nb) => {
      if (nb) requestFocus(nb.id, 0)
    })
  }

  if (!page) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        页面不存在
      </div>
    )
  }

  return (
    <>
      {showNewNoteBackground && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-55 transition-opacity duration-300 dark:opacity-[0.16]"
          style={{ backgroundImage: `url(${newNoteWizardBackground})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-background/15 via-background/5 to-background/30 dark:from-background/45 dark:via-background/25 dark:to-background/60" />
        </div>
      )}
      {page.cover && !hideHeader && (
        <figure
          className="group/cover relative h-[30vh] min-h-60 max-h-[420px] w-full overflow-hidden bg-muted bg-cover bg-center"
          style={{ backgroundImage: getCoverBackground(page.cover) }}
        >
          <figcaption className="sr-only">笔记封面</figcaption>
          <div className="absolute bottom-3 right-4 flex gap-2 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100">
            <Button variant="secondary" size="xs" onClick={() => setCoverPickerOpen(true)}>
              <ImagePlus data-icon="inline-start" />
              更换封面
            </Button>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                setPageCover(page.id, null)
                setCoverPickerOpen(false)
              }}
            >
              <Trash2 data-icon="inline-start" />
              移除
            </Button>
          </div>
        </figure>
      )}
      <div
        className={cn(
          'relative z-[1] mx-auto w-full px-20 pb-[30vh]',
          hideHeader ? 'pt-4' : page.cover ? 'pt-0' : 'pt-14'
        )}
        style={{ maxWidth: 'var(--editor-max-width, 768px)' }}
      >
      {coverPickerOpen && (
        <CoverPicker
          currentCover={page.cover}
          onSelect={(cover) => setPageCover(page.id, cover)}
          onClose={() => setCoverPickerOpen(false)}
        />
      )}
      {!hideHeader && (<div className="relative">
        <div className={cn('flex items-center gap-1', page.cover ? '-mt-10 mb-8' : 'mb-1')}>
          <button
            className={cn(
              'flex items-center justify-center rounded-md transition-colors hover:bg-accent',
              page.cover ? 'size-20 text-6xl' : 'size-12 text-4xl'
            )}
            onClick={() => setIconPickerOpen((v) => !v)}
            title="更换图标"
          >
            {page.icon ?? (
              <FileText
                className={cn('text-muted-foreground/40', page.cover ? 'size-14' : 'size-9')}
              />
            )}
          </button>
          {!page.cover && (
            <Button variant="ghost" size="xs" onClick={() => setCoverPickerOpen(true)}>
              <ImagePlus data-icon="inline-start" />
              添加封面
            </Button>
          )}
        </div>
        {iconPickerOpen && (
          <EmojiPicker
            onSelect={(emoji) => setPageIcon(page.id, emoji)}
            onClose={() => setIconPickerOpen(false)}
          />
        )}
      </div>)}

      {!hideHeader && (
      <textarea
        ref={titleRef}
        value={title}
        title={title || '无标题'}
        onChange={(e) => {
          const v = e.target.value
          setTitle(v)
          renamePage(page.id, v)
        }}
        placeholder="无标题"
        rows={1}
        spellCheck={false}
        className="w-full resize-none overflow-hidden bg-transparent pb-4 text-[38px] font-bold leading-tight outline-none placeholder:text-muted-foreground/30"
      />
      )}

      {childPages.length > 0 && (
        <section className="mb-4 space-y-0.5" aria-label="下级页面">
          {childPages.map((childPage) => (
            <button
              key={childPage.id}
              type="button"
              className="group flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm font-medium transition-colors hover:bg-accent/60"
              onClick={() => void selectPage(childPage.id)}
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-base">
                {childPage.icon ?? <FileText className="size-4 text-muted-foreground" />}
              </span>
              <span className="min-w-0 truncate underline decoration-muted-foreground/50 underline-offset-4 group-hover:decoration-foreground">
                {childPage.title || '无标题'}
              </span>
            </button>
          ))}
        </section>
      )}

      {blocksLoading ? (
        <div className="py-8 text-sm text-muted-foreground">加载中…</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            <div>
              {blocks.map((block) => (
                <BlockItem
                  key={block.id}
                  block={block}
                  number={numbers.get(block.id)}
                  slashOpen={slash?.blockId === block.id}
                  slashItems={slashItems}
                  slashIndex={slashIndex}
                  onSlashHover={setSlashIndex}
                  onSlashSelect={applySlash}
                  onSlashKey={handleSlashKey}
                  onSlashChange={handleSlashChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Bidirectional links: who references this page, and what this page references. */}
      {currentPageId && <LinkPanel pageId={currentPageId} />}

      {/* Clicking the empty area below the blocks appends a new paragraph at the end. */}
      <div className="min-h-[30vh] cursor-text" onClick={appendAtEnd} />
      </div>
    </>
  )
}
