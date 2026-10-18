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
import { FileText } from 'lucide-react'
import { useStore } from '@/store'
import { filterBlockTypes, type BlockTypeMeta } from '@/lib/blockTypes'
import { focusBlock, requestCellFocus, requestFocus, setBlockElementText } from '@/lib/caret'
import { createTableData, tableToText } from '../../../shared/types'
import { BlockItem } from './BlockItem'
import { EmojiPicker } from './EmojiPicker'

interface SlashState {
  blockId: string
  filter: string
}

export function Editor(): JSX.Element {
  const pages = useStore((s) => s.pages)
  const currentPageId = useStore((s) => s.currentPageId)
  const blocks = useStore((s) => s.blocks)
  const blocksLoading = useStore((s) => s.blocksLoading)
  const renamePage = useStore((s) => s.renamePage)
  const setPageIcon = useStore((s) => s.setPageIcon)
  const setBlockType = useStore((s) => s.setBlockType)
  const updateBlockLocal = useStore((s) => s.updateBlockLocal)
  const insertBlockAfter = useStore((s) => s.insertBlockAfter)
  const setBlocksOrder = useStore((s) => s.setBlocksOrder)

  const page = pages.find((p) => p.id === currentPageId)

  const [title, setTitle] = useState(page?.title ?? '')
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)

  const slashItems = useMemo(() => (slash ? filterBlockTypes(slash.filter) : []), [slash])

  useEffect(() => {
    setTitle(page?.title ?? '')
  }, [currentPageId])

  // Auto-resize title textarea as the user types
  useEffect(() => {
    const ta = titleRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
    }
  }, [title])

  useEffect(() => {
    setSlashIndex(0)
  }, [slash?.filter])

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

    if (item.type === 'table') {
      // 表格没有单一可编辑元素,初始化数据后把光标交给第一个单元格
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
    <div
      className="mx-auto w-full px-20 pb-[30vh] pt-14"
      style={{ maxWidth: 'var(--editor-max-width, 768px)' }}
    >
      <div className="relative">
        <button
          className="mb-1 flex h-12 w-12 items-center justify-center rounded-md text-4xl transition-colors hover:bg-accent"
          onClick={() => setIconPickerOpen((v) => !v)}
          title="更换图标"
        >
          {page.icon ?? <FileText className="h-9 w-9 text-muted-foreground/40" />}
        </button>
        {iconPickerOpen && (
          <EmojiPicker
            onSelect={(emoji) => setPageIcon(page.id, emoji)}
            onClose={() => setIconPickerOpen(false)}
          />
        )}
      </div>

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

      <div className="min-h-[30vh] cursor-text" onClick={appendAtEnd} />
    </div>
  )
}
