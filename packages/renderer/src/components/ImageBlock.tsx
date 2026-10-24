import { useLayoutEffect, useRef, useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Copy, ImagePlus, Plus, Trash2, Type } from 'lucide-react'
import type { Block } from '@neonity/neonote-shared'
import { useStore } from '@/store'
import { focusSoon, requestFocus } from '@/lib/caret'

interface ImageBlockProps {
  block: Block
  registerRef: (el: HTMLElement | null) => void
  getNeighbors: () => { prev: Block | null; next: Block | null }
}

/**
 * An image block. Delete removes the block, Enter opens the picker on an empty block or inserts a
 * paragraph below a filled one, and the arrow keys move between the neighbouring blocks.
 */
export function ImageBlock({ block, registerRef, getNeighbors }: ImageBlockProps): JSX.Element {
  const updateBlockLocal = useStore((s) => s.updateBlockLocal)
  const insertBlockAfter = useStore((s) => s.insertBlockAfter)
  const removeBlock = useStore((s) => s.removeBlock)

  const src = block.content.src ?? ''
  const caption = block.content.caption ?? ''
  const captionRef = useRef<HTMLTextAreaElement | null>(null)
  const focusCaption = useRef(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const moveFocus = useRef(false)
  const [error, setError] = useState('')
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = captionRef.current
    if (!el) return
    const resize = (): void => {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
    resize()
    // Reflow long captions when the editor or sidebar changes width.
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      resize()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [caption, src])

  const run = (action: () => Promise<void>): void => {
    setError('')
    void action().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : '操作失败，请重试')
    })
  }

  const addParagraph = async (): Promise<void> => {
    const next = await insertBlockAfter(block.id, 'paragraph', { text: '' })
    if (next) requestFocus(next.id, 0)
  }

  const remove = async (): Promise<void> => {
    const { prev, next } = getNeighbors()
    await removeBlock(block.id)
    if (prev) focusSoon(prev.id)
    else if (next) focusSoon(next.id, 0)
  }

  const pick = async (): Promise<void> => {
    const res = await window.api.pickImage()
    if (res) {
      const current = useStore.getState().blocks.find((b) => b.id === block.id)
      if (current) updateBlockLocal(block.id, { ...current.content, src: res.url })
    }
  }

  // Notion-style edge drag: the handle maps the pointer delta to a percentage
  // of the content column, clamped to 25–100, and persists on pointer up.
  const startResize = (e: React.PointerEvent<HTMLDivElement>, edge: 'left' | 'right'): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const container = rootRef.current
    if (!container) return
    const startX = e.clientX
    const baseWidth = block.content.width ?? 100
    const containerWidth = container.clientWidth || 1
    let pct = baseWidth
    const onMove = (ev: PointerEvent): void => {
      const delta = edge === 'right' ? ev.clientX - startX : startX - ev.clientX
      pct = Math.min(100, Math.max(25, Math.round(baseWidth + (delta / containerWidth) * 100)))
      setDragWidth(pct)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      setDragWidth(null)
      const current = useStore.getState().blocks.find((b) => b.id === block.id)
      if (current && pct !== (current.content.width ?? 100)) {
        updateBlockLocal(block.id, { ...current.content, width: pct })
      }
    }
    document.body.style.cursor = 'ew-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.nativeEvent.isComposing || e.target !== e.currentTarget) return
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      run(remove)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!src) {
        run(pick)
        return
      }
      run(addParagraph)
    } else if (e.key === 'ArrowUp') {
      const { prev } = getNeighbors()
      if (prev) {
        e.preventDefault()
        focusSoon(prev.id)
      }
    } else if (e.key === 'ArrowDown') {
      const { next } = getNeighbors()
      if (next) {
        e.preventDefault()
        focusSoon(next.id, 0)
      }
    }
  }

  const wrapMenu = (content: JSX.Element): JSX.Element => (
    <ContextMenu.Root onOpenChange={(open) => { if (open) { moveFocus.current = false; focusCaption.current = false } }}>
      <ContextMenu.Trigger asChild>{content}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-[180px] rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onInteractOutside={() => { moveFocus.current = true }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            if (focusCaption.current) captionRef.current?.focus()
            else if (!moveFocus.current) rootRef.current?.focus()
          }}>
          <ContextMenu.Item className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent"
            onSelect={() => run(pick)}><ImagePlus className="h-4 w-4" />{src ? '更换图片' : '选择图片'}</ContextMenu.Item>
          <ContextMenu.Item disabled={!src} className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-40"
            onSelect={() => { focusCaption.current = true }}><Type className="h-4 w-4" />{caption ? '编辑说明' : '添加说明'}</ContextMenu.Item>
          <ContextMenu.Item disabled={!src} className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-[disabled]:opacity-40"
            onSelect={() => {
              moveFocus.current = true
              run(async () => {
                const current = useStore.getState().blocks.find((b) => b.id === block.id)
                if (!current) return
                const next = await insertBlockAfter(block.id, 'image', { ...current.content })
                if (next) requestFocus(next.id)
              })
            }}><Copy className="h-4 w-4" />复制图片块</ContextMenu.Item>
          <ContextMenu.Item className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent"
            onSelect={() => { moveFocus.current = true; run(addParagraph) }}><Plus className="h-4 w-4" />在下方添加正文</ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-destructive outline-none focus:bg-accent"
            onSelect={() => { moveFocus.current = true; run(remove) }}><Trash2 className="h-4 w-4" />删除图片块</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
    </ContextMenu.Root>
  )
  const setRef = (el: HTMLDivElement | null): void => {
    rootRef.current = el
    registerRef(el)
  }

  if (!src) {
    // The empty state doubles as the trigger that opens the file picker.
    return wrapMenu(
      <div
        ref={setRef}
        tabIndex={0}
        role="button"
        onKeyDown={handleKeyDown}
        onClick={() => run(pick)}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted focus:ring-2 focus:ring-foreground/20"
      >
        <ImagePlus className="h-6 w-6" />
        <span>点击选择图片,或在任意文本块中 Ctrl+V 直接粘贴图片</span>
      </div>
    )
  }

  const displayWidth = dragWidth ?? block.content.width

  return wrapMenu(
    <div
      ref={setRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="cursor-default rounded-md py-1 outline-none focus:ring-2 focus:ring-foreground/20"
    >
      <div
        className="group/img relative max-w-full"
        style={{ width: displayWidth != null ? `${displayWidth}%` : undefined }}
      >
        <img
          src={src}
          alt={caption}
          draggable={false}
          className="block h-auto w-full max-h-[480px] max-w-full select-none rounded-sm"
        />
        <div
          aria-hidden
          onPointerDown={(e) => startResize(e, 'left')}
          className={`absolute inset-y-0 -left-3 z-10 flex w-4 cursor-ew-resize touch-none items-center justify-center transition-opacity ${dragWidth != null ? 'opacity-100' : 'opacity-0 group-hover/img:opacity-100'}`}
        >
          <div className="h-12 w-[3px] rounded-full bg-foreground/30" />
        </div>
        <div
          aria-hidden
          onPointerDown={(e) => startResize(e, 'right')}
          className={`absolute inset-y-0 -right-3 z-10 flex w-4 cursor-ew-resize touch-none items-center justify-center transition-opacity ${dragWidth != null ? 'opacity-100' : 'opacity-0 group-hover/img:opacity-100'}`}
        >
          <div className="h-12 w-[3px] rounded-full bg-foreground/30" />
        </div>
      </div>
      <textarea
        ref={captionRef}
        aria-label="图片说明"
        placeholder="添加图片说明…"
        value={caption}
        rows={1}
        onChange={(e) => {
          const current = useStore.getState().blocks.find((b) => b.id === block.id)
          if (current) updateBlockLocal(block.id, { ...current.content, caption: e.target.value, text: e.target.value })
        }}
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            rootRef.current?.focus()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            run(addParagraph)
          }
        }}
        className="mt-1 block w-full resize-none overflow-hidden rounded bg-transparent px-2 py-1 text-sm leading-6 text-muted-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-muted/30 focus:ring-1 focus:ring-border"
      />
    </div>
  )
}
