import { useCallback, useEffect, useRef } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus } from 'lucide-react'
import type { Block, BlockType } from '../../../shared/types'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { placeholderFor, type BlockTypeMeta } from '@/lib/blockTypes'
import {
  consumePendingFocus,
  focusBlock,
  focusSoon,
  getCaretOffset,
  registerBlockElement,
  requestFocus
} from '@/lib/caret'
import { SlashMenu } from './SlashMenu'
import { ImageBlock } from './ImageBlock'
import { TableBlock } from './TableBlock'

function matchMarkdown(text: string): BlockType | null {
  switch (text) {
    case '# ':
      return 'heading1'
    case '## ':
      return 'heading2'
    case '### ':
      return 'heading3'
    case '- ':
    case '* ':
      return 'bulletedList'
    case '[] ':
    case '[ ] ':
      return 'todo'
    case '> ':
      return 'quote'
    case '```':
      return 'code'
    case '---':
      return 'divider'
    default:
      return /^\d+\.\s$/.test(text) ? 'numberedList' : null
  }
}

interface BlockItemProps {
  block: Block
  number?: number
  slashOpen: boolean
  slashItems: BlockTypeMeta[]
  slashIndex: number
  onSlashHover: (index: number) => void
  onSlashSelect: (item: BlockTypeMeta) => void
  onSlashKey: (e: React.KeyboardEvent) => boolean
  onSlashChange: (blockId: string, filter: string | null) => void
}

export function BlockItem({
  block,
  number,
  slashOpen,
  slashItems,
  slashIndex,
  onSlashHover,
  onSlashSelect,
  onSlashKey,
  onSlashChange
}: BlockItemProps): JSX.Element {
  const updateBlockLocal = useStore((s) => s.updateBlockLocal)
  const setBlockType = useStore((s) => s.setBlockType)
  const setBlockChecked = useStore((s) => s.setBlockChecked)
  const insertBlockAfter = useStore((s) => s.insertBlockAfter)

  const text = block.content.text ?? ''
  const elRef = useRef<HTMLElement | null>(null)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id
  })

  const registerRef = useCallback(
    (el: HTMLElement | null) => {
      elRef.current = el
      registerBlockElement(block.id, el)
      if (el && el.isContentEditable) {
        const current =
          useStore.getState().blocks.find((b) => b.id === block.id)?.content.text ?? ''
        if ((el.textContent ?? '') !== current) {
          el.textContent = current
        }
      }
    },
    [block.id]
  )

  // Sync external text changes (merge from other blocks) when not focused
  useEffect(() => {
    const el = elRef.current
    if (el && el.isContentEditable && document.activeElement !== el && (el.textContent ?? '') !== text) {
      el.textContent = text
    }
  }, [text])

  // Apply pending focus request on mount (newly inserted blocks)
  useEffect(() => {
    const pending = consumePendingFocus(block.id)
    if (pending !== undefined) {
      focusBlock(block.id, pending ?? undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getNeighbors = (): { prev: Block | null; next: Block | null } => {
    const blocks = useStore.getState().blocks
    const idx = blocks.findIndex((b) => b.id === block.id)
    return {
      prev: idx > 0 ? blocks[idx - 1] : null,
      next: idx >= 0 && idx < blocks.length - 1 ? blocks[idx + 1] : null
    }
  }

  const handleSplit = (el: HTMLElement): void => {
    const fullText = el.textContent ?? ''
    const offset = getCaretOffset(el)

    // Notion behavior: Enter on an empty list/todo item converts it to a paragraph
    if (
      fullText.trim() === '' &&
      (block.type === 'todo' || block.type === 'bulletedList' || block.type === 'numberedList')
    ) {
      setBlockType(block.id, 'paragraph')
      return
    }

    const before = fullText.slice(0, offset)
    const after = fullText.slice(offset)
    el.textContent = before
    updateBlockLocal(block.id, { ...block.content, text: before })

    const inheritTypes: BlockType[] = ['bulletedList', 'numberedList', 'todo']
    const newType = inheritTypes.includes(block.type) ? block.type : 'paragraph'
    const newContent = newType === 'todo' ? { text: after, checked: false } : { text: after }
    void insertBlockAfter(block.id, newType, newContent).then((nb) => {
      if (nb) requestFocus(nb.id, 0)
    })
  }

  const handleBackspace = (e: React.KeyboardEvent, el: HTMLElement): void => {
    const fullText = el.textContent ?? ''
    const offset = getCaretOffset(el)
    if (offset > 0) return
    e.preventDefault()

    const state = useStore.getState()
    const { prev } = getNeighbors()

    if (fullText === '') {
      if (prev) {
        void state.removeBlock(block.id).then(() => focusSoon(prev.id))
      } else if (block.type !== 'paragraph') {
        state.setBlockType(block.id, 'paragraph')
      }
      return
    }

    if (!prev) {
      if (block.type !== 'paragraph') state.setBlockType(block.id, 'paragraph')
      return
    }

    if (prev.type === 'divider') {
      void state.removeBlock(prev.id).then(() => focusSoon(block.id, 0))
      return
    }

    if (prev.type === 'image' || prev.type === 'table') {
      // 不能把文本并进图片/表格块,只把焦点移过去
      focusBlock(prev.id)
      return
    }

    const prevText = prev.content.text ?? ''
    state.updateBlockLocal(prev.id, { ...prev.content, text: prevText + fullText })
    void state.removeBlock(block.id).then(() => focusSoon(prev.id, prevText.length))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (slashOpen && onSlashKey(e)) return

    const el = e.currentTarget
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSplit(el)
    } else if (e.key === 'Backspace') {
      handleBackspace(e, el)
    } else if (e.key === 'ArrowUp') {
      if (getCaretOffset(el) === 0) {
        const { prev } = getNeighbors()
        if (prev) {
          e.preventDefault()
          focusBlock(prev.id)
        }
      }
    } else if (e.key === 'ArrowDown') {
      const len = (el.textContent ?? '').length
      if (getCaretOffset(el) === len) {
        const { next } = getNeighbors()
        if (next) {
          e.preventDefault()
          focusBlock(next.id, 0)
        }
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
    }
  }

  const handleInput = (e: React.FormEvent<HTMLElement>): void => {
    const el = e.currentTarget
    const currentText = el.textContent ?? ''

    const md = block.type === 'paragraph' ? matchMarkdown(currentText) : null
    if (md) {
      el.textContent = ''
      if (md === 'divider') {
        updateBlockLocal(block.id, { text: '' })
        setBlockType(block.id, 'divider')
        void insertBlockAfter(block.id, 'paragraph', { text: '' }).then((nb) => {
          if (nb) requestFocus(nb.id, 0)
        })
      } else if (md === 'todo') {
        setBlockType(block.id, 'todo')
        updateBlockLocal(block.id, { text: '', checked: false })
        focusBlock(block.id, 0)
      } else {
        setBlockType(block.id, md)
        updateBlockLocal(block.id, { ...block.content, text: '' })
        focusBlock(block.id, 0)
      }
      return
    }

    updateBlockLocal(block.id, { ...block.content, text: currentText })

    if (currentText.startsWith('/')) {
      onSlashChange(block.id, currentText.slice(1))
    } else if (slashOpen) {
      onSlashChange(block.id, null)
    }
  }

  const pasteImageFile = async (file: File, el: HTMLElement): Promise<void> => {
    try {
      const data = await file.arrayBuffer()
      const saved = await window.api.saveImage({
        name: file.name || 'pasted-image.png',
        mime: file.type || 'image/png',
        data
      })
      // Split text at caret: keep the part before caret in this block,
      // insert the image after it, and move the rest into a new paragraph below the image
      const fullText = el.textContent ?? ''
      const offset = getCaretOffset(el)
      const before = fullText.slice(0, offset)
      const after = fullText.slice(offset)
      el.textContent = before
      updateBlockLocal(block.id, { ...block.content, text: before })
      const imgBlock = await insertBlockAfter(block.id, 'image', { src: saved.url })
      if (!imgBlock) return
      void insertBlockAfter(imgBlock.id, 'paragraph', { text: after }).then((nb) => {
        if (nb) requestFocus(nb.id, 0)
      })
    } catch (err) {
      console.error('粘贴图片失败', err)
    }
  }

  const handlePaste = (e: React.ClipboardEvent): void => {
    const imageItem = Array.from(e.clipboardData.items).find(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    )
    if (imageItem) {
      e.preventDefault()
      if (slashOpen) onSlashChange(block.id, null)
      const file = imageItem.getAsFile()
      if (file) void pasteImageFile(file, e.currentTarget as HTMLElement)
      return
    }
    e.preventDefault()
    const pasted = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, pasted)
  }

  const addBlockBelow = (): void => {
    void insertBlockAfter(block.id, 'paragraph', { text: '' }).then((nb) => {
      if (nb) requestFocus(nb.id, 0)
    })
  }

  const editableProps = {
    ref: registerRef,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    'data-placeholder': placeholderFor(block.type),
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste
  } as const

  const renderContent = (): JSX.Element => {
    switch (block.type) {
      case 'heading1':
        return <div {...editableProps} className="block-editable text-[28px] font-bold leading-[1.3]" />
      case 'heading2':
        return <div {...editableProps} className="block-editable text-[22px] font-semibold leading-[1.35]" />
      case 'heading3':
        return <div {...editableProps} className="block-editable text-[18px] font-semibold leading-[1.4]" />
      case 'quote':
        return (
          <div className="border-l-[3px] border-foreground/60 pl-3.5">
            <div {...editableProps} className="block-editable block-body" />
          </div>
        )
      case 'bulletedList':
        return (
          <div className="flex items-start gap-2">
            <span className="select-none pt-px block-body">•</span>
            <div {...editableProps} className="block-editable min-w-0 flex-1 block-body" />
          </div>
        )
      case 'numberedList':
        return (
          <div className="flex items-start gap-2">
            <span className="select-none pt-px block-body">{number ?? 1}.</span>
            <div {...editableProps} className="block-editable min-w-0 flex-1 block-body" />
          </div>
        )
      case 'todo':
        return (
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={!!block.content.checked}
              onChange={(e) => setBlockChecked(block.id, e.target.checked)}
              className="mt-[7px] h-4 w-4 shrink-0 cursor-pointer accent-foreground"
            />
            <div
              {...editableProps}
              className={cn(
                'block-editable min-w-0 flex-1 block-body',
                block.content.checked && 'text-muted-foreground line-through'
              )}
            />
          </div>
        )
      case 'code':
        return (
          <div className="rounded-md bg-muted">
            <textarea
              ref={(el) => {
                elRef.current = el
                registerBlockElement(block.id, el)
              }}
              value={text}
              rows={Math.max(1, text.split('\n').length)}
              placeholder="代码…"
              spellCheck={false}
              className="code-textarea block w-full bg-transparent px-3.5 py-3 font-mono text-[13px] leading-6"
              onChange={(e) => updateBlockLocal(block.id, { ...block.content, text: e.target.value })}
              onKeyDown={(e) => {
                const ta = e.currentTarget
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                  e.preventDefault()
                  void insertBlockAfter(block.id, 'paragraph', { text: '' }).then((nb) => {
                    if (nb) requestFocus(nb.id, 0)
                  })
                } else if (e.key === 'Backspace' && ta.value === '') {
                  e.preventDefault()
                  const { prev } = getNeighbors()
                  void useStore
                    .getState()
                    .removeBlock(block.id)
                    .then(() => prev && focusSoon(prev.id))
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  const s = ta.selectionStart
                  const en = ta.selectionEnd
                  const nv = ta.value.slice(0, s) + '  ' + ta.value.slice(en)
                  updateBlockLocal(block.id, { ...block.content, text: nv })
                  requestAnimationFrame(() => {
                    ta.selectionStart = ta.selectionEnd = s + 2
                  })
                } else if (e.key === 'ArrowUp' && !ta.value.slice(0, ta.selectionStart).includes('\n')) {
                  const { prev } = getNeighbors()
                  if (prev) {
                    e.preventDefault()
                    focusBlock(prev.id)
                  }
                } else if (
                  e.key === 'ArrowDown' &&
                  !ta.value.slice(ta.selectionStart).includes('\n')
                ) {
                  const { next } = getNeighbors()
                  if (next) {
                    e.preventDefault()
                    focusBlock(next.id, 0)
                  }
                }
              }}
            />
          </div>
        )
      case 'image':
        return <ImageBlock block={block} registerRef={registerRef} getNeighbors={getNeighbors} />
      case 'table':
        return <TableBlock block={block} registerRef={registerRef} getNeighbors={getNeighbors} />
      case 'divider':
        return (
          <div
            ref={registerRef}
            tabIndex={0}
            className="flex h-5 cursor-default items-center rounded outline-none focus:bg-accent/50"
            onKeyDown={(e) => {
              if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault()
                const { prev, next } = getNeighbors()
                void useStore
                  .getState()
                  .removeBlock(block.id)
                  .then(() => {
                    if (prev) focusSoon(prev.id)
                    else if (next) focusSoon(next.id, 0)
                  })
              } else if (e.key === 'Enter') {
                e.preventDefault()
                void insertBlockAfter(block.id, 'paragraph', { text: '' }).then((nb) => {
                  if (nb) requestFocus(nb.id, 0)
                })
              }
            }}
          >
            <div className="h-px w-full bg-border" />
          </div>
        )
      default:
        return <div {...editableProps} className="block-editable block-body" />
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group relative rounded', isDragging && 'z-20 opacity-50')}
    >
      <div className="absolute -left-[52px] flex items-center pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent"
          onClick={addBlockBelow}
          title="在下方添加块"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          {...attributes}
          {...listeners}
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-accent active:cursor-grabbing"
          title="拖动排序"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>
      <div className="relative min-w-0 py-0.5">{renderContent()}</div>
      {slashOpen && (
        <SlashMenu items={slashItems} selectedIndex={slashIndex} onSelect={onSlashSelect} onHover={onSlashHover} />
      )}
    </div>
  )
}
