import { useEffect, useRef } from 'react'
import { Button } from './ui/button'

const EMOJIS = [
  '📝', '📄', '📃', '📋', '📁', '📚', '📖', '💡',
  '⭐', '🔥', '❤️', '💯', '🎯', '🚀', '⚡', '🌟',
  '✅', '📌', '🔖', '🗂️', '📅', '⏰', '🔔', '💼',
  '🏠', '🌱', '🌿', '🍀', '🌈', '☀️', '🌙', '☕',
  '🎨', '🎵', '🎬', '📷', '💻', '⌨️', '🖥️', '📱',
  '🔬', '🧪', '📊', '📈', '💰', '🛠️', '⚙️', '🔑'
]

interface EmojiPickerProps {
  onSelect: (emoji: string | null) => void
  onClose: () => void
}

/** The emoji picker. It closes on an outside click or on Escape. */
export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const keyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-2 shadow-md animate-in fade-in-0 zoom-in-95"
    >
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            className="flex h-7 w-7 items-center justify-center rounded text-base hover:bg-accent"
            onClick={() => {
              onSelect(emoji)
              onClose()
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 w-full text-muted-foreground"
        onClick={() => {
          onSelect(null)
          onClose()
        }}
      >
        移除图标
      </Button>
    </div>
  )
}
