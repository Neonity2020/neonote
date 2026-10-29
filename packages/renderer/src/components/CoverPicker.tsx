import { useEffect, useState, type FormEvent } from 'react'
import { Check, X } from 'lucide-react'
import { COVER_PRESETS } from '@/lib/cover'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface CoverPickerProps {
  currentCover: string | null
  onSelect: (cover: string) => void
  onClose: () => void
}

export function CoverPicker({ currentCover, onSelect, onClose }: CoverPickerProps): JSX.Element {
  const [url, setUrl] = useState(currentCover?.startsWith('http') ? currentCover : '')
  const [error, setError] = useState('')

  useEffect(() => {
    setUrl(currentCover?.startsWith('http') ? currentCover : '')
    setError('')
  }, [currentCover])

  const submitUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const value = url.trim()
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
      onSelect(value)
      onClose()
    } catch {
      setError('请输入有效的 http(s) 图片地址')
    }
  }

  return (
    <section className="mb-5 rounded-lg border bg-popover p-3 text-popover-foreground shadow-sm" aria-label="选择笔记封面">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">选择 Banner</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭封面选择器">
          <X />
        </Button>
      </header>

      <div className="grid grid-cols-3 gap-2">
        {COVER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-label={preset.label}
            aria-pressed={currentCover === preset.id}
            className="relative h-16 overflow-hidden rounded-md border outline-none transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring"
            style={{ backgroundImage: preset.background }}
            onClick={() => {
              onSelect(preset.id)
              onClose()
            }}
          >
            {currentCover === preset.id && (
              <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm">
                <Check className="size-3.5" />
              </span>
            )}
            <span className="absolute bottom-1.5 left-2 text-xs font-medium text-white drop-shadow">{preset.label}</span>
          </button>
        ))}
      </div>

      <form className="mt-3" onSubmit={submitUrl}>
        <label htmlFor="cover-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          图片 URL
        </label>
        <div className="flex gap-2">
          <Input
            id="cover-url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
              setError('')
            }}
            placeholder="https://example.com/banner.jpg"
            aria-invalid={!!error}
          />
          <Button type="submit" size="sm" disabled={!url.trim()}>
            使用图片
          </Button>
        </div>
        {error && <p className="mt-1.5 text-xs text-destructive" role="alert">{error}</p>}
      </form>
    </section>
  )
}
