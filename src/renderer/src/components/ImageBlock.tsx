import { ImagePlus } from 'lucide-react'
import type { Block } from '../../../shared/types'
import { useStore } from '@/store'
import { focusSoon, requestFocus } from '@/lib/caret'

interface ImageBlockProps {
  block: Block
  registerRef: (el: HTMLElement | null) => void
  getNeighbors: () => { prev: Block | null; next: Block | null }
}

export function ImageBlock({ block, registerRef, getNeighbors }: ImageBlockProps): JSX.Element {
  const updateBlockLocal = useStore((s) => s.updateBlockLocal)
  const insertBlockAfter = useStore((s) => s.insertBlockAfter)
  const removeBlock = useStore((s) => s.removeBlock)

  const src = block.content.src ?? ''

  const pick = async (): Promise<void> => {
    const res = await window.api.pickImage()
    if (res) {
      updateBlockLocal(block.id, { ...block.content, src: res.url })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      const { prev, next } = getNeighbors()
      void removeBlock(block.id).then(() => {
        if (prev) focusSoon(prev.id)
        else if (next) focusSoon(next.id, 0)
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!src) {
        void pick()
        return
      }
      void insertBlockAfter(block.id, 'paragraph', { text: '' }).then((nb) => {
        if (nb) requestFocus(nb.id, 0)
      })
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

  if (!src) {
    return (
      <div
        ref={registerRef}
        tabIndex={0}
        role="button"
        onKeyDown={handleKeyDown}
        onClick={() => void pick()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-4 py-8 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted focus:ring-2 focus:ring-foreground/20"
      >
        <ImagePlus className="h-6 w-6" />
        <span>点击选择图片,或在任意文本块中 Ctrl+V 直接粘贴图片</span>
      </div>
    )
  }

  return (
    <div
      ref={registerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="cursor-default rounded-md py-1 outline-none focus:ring-2 focus:ring-foreground/20"
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="max-h-[480px] max-w-full select-none rounded-sm"
      />
    </div>
  )
}
