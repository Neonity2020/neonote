import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, ImageOff, X } from 'lucide-react'
import { COVER_PRESETS } from '~/lib/cover'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { searchUnsplashPhotos, type UnsplashPhoto } from '~/server/unsplash'

type PickerTab = 'preset' | 'unsplash' | 'url'

const TABS: { id: PickerTab; label: string }[] = [
  { id: 'preset', label: '预设' },
  { id: 'unsplash', label: 'Unsplash' },
  { id: 'url', label: '图片 URL' },
]

interface CoverPickerProps {
  currentCover: string | null
  onSelect: (cover: string) => void
  onClose: () => void
}

export function CoverPicker({ currentCover, onSelect, onClose }: CoverPickerProps): JSX.Element {
  const [tab, setTab] = useState<PickerTab>('preset')
  const [url, setUrl] = useState(currentCover?.startsWith('http') ? currentCover : '')
  const [error, setError] = useState('')

  // Unsplash 面板状态：输入框是草稿，提交后才有 query，避免每次敲字都烧 API 配额
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [photos, setPhotos] = useState<UnsplashPhoto[]>([])
  const [total, setTotal] = useState(0)
  const [unsplashError, setUnsplashError] = useState('')
  const [loading, setLoading] = useState(false)
  const [touched, setTouched] = useState(false)
  const requestSeq = useRef(0)

  useEffect(() => {
    setUrl(currentCover?.startsWith('http') ? currentCover : '')
    setError('')
  }, [currentCover])

  const loadPhotos = useCallback(async (q: string, p: number) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setUnsplashError('')
    try {
      const result = await searchUnsplashPhotos({ data: { query: q, page: p } })
      if (seq !== requestSeq.current) return
      if (result.ok) {
        setPhotos(result.photos)
        setTotal(result.total)
      } else {
        setPhotos([])
        setTotal(0)
        setUnsplashError(result.error)
      }
    } catch {
      if (seq === requestSeq.current) {
        setPhotos([])
        setUnsplashError('Unsplash 请求失败，请检查网络后重试')
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'unsplash' && !touched) {
      setTouched(true)
      void loadPhotos('', 1)
    }
  }, [tab, touched, loadPhotos])

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

  const submitSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const next = queryDraft.trim()
    setQuery(next)
    setPage(1)
    void loadPhotos(next, 1)
  }

  const shuffle = (): void => {
    const next = page + 1
    setPage(next)
    void loadPhotos(query, next)
  }

  return (
    <section className="mb-5 rounded-lg border bg-popover p-3 text-popover-foreground shadow-sm" aria-label="选择笔记封面">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">选择 Banner</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭封面选择器">
          <X />
        </Button>
      </header>

      <div className="mb-3 flex gap-1 rounded-md bg-muted p-1" role="tablist" aria-label="封面来源">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
              tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'preset' && (
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
      )}

      {tab === 'unsplash' && (
        <div>
          <form className="mb-2 flex gap-2" onSubmit={submitSearch}>
            <Input
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="搜索 Unsplash 图片，如 mountain、workspace…"
              aria-label="搜索 Unsplash 图片"
            />
            <Button type="submit" size="sm" disabled={loading}>
              搜索
            </Button>
          </form>

          {loading && (
            <div className="grid grid-cols-3 gap-2" aria-label="加载中">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          )}

          {!loading && unsplashError && (
            <p className="text-xs leading-relaxed text-destructive" role="alert">{unsplashError}</p>
          )}

          {!loading && !unsplashError && photos.length === 0 && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ImageOff className="size-3.5" />
              没有找到相关图片
            </p>
          )}

          {!loading && photos.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    className="relative h-16 overflow-hidden rounded-md border outline-none transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ backgroundColor: photo.color }}
                    aria-label={`使用 ${photo.photographer} 拍摄的图片`}
                    aria-pressed={currentCover === photo.full}
                    onClick={() => {
                      onSelect(photo.full)
                      onClose()
                    }}
                  >
                    <img
                      src={photo.thumb}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                    {currentCover === photo.full && (
                      <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm">
                        <Check className="size-3.5" />
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 pb-1 pt-3 text-left text-[10px] text-white">
                      {photo.photographer}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">
                  共 {total} 张 · 图片来自{' '}
                  <a
                    href="https://unsplash.com"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Unsplash
                  </a>
                </p>
                <Button variant="outline" size="xs" disabled={loading} onClick={shuffle}>
                  换一批
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'url' && (
        <form className="mt-1" onSubmit={submitUrl}>
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
      )}
    </section>
  )
}
