import { useEffect, useRef, useState } from 'react'
import { Link2, Music2, Plus, ScanText, Trash2 } from 'lucide-react'
import type { Block } from '~/lib/shared'
import { useStore } from '~/store'
import { focusSoon, requestFocus } from '~/lib/caret'
import { transcribeAudio } from '~/lib/transcribe'

interface AudioBlockProps {
  block: Block
  registerRef: (el: HTMLElement | null) => void
  getNeighbors: () => { prev: Block | null; next: Block | null }
}

function normalizeAudioUrl(value: string): string {
  const raw = value.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('请输入有效的音频链接')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('音频链接仅支持 http 或 https')
  }
  return url.toString()
}

/** An audio player backed by a direct http(s) media URL. */
export function AudioBlock({ block, registerRef, getNeighbors }: AudioBlockProps): JSX.Element {
  const updateBlockLocal = useStore((s) => s.updateBlockLocal)
  const insertBlockAfter = useStore((s) => s.insertBlockAfter)
  const removeBlock = useStore((s) => s.removeBlock)
  const src = block.content.src ?? ''
  const [draft, setDraft] = useState(src)
  const [editing, setEditing] = useState(!src)
  const [error, setError] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [progressLabel, setProgressLabel] = useState<string | null>(null)
  const [transcriptError, setTranscriptError] = useState('')
  const [streamText, setStreamText] = useState('')
  const transcript = block.content.transcript ?? ''
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setDraft(src)
    if (!src) setEditing(true)
  }, [src])

  useEffect(() => {
    if (!editing) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [editing])

  const setRef = (el: HTMLDivElement | null): void => {
    rootRef.current = el
    registerRef(el)
  }

  const save = (): void => {
    try {
      const url = normalizeAudioUrl(draft)
      updateBlockLocal(block.id, { ...block.content, src: url, text: url })
      setDraft(url)
      setEditing(false)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '音频链接无效')
    }
  }

  // 上传本地音频文件（桌面版存资产目录 / R2，Web 版存 R2 / 数据库），
  // 成功后直接进入播放态。
  const uploadLocal = async (): Promise<void> => {
    setError('')
    try {
      const saved = await window.api.pickAudio()
      if (!saved) return
      updateBlockLocal(block.id, { ...block.content, src: saved.url, text: saved.url })
      setDraft(saved.url)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
    }
  }

  const remove = async (): Promise<void> => {
    const { prev, next } = getNeighbors()
    await removeBlock(block.id)
    if (prev) focusSoon(prev.id)
    else if (next) focusSoon(next.id, 0)
  }

  const addParagraph = async (): Promise<void> => {
    const next = await insertBlockAfter(block.id, 'paragraph', { text: '' })
    if (next) requestFocus(next.id, 0)
  }

  // 本地 Whisper 识别：转写文本存进 content.transcript，并镜像到 content.text
  // 让搜索能命中音频内容。
  const transcribe = async (): Promise<void> => {
    if (!src || transcribing) return
    setTranscribing(true)
    setTranscriptError('')
    setStreamText('')
    setProgressLabel('正在准备识别模型…')
    try {
      const text = await transcribeAudio(src, (status) => {
        if (status.delta !== undefined) {
          // 最终一轮的流式增量：实时拼进预览。
          setStreamText((prev) => prev + status.delta)
          setProgressLabel('识别中…')
          return
        }
        // 阶段切换（探针 / 镜像重试）复位累计文本。
        setStreamText('')
        setProgressLabel(
          status.phase === 'loading' ? `下载识别模型 ${status.progress ?? 0}%（仅首次）` : '识别中…'
        )
      })
      if (text) {
        const next = { ...block.content, transcript: text, text }
        // 直接落库：识别进行中用户可能切换页面（组件卸载、store 换页），
        // 只走 updateBlockLocal 会把结果写丢；先持久化再尝试同步当前 UI。
        void window.api.updateBlock({ id: block.id, content: next })
        updateBlockLocal(block.id, next)
      } else {
        setTranscriptError('未识别到语音内容')
      }
    } catch (err) {
      setTranscriptError(err instanceof Error ? err.message : '识别失败')
    } finally {
      setTranscribing(false)
      setProgressLabel(null)
      setStreamText('')
    }
  }

  return (
    <div
      ref={setRef}
      tabIndex={0}
      className="rounded-md border bg-muted/20 p-3 outline-none focus:ring-2 focus:ring-foreground/20"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          void remove()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          void addParagraph()
        } else if (e.key === 'ArrowUp') {
          const { prev } = getNeighbors()
          if (prev) { e.preventDefault(); focusSoon(prev.id) }
        } else if (e.key === 'ArrowDown') {
          const { next } = getNeighbors()
          if (next) { e.preventDefault(); focusSoon(next.id, 0) }
        }
      }}
    >
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Music2 className="h-4 w-4 text-muted-foreground" />
        <span>音频</span>
      </div>

      {src && !editing && (
        <>
          <audio
            key={src}
            src={src}
            controls
            preload="metadata"
            className="block h-10 w-full"
            onError={() => setError('无法加载音频，请确认链接可直接访问音频文件')}
            onLoadedMetadata={() => setError('')}
          />
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={src}>{src}</span>
            <button type="button" className="rounded px-2 py-1 text-xs hover:bg-accent" onClick={() => setEditing(true)}>
              更换链接
            </button>
            <button type="button" aria-label="在下方添加正文" className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => void addParagraph()}>
              <Plus className="h-4 w-4" />
            </button>
            <button type="button" aria-label="删除音频块" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive" onClick={() => void remove()}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs hover:bg-accent disabled:cursor-default disabled:opacity-50"
              disabled={transcribing}
              onClick={() => void transcribe()}
            >
              <ScanText className="h-3.5 w-3.5" /> {transcript ? '重新识别' : '识别文字'}
            </button>
            {transcribing && progressLabel && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{progressLabel}</span>
            )}
            {!transcribing && transcriptError && (
              <span className="min-w-0 truncate text-xs text-destructive" title={transcriptError}>
                {transcriptError}
              </span>
            )}
          </div>
          {(transcript || streamText) && (
            <div className="mt-2 rounded-md bg-muted/40 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                转写{transcribing && <span className="ml-1 normal-case">（实时输出中…）</span>}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                {transcribing ? streamText || transcript : transcript}
                {transcribing && <span className="animate-pulse">▍</span>}
              </p>
            </div>
          )}
        </>
      )}

      {editing && (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="relative min-w-0 flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={draft}
              type="url"
              inputMode="url"
              placeholder="粘贴音频链接，例如 https://example.com/audio.mp3"
              className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-foreground/20"
              onChange={(e) => { setDraft(e.target.value); setError('') }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape' && src) {
                  e.preventDefault()
                  setDraft(src)
                  setEditing(false)
                  setError('')
                  rootRef.current?.focus()
                } else if (e.key === 'Backspace' && !draft && !src) {
                  e.preventDefault()
                  void remove()
                }
              }}
            />
          </div>
          <button type="submit" className="h-10 shrink-0 rounded-md bg-foreground px-3 text-sm text-background hover:opacity-90">
            嵌入
          </button>
          <button type="button" className="h-10 shrink-0 rounded-md px-3 text-sm hover:bg-accent" onClick={() => void uploadLocal()}>
            上传本地音频
          </button>
          {src && (
            <button type="button" className="h-10 shrink-0 rounded-md px-3 text-sm hover:bg-accent" onClick={() => { setDraft(src); setEditing(false); setError('') }}>
              取消
            </button>
          )}
        </form>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
