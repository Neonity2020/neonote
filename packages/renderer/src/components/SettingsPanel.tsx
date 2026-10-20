import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  FolderOpen,
  HardDrive,
  Info,
  Loader2,
  MessageSquareX,
  Palette,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettings } from '@/settingsStore'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  CONTENT_WIDTHS,
  EDITOR_FONT_SIZES,
  type AiModelInfo,
  type AppInfo,
  type ContentWidth,
  type EditorFontSize,
  type ThemeMode
} from '@neonity/notion-clone-shared'

type SectionId = 'appearance' | 'ai' | 'data' | 'about'

const SECTIONS: Array<{ id: SectionId; label: string; icon: JSX.Element }> = [
  { id: 'appearance', label: '外观', icon: <Palette /> },
  { id: 'ai', label: 'AI 助手', icon: <Sparkles /> },
  { id: 'data', label: '数据与存储', icon: <HardDrive /> },
  { id: 'about', label: '关于', icon: <Info /> }
]

interface SettingsPanelProps {
  onClose: () => void
}

/**
 * The settings dialog: a section list on the left and the content of the active section on the
 * right.
 */
export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const [section, setSection] = useState<SectionId>('appearance')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[560px] w-full max-w-3xl overflow-hidden rounded-xl border bg-background shadow-2xl">
        {/* Section navigation */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2">
          <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            设置
          </p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5',
                section === s.id
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>

        {/* Section content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-sm font-semibold">
              {SECTIONS.find((s) => s.id === section)?.label}
            </h2>
            <Button variant="ghost" size="icon-sm" onClick={onClose} title="关闭(Esc)">
              <X />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-2">
            {section === 'appearance' && <AppearanceSection />}
            {section === 'ai' && <AiSection />}
            {section === 'data' && <DataSection />}
            {section === 'about' && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Shared primitives ---------- */

// A settings row: a label with an optional hint on the left and the control on the right.
function Row({
  label,
  hint,
  children,
  stacked = false
}: {
  label: string
  hint?: string
  children: React.ReactNode
  stacked?: boolean
}): JSX.Element {
  return (
    <div
      className={cn(
        'border-b border-border/60 py-3.5 last:border-b-0',
        stacked ? 'space-y-2' : 'flex items-start justify-between gap-6'
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className={cn(stacked ? '' : 'shrink-0')}>{children}</div>
    </div>
  )
}

// A segmented control for a small set of mutually exclusive options.
function Segmented<T extends string | number>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs transition-colors',
            value === o.value
              ? 'bg-accent font-medium text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// A switch that toggles a boolean setting.
function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (value: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

/* ---------- Appearance ---------- */

function AppearanceSection(): JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  return (
    <div>
      <Row label="主题" hint="「跟随系统」会随 macOS / Windows 的外观设置自动切换">
        <Segmented<ThemeMode>
          value={settings.theme}
          onChange={(theme) => void update({ theme })}
          options={[
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
            { value: 'system', label: '跟随系统' }
          ]}
        />
      </Row>

      <Row label="正文字号" hint="影响编辑器里段落、列表、待办与引用的文字大小">
        <Segmented<EditorFontSize>
          value={settings.editor.fontSize}
          onChange={(fontSize) => void update({ editor: { fontSize } })}
          options={EDITOR_FONT_SIZES.map((size) => ({
            value: size,
            label: size === 14 ? '紧凑' : size === 15 ? '标准' : size === 17 ? '大' : '特大'
          }))}
        />
      </Row>

      <Row label="内容宽度" hint="页面正文的最大宽度,宽屏下更舒展">
        <Segmented<ContentWidth>
          value={settings.editor.contentWidth}
          onChange={(contentWidth) => void update({ editor: { contentWidth } })}
          options={(Object.keys(CONTENT_WIDTHS) as ContentWidth[]).map((key) => ({
            value: key,
            label: key === 'narrow' ? '窄' : key === 'standard' ? '标准' : '宽'
          }))}
        />
      </Row>
    </div>
  )
}

/* ---------- AI assistant ---------- */

function AiSection(): JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const [models, setModels] = useState<AiModelInfo[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [promptDraft, setPromptDraft] = useState(settings.ai.extraPrompt)
  const [notice, setNotice] = useState<string | null>(null)

  // Sync the draft when the settings come back from the main process (e.g. after "restore
  // defaults").
  useEffect(() => {
    setPromptDraft(settings.ai.extraPrompt)
  }, [settings.ai.extraPrompt])

  // Only models that already have credentials configured locally are listed; switching the model
  // takes effect immediately and keeps the current conversation.
  async function loadModels(): Promise<void> {
    setLoadingModels(true)
    setModelError(null)
    try {
      setModels(await window.ai.listModels())
    } catch (err) {
      setModelError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    if (models === null && !loadingModels) void loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const list = models ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q)
    )
  }, [models, query])

  const shown = filtered.slice(0, 120)
  const current = settings.ai.model

  // The extra instructions are appended to the built-in system prompt. Changing them resets the
  // current conversation, because the prompt is baked into the session when it is created.
  async function commitPrompt(): Promise<void> {
    if (promptDraft === settings.ai.extraPrompt) return
    await update({ ai: { extraPrompt: promptDraft } })
    setNotice('附加指令已保存')
    setTimeout(() => setNotice(null), 2000)
  }

  return (
    <div>
      <Row
        label="模型"
        hint="列出的是本机 ~/.pi/agent 已配置认证的模型。切换模型会立即生效,并保留当前对话。"
        stacked
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadModels()}
            disabled={loadingModels}
            title="重新加载模型列表"
          >
            {loadingModels ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            刷新
          </Button>
        </div>

        <div className="max-h-56 overflow-y-auto rounded-md border">
          <button
            onClick={() => void update({ ai: { model: null } })}
            className={cn(
              'flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-xs',
              current === null ? 'bg-accent' : 'hover:bg-accent/50'
            )}
          >
            <span className="font-medium">跟随 pi 默认</span>
            {current === null && <Check className="h-3.5 w-3.5" />}
          </button>

          {loadingModels && (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在读取模型列表…
            </p>
          )}
          {modelError && (
            <p className="px-3 py-3 text-xs text-destructive">读取失败:{modelError}</p>
          )}
          {!loadingModels && !modelError && shown.length === 0 && (
            <div className="space-y-1 px-3 py-3 text-xs text-muted-foreground">
              {models && models.length === 0 ? (
                <>
                  <p className="text-destructive">没有检测到可用模型。</p>
                  <p>
                    请确认本机 pi 已配置认证(<code className="text-[11px]">~/.pi/agent/auth.json</code>)、
                    磁盘有可用空间;若上次是异常退出,点「刷新」重试即可。
                  </p>
                </>
              ) : (
                <p>没有匹配的模型</p>
              )}
            </div>
          )}

          {shown.map((m) => {
            const key = `${m.provider}/${m.id}`
            const active = current === key
            return (
              <button
                key={key}
                onClick={() => void update({ ai: { model: key } })}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs',
                  active ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {m.provider} / {m.id}
                    {m.reasoning ? ' · 支持推理' : ''}
                  </span>
                </span>
                {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
          {filtered.length > shown.length && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              还有 {filtered.length - shown.length} 个结果,输入关键词继续筛选
            </p>
          )}
        </div>
      </Row>

      <Row
        label="自动附带当前页面"
        hint="提问时把正在编辑的页面(标题 + 各块 id 与内容)一并送给模型,省掉一次读取调用"
      >
        <Toggle
          checked={settings.ai.autoContext}
          onChange={(autoContext) => void update({ ai: { autoContext } })}
        />
      </Row>

      <Row
        label="附加指令"
        hint="追加到内置系统提示词之后,用来固定 AI 的语气和写作习惯。修改会重置当前对话。"
        stacked
      >
        <textarea
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          onBlur={() => void commitPrompt()}
          rows={4}
          placeholder="例如:整理会议记录时,始终把待办抽成 todo 块,并标注负责人。"
          className="w-full resize-none rounded-md border border-input bg-background px-2.5 py-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            {notice ?? '失焦自动保存'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void window.ai.reset()
              setNotice('对话已重置')
              setTimeout(() => setNotice(null), 2000)
            }}
          >
            <MessageSquareX />
            重置对话
          </Button>
        </div>
      </Row>
    </div>
  )
}

/* ---------- Data and storage ---------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function DataSection(): JSX.Element {
  const resetAll = useSettings((s) => s.resetAll)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The data section reports the database path, the asset directory and the page/block counts.
  useEffect(() => {
    void window.settings.getAppInfo().then(setInfo)
  }, [])

  return (
    <div>
      <Row label="页面 / 块" hint="全部保存在本机 SQLite 数据库中,不上传任何服务器">
        <span className="text-xs text-muted-foreground">
          {info ? `${info.pageCount} 个页面 · ${info.blockCount} 个块` : '读取中…'}
        </span>
      </Row>

      <Row
        label="数据库"
        hint={info ? `${info.dbPath} · ${formatBytes(info.dbBytes)}` : '读取中…'}
      >
        <Button variant="outline" size="sm" onClick={() => void window.settings.reveal('data')}>
          <FolderOpen />
          打开目录
        </Button>
      </Row>

      <Row
        label="图片资源"
        hint={
          info
            ? `${info.assetsDir} · ${info.assetCount} 个文件 / ${formatBytes(info.assetBytes)}`
            : '读取中…'
        }
      >
        <Button variant="outline" size="sm" onClick={() => void window.settings.reveal('assets')}>
          <FolderOpen />
          打开目录
        </Button>
      </Row>

      <Row
        label="恢复默认设置"
        hint="会重置主题、字号与内容宽度、AI 偏好三项设置,不会删除任何页面或块"
      >
        {/* Two-step confirm, so that a destructive action is never a single click. */}
        <Button
          variant={confirmReset ? 'destructive' : 'outline'}
          size="sm"
          onClick={() => {
            if (!confirmReset) {
              setConfirmReset(true)
              resetTimer.current = setTimeout(() => setConfirmReset(false), 3000)
              return
            }
            if (resetTimer.current) clearTimeout(resetTimer.current)
            setConfirmReset(false)
            void resetAll()
          }}
        >
          <RotateCcw />
          {confirmReset ? '再点一次确认' : '恢复默认'}
        </Button>
      </Row>
    </div>
  )
}

/* ---------- About ---------- */

function AboutSection(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void window.settings.getAppInfo().then(setInfo)
  }, [])

  const rows: Array<[string, string]> = info
    ? [
        ['版本', info.version],
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['Node.js', info.node],
        ['平台', info.platform]
      ]
    : []

  return (
    <div className="py-2">
      <div className="flex items-center gap-3 pb-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">
          N
        </span>
        <div>
          <p className="text-sm font-semibold">Notion Clone</p>
          <p className="text-xs text-muted-foreground">
            本地优先的块笔记应用,数据全在本机,AI 助手由 Pi SDK 驱动。
          </p>
        </div>
      </div>
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex items-center justify-between border-b border-border/60 py-2 text-xs last:border-b-0"
        >
          <span className="text-muted-foreground">{k}</span>
          <span className="font-mono">{v}</span>
        </div>
      ))}
    </div>
  )
}
