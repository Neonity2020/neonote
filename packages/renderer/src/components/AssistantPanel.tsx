import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FileText, Loader2, Send, Sparkles, Square, Wrench, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useSettings } from '@/settingsStore'
import { Button } from './ui/button'
import type { AiEvent, AiPageContext, AiStatus } from '@neonity/neonote-shared'

interface ToolCallItem {
  id: string
  label: string
  done: boolean
  isError?: boolean
}

// A chat message. The assistant message is patched in place while a run streams in: text and
// thinking are appended to, and tool calls are added or marked done.
interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'notice'
  text: string
  thinking: string
  tools: ToolCallItem[]
  error?: string
}

let msgSeq = 0
function nextId(): string {
  return `m${++msgSeq}`
}

interface AssistantPanelProps {
  onClose: () => void
}

export function AssistantPanel({ onClose }: AssistantPanelProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState<AiStatus>({ ready: false })
  const [retrying, setRetrying] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Current page context: attached automatically, so the model does not read the page again on
  // every turn.
  const pages = useStore((s) => s.pages)
  const currentPageId = useStore((s) => s.currentPageId)
  const blocks = useStore((s) => s.blocks)
  const currentPage = pages.find((p) => p.id === currentPageId) ?? null
  const autoContext = useSettings((s) => s.settings.ai.autoContext)
  const modelSetting = useSettings((s) => s.settings.ai.model)

  useEffect(() => {
    let cancelled = false
    void window.ai.getStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [modelSetting])

  /**
   * Manual retry after a failed initialization: the old session is discarded first, because it may
   * have been created in a broken environment, and then the status is fetched again.
   */
  async function retry(): Promise<void> {
    setRetrying(true)
    try {
      await window.ai.reset()
      setStatus(await window.ai.getStatus())
    } finally {
      setRetrying(false)
    }
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  /**
   * The message the stream currently belongs to.
   *
   * The assistant message is tracked by id instead of by position: a notice
   * (a retry, a model switch) is appended as its own message, and updating
   * "the last message" would then start a second bubble, cut the answer in two
   * and leave the tool badges of the first one spinning forever.
   */
  const activeAssistantId = useRef<string | null>(null)

  const updateAssistant = useCallback((fn: (m: ChatMessage) => ChatMessage): void => {
    setMessages((prev) => {
      const idx = activeAssistantId.current
        ? prev.findIndex((m) => m.id === activeAssistantId.current)
        : -1
      if (idx < 0) {
        const fresh: ChatMessage = { id: nextId(), role: 'assistant', text: '', thinking: '', tools: [] }
        activeAssistantId.current = fresh.id
        return [...prev, fn(fresh)]
      }
      const next = [...prev]
      next[idx] = fn(next[idx])
      return next
    })
  }, [])

  const handleEvent = useCallback((event: AiEvent): void => {
    switch (event.type) {
      case 'run_start':
        setStreaming(true)
        setMessages((prev) => {
          const id = nextId()
          activeAssistantId.current = id
          return [...prev, { id, role: 'assistant', text: '', thinking: '', tools: [] }]
        })
        break
      case 'text_delta':
        updateAssistant((m) => ({ ...m, text: m.text + event.delta }))
        break
      case 'thinking_delta':
        updateAssistant((m) => ({ ...m, thinking: m.thinking + event.delta }))
        break
      case 'tool_start':
        updateAssistant((m) => ({
          ...m,
          tools: [...m.tools, { id: event.id, label: event.label, done: false }]
        }))
        break
      case 'tool_end':
        updateAssistant((m) => ({
          ...m,
          tools: m.tools.map((t) =>
            t.id === event.id ? { ...t, done: true, isError: event.isError } : t
          )
        }))
        break
      case 'notice':
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'notice', text: event.text, thinking: '', tools: [] }
        ])
        break
      case 'run_end':
        setStreaming(false)
        if (event.error) {
          updateAssistant((m) => ({ ...m, error: event.error }))
        }
        activeAssistantId.current = null
        break
    }
  }, [updateAssistant])

  // Subscribe to the AI event stream and unsubscribe again on unmount.
  // handleEvent 是稳定的 useCallback,这条订阅只在挂载时建立一次,
  // 不会每次渲染都重新订阅 IPC。
  useEffect(() => {
    const off = window.ai.onEvent(handleEvent)
    return off
  }, [handleEvent])

  function buildContext(): AiPageContext | null {
    if (!autoContext || !currentPage) return null
    return {
      pageId: currentPage.id,
      title: currentPage.title,
      icon: currentPage.icon,
      blocks: blocks.map((b) => ({
        id: b.id,
        type: b.type,
        text: b.content.text ?? '',
        ...(b.type === 'todo' ? { checked: !!b.content.checked } : {})
      }))
    }
  }

  async function send(): Promise<void> {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', text, thinking: '', tools: [] }
    ])
    setStreaming(true)
    const res = await window.ai.send(text, buildContext())
    if (!res.ok) {
      setStreaming(false)
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'notice',
          text: `发送失败:${res.error ?? '未知错误'}`,
          thinking: '',
          tools: []
        }
      ])
    }
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI 助手</span>
          {status.ready && status.model && (
            <span className="max-w-32 truncate text-[10px] text-muted-foreground" title={status.model}>
              {status.model}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="关闭">
          <X />
        </Button>
      </div>

      {/* Initialization error */}
      {!status.ready && status.error && (
        <div className="flex items-start gap-2 border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">AI 初始化失败:{status.error}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => void retry()}
            disabled={retrying}
          >
            {retrying ? '重试中…' : '重试'}
          </Button>
        </div>
      )}

      {/* Current page context notice */}
      <div className="flex items-center gap-1.5 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
        <FileText className="h-3 w-3 shrink-0" />
        上下文:
        {!autoContext ? (
          <span>已关闭(可在设置中开启)</span>
        ) : currentPage ? (
          <span className="truncate">
            {currentPage.icon ? currentPage.icon + ' ' : ''}
            {currentPage.title || '无标题'} · {blocks.length} 个块
          </span>
        ) : (
          <span>无打开的页面</span>
        )}
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              试试:「帮我在当前页面写一份周计划」
              <br />
              「搜一下我记过的所有密码相关内容」
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {streaming && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> 思考中…
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="让 AI 帮你整理笔记…"
            rows={2}
            className="min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          {streaming ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => void window.ai.abort()}
              title="停止"
            >
              <Square />
            </Button>
          ) : (
            <Button size="icon" onClick={() => void send()} disabled={!input.trim()} title="发送">
              <Send />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">Enter 发送,Shift+Enter 换行</p>
      </div>
    </aside>
  )
}

function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  if (message.role === 'notice') {
    return <p className="text-center text-[11px] text-muted-foreground">{message.text}</p>
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {message.thinking && (
        <details className="rounded-md border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">思考过程</summary>
          <p className="mt-1 whitespace-pre-wrap">{message.thinking}</p>
        </details>
      )}
      {message.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {message.tools.map((t) => (
            <span
              key={t.id}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
                t.isError
                  ? 'border-destructive/40 text-destructive'
                  : 'text-muted-foreground'
              )}
            >
              <Wrench className="h-3 w-3" />
              {t.label}
              {t.done ? (
                t.isError ? (
                  <XCircle className="h-3 w-3" />
                ) : (
                  <Check className="h-3 w-3 text-green-600" />
                )
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
            </span>
          ))}
        </div>
      )}
      {message.text && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
      )}
      {message.error && (
        <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {message.error}
        </p>
      )}
    </div>
  )
}
