import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus } from 'lucide-react'
import type { Block, BlockType } from '~/lib/shared'
import { useStore } from '~/store'
import { cn } from '~/lib/utils'
import { placeholderFor, type BlockTypeMeta } from '~/lib/blockTypes'
import {
  consumePendingFocus,
  consumeScrollRequest,
  focusBlock,
  focusSoon,
  getCaretOffset,
  registerBlockElement,
  requestFocus
} from '~/lib/caret'
import {
  applyWikiLink,
  decorateWikiLinks,
  findLinkTrigger,
  findWikiLinkElement,
  getLinkResolver
} from '~/lib/wikiLink'
import { SlashMenu } from './SlashMenu'
import { LinkPicker, type LinkPickerItem } from './LinkPicker'
import { ImageBlock } from './ImageBlock'
import { AudioBlock } from './AudioBlock'
import { TableBlock } from './TableBlock'
import { DatabaseBlock } from './DatabaseBlock'

// Markdown shortcuts that turn a paragraph into another block type. They only apply while the
// block is still a paragraph; once it has been converted, typing "#" again is just text.
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
  const selectPage = useStore((s) => s.selectPage)
  const createPage = useStore((s) => s.createPage)
  const pages = useStore((s) => s.pages)

  const text = block.content.text ?? ''
  // The body is a plain-text contentEditable element: the browser owns the DOM children, so React
  // never re-renders the body text. The DOM is patched by hand and the store is told afterwards.
  const elRef = useRef<HTMLElement | null>(null)

  /* ---------- Wiki links ---------- */

  /** Title -> target page. The resolver is reused while the pages reference is unchanged. */
  const resolveLink = useMemo(() => getLinkResolver(pages), [pages])
  /** Wiki-link picker state; a null filter means no "[[" has been typed. */
  const [linkPicker, setLinkPicker] = useState<{ filter: string } | null>(null)
  const [linkIndex, setLinkIndex] = useState(0)

  const linkItems = useMemo<LinkPickerItem[]>(() => {
    if (!linkPicker) return []
    const f = linkPicker.filter.trim()
    const lower = f.toLowerCase()
    const matched = pages.filter((p) => p.title && (!lower || p.title.toLowerCase().includes(lower)))
    const items: LinkPickerItem[] = matched
      .slice(0, 20)
      .map((p) => ({ kind: 'page' as const, title: p.title, page: p }))
    // Offer a "create this title" entry when no page has exactly that name.
    if (f && !pages.some((p) => p.title.trim().toLowerCase() === lower)) {
      items.push({ kind: 'create', title: f, page: null })
    }
    return items
  }, [linkPicker, pages])

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id
  })

  // The sortable wrapper, kept so the focus can be traced back to this block.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const setWrapperRef = useCallback(
    (el: HTMLDivElement | null) => {
      wrapperRef.current = el
      setNodeRef(el)
    },
    [setNodeRef]
  )

  /**
   * A type change swaps the editable element: the paragraph's contentEditable
   * div is recycled as the wrapper of the new list or quote structure, React
   * strips the contentEditable attribute from it, and the new editable div
   * inside it is never focused. The old node keeps the DOM focus but is no
   * longer editable, so everything typed after the conversion would be lost.
   * Re-focusing after the commit puts the caret back into the new element.
   */
  const lastType = useRef(block.type)
  // Render runs before React mutates the existing DOM, so this is the last
  // reliable moment to check whether the soon-to-be-replaced editor owns the
  // focus. By the time the layout effect runs, that old node may be detached
  // and `wrapper.contains(document.activeElement)` would already be false.
  const shouldRestoreFocus =
    lastType.current !== block.type &&
    !!document.activeElement &&
    !!wrapperRef.current?.contains(document.activeElement)
  // The caret offset is read in the same render, so the position inside the
  // text survives the swap instead of jumping back to the start.
  const caretOffset = shouldRestoreFocus && elRef.current ? getCaretOffset(elRef.current) : 0

  useLayoutEffect(() => {
    if (lastType.current === block.type) return
    lastType.current = block.type
    // Only take the focus back if it was inside this block before the swap.
    // A type change made elsewhere (the AI, for instance) must not steal it.
    if (!shouldRestoreFocus) return
    // Stripping the contentEditable attribute drops the focus to the body, and
    // that is the case to repair. A focus that landed on another element in the
    // meantime was deliberate and must not be taken back.
    const active = document.activeElement
    if (active && active !== document.body && !wrapperRef.current?.contains(active)) return
    focusBlock(block.id, caretOffset)
  }, [block.type, block.id, shouldRestoreFocus, caretOffset])

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
    if (!el || !el.isContentEditable) return
    // Never rewrite the block being edited: replacing its text would break the caret.
    if (document.activeElement === el) return
    if ((el.textContent ?? '') !== text) {
      el.textContent = text
    }
    // Re-decorate the [[wiki links]] in the body so they render as clickable links.
    decorateWikiLinks(el, resolveLink)
  }, [text, resolveLink])

  // Apply pending focus request on mount (newly inserted blocks)
  useEffect(() => {
    const pending = consumePendingFocus(block.id)
    if (pending !== undefined) {
      focusBlock(block.id, pending ?? undefined)
    }
    // Scroll to the referenced block when arriving here from a backlink.
    if (consumeScrollRequest(block.id)) {
      requestAnimationFrame(() => {
        elRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
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

  // Enter splits the block at the caret: the text before the caret stays here and the rest moves
  // into a new block that inherits the list/todo type.
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

  // Backspace at offset 0 follows Notion's merge rules: an empty list item becomes a paragraph, a
  // divider above is removed, an image/audio/table neighbour only receives the focus, and otherwise the
  // text is merged into the previous block.
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

    if (prev.type === 'image' || prev.type === 'audio' || prev.type === 'table' || prev.type === 'database') {
      // Text cannot be merged into an image/table block, so only the focus moves.
      focusBlock(prev.id)
      return
    }

    const prevText = prev.content.text ?? ''
    state.updateBlockLocal(prev.id, { ...prev.content, text: prevText + fullText })
    void state.removeBlock(block.id).then(() => focusSoon(prev.id, prevText.length))
  }

  /* ---------- Wiki link interactions ---------- */

  /** Open a link: jump to the page when it exists, otherwise create it from the title. */
  const openLink = async (title: string): Promise<void> => {
    const target = resolveLink(title)
    if (target.pageId) {
      await selectPage(target.pageId)
      return
    }
    await createPage(null, title)
  }

  /** Click on a wiki link inside the body. */
  const handleLinkMouseDown = (e: React.MouseEvent<HTMLElement>): void => {
    const link = findWikiLinkElement(e.target)
    if (!link) return
    const title = link.dataset.wikiTitle ?? ''
    if (!title) return
    // Keep the browser from placing the caret inside the link; navigate instead.
    e.preventDefault()
    e.stopPropagation()
    void openLink(title)
  }

  /**
   * Write the selected target into the body as [[title]]. applyWikiLink has already patched the
   * DOM, so the store is updated from the returned text and the decoration is re-applied at once
   * instead of waiting for a blur.
   */
  const applyLink = (item: LinkPickerItem): void => {
    setLinkPicker(null)
    const result = applyWikiLink(block.id, item.title)
    if (!result) return
    updateBlockLocal(block.id, { ...block.content, text: result.text })
    // Apply the link decoration right away, without waiting for a blur.
    const el = elRef.current
    if (el) decorateWikiLinks(el, resolveLink)
  }

  /** Keyboard handling while the picker is open. */
  const handleLinkKey = (e: React.KeyboardEvent): boolean => {
    if (!linkPicker) return false
    if (linkItems.length === 0) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setLinkPicker(null)
        return true
      }
      return false
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setLinkIndex((i) => (i + 1) % linkItems.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setLinkIndex((i) => (i - 1 + linkItems.length) % linkItems.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const item = linkItems[linkIndex]
      if (item) applyLink(item)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setLinkPicker(null)
      return true
    }
    return false
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    // While an IME is composing, Enter confirms the candidate word instead of
    // splitting the block. Without this guard, every Chinese input would break
    // the block apart at the first Enter, and the candidate would be lost.
    if (e.nativeEvent.isComposing) return
    if (linkPicker && handleLinkKey(e)) return
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

    // Wiki link: an unclosed "[[" before the caret opens the page picker.
    const trigger = findLinkTrigger(currentText, getCaretOffset(el))
    if (trigger) {
      if (slashOpen) onSlashChange(block.id, null)
      setLinkPicker({ filter: trigger.filter })
      setLinkIndex(0)
    } else if (linkPicker) {
      setLinkPicker(null)
    }
  }

  const pasteMediaFile = async (
    file: File,
    el: HTMLElement,
    kind: 'image' | 'audio'
  ): Promise<void> => {
    try {
      const data = await file.arrayBuffer()
      const saved =
        kind === 'audio'
          ? await window.api.saveAudio({
              name: file.name || 'pasted-audio.mp3',
              mime: file.type || 'audio/mpeg',
              data
            })
          : await window.api.saveImage({
              name: file.name || 'pasted-image.png',
              mime: file.type || 'image/png',
              data
            })
      // Split text at caret: keep the part before caret in this block,
      // insert the media after it, and move the rest into a new paragraph below the media
      const fullText = el.textContent ?? ''
      const offset = getCaretOffset(el)
      const before = fullText.slice(0, offset)
      const after = fullText.slice(offset)
      el.textContent = before
      updateBlockLocal(block.id, { ...block.content, text: before })
      const content = kind === 'audio' ? { src: saved.url, text: saved.url } : { src: saved.url }
      const mediaBlock = await insertBlockAfter(block.id, kind, content)
      if (!mediaBlock) return
      void insertBlockAfter(mediaBlock.id, 'paragraph', { text: after }).then((nb) => {
        if (nb) requestFocus(nb.id, 0)
      })
    } catch (err) {
      console.error('粘贴媒体文件失败', err)
    }
  }

  // Plain-text paste goes through execCommand so the browser keeps its native undo stack.
  const handlePaste = (e: React.ClipboardEvent): void => {
    const mediaItem = Array.from(e.clipboardData.items).find(
      (item) => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('audio/'))
    )
    if (mediaItem) {
      e.preventDefault()
      if (slashOpen) onSlashChange(block.id, null)
      const file = mediaItem.getAsFile()
      if (file) {
        void pasteMediaFile(file, e.currentTarget as HTMLElement, mediaItem.type.startsWith('audio/') ? 'audio' : 'image')
      }
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

  /** Re-apply the wiki-link decoration after the block loses focus. */
  const handleBlur = (): void => {
    // The slash menu belongs to the block that opened it. Without this the menu
    // would stay open over the old block after the focus moved somewhere else,
    // and Escape would no longer reach it.
    if (slashOpen) onSlashChange(block.id, null)
    const el = elRef.current
    if (!el || !el.isContentEditable) return
    decorateWikiLinks(el, resolveLink)
  }

  const editableProps = {
    ref: registerRef,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    'data-placeholder': placeholderFor(block.type),
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onMouseDown: handleLinkMouseDown,
    onBlur: handleBlur
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
      case 'audio':
        return <AudioBlock block={block} registerRef={registerRef} getNeighbors={getNeighbors} />
      case 'table':
        return <TableBlock block={block} registerRef={registerRef} getNeighbors={getNeighbors} />
      case 'database':
        return <DatabaseBlock block={block} registerRef={registerRef} />
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
      ref={setWrapperRef}
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
      {linkPicker && (
        <LinkPicker
          items={linkItems}
          selectedIndex={linkIndex}
          onSelect={applyLink}
          onHover={setLinkIndex}
        />
      )}
    </div>
  )
}
