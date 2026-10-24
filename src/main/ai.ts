import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync, readdirSync, rmdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentSession,
  AgentSessionEvent,
  ModelRuntime,
  ToolDefinition
} from '@earendil-works/pi-coding-agent'
import * as db from './db'
import { getSettings, onSettingsChanged } from './settings'
import type {
  AiEvent,
  AiModelInfo,
  AiPageContext,
  AiSendResult,
  AiStatus,
  AppSettings,
  BlockContent,
  BlockType
} from '@neonity/neonote-shared'
import { tableToText } from '@neonity/neonote-shared'

/**
 * AI assistant service: runs a Pi agent session inside the main process.
 * - Reuses the model and auth configuration from the user's local ~/.pi/agent
 * - Disables every builtin tool (read/bash/edit/write) and exposes only the
 *   note read/write tools
 * - Streams the session's events to the renderer over IPC
 */

const SYSTEM_PROMPT_BASE = `你是 Neonote 笔记应用内置的 AI 助手,使用简体中文回答。

你可以通过工具读写用户的笔记:
- notes_list_pages:列出所有页面(返回 id、标题、图标、父页面)
- notes_read_page:读取一个页面的全部块内容
- notes_search:全文搜索标题与块内容
- notes_create_page:新建页面
- notes_append_blocks:向页面末尾追加块(段落、标题、列表、待办、引用、代码、分割线、表格)
- notes_update_block:修改块的内容、类型或待办勾选状态
- notes_delete_block:删除块

行为准则:
`

/** Behaviour rules used while "attach the current page context automatically" is on. */
const CONTEXT_RULE_ON = `- 用户提问时,系统会自动附带"当前页面上下文"(用户正在看的页面 id、标题和块内容),
  里面的块 id 可以直接用于 notes_update_block / notes_delete_block,不必再调 notes_read_page。
- 上下文只是快照,若怀疑内容已变化(比如你自己改动过),先用 notes_read_page 重新读取。
`

/** Behaviour rules used while the automatic context is off. */
const CONTEXT_RULE_OFF = `- 你看不到用户当前打开的页面。要操作页面内容时,先用 notes_list_pages 找到页面,
  再用 notes_read_page 拿到块 id,不要凭空猜测块 id。
`

const SYSTEM_PROMPT_TAIL = `- 回答简洁,直接给结果,不要废话。
- 用户让你写东西到笔记里时,直接用工具写入,不要只把内容贴在回复里。
- 修改已有内容前先读取页面,确认块 id,避免误改。
- 删除操作是不可逆的,执行前向用户确认,除非用户已明确表达删除意图。
- 你只能通过工具操作笔记,不要假装能访问文件系统或网络。`

/** The system prompt = base instructions + context rules + the user's extra instructions. */
function buildSystemPrompt(settings: AppSettings): string {
  const contextRule = settings.ai.autoContext ? CONTEXT_RULE_ON : CONTEXT_RULE_OFF
  const extra = settings.ai.extraPrompt.trim()
  return SYSTEM_PROMPT_BASE + contextRule + SYSTEM_PROMPT_TAIL + (extra ? `\n\n附加要求(来自用户设置):\n${extra}` : '')
}

let session: AgentSession | null = null
let initPromise: Promise<AgentSession> | null = null
let lastContextKey: string | null = null
/** The system prompt the live session actually uses, to spot settings changes that need a rebuild. */
let activeSystemPrompt = ''
let sdkPromise: Promise<typeof import('@earendil-works/pi-coding-agent')> | null = null
let runtime: ModelRuntime | null = null

/**
 * The SDK is loaded through a cached dynamic import: it is a pure ESM package,
 * which the CommonJS main bundle cannot require statically.
 */
function loadSdk(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  if (!sdkPromise) sdkPromise = import('@earendil-works/pi-coding-agent')
  return sdkPromise
}

/**
 * pi locks auth.json with a "directory lock" — a sibling empty directory named
 * auth.json.lock.
 * When the process is killed (crash / kill -9 / app.exit) the lock is not
 * released, and the leftover empty directory makes every later auth read and
 * model refresh fail — which surfaces in the UI as "no matching model".
 *
 * Only an empty lock that has not been touched for a while is removed: the
 * process holding the lock refreshes its mtime periodically, so an empty lock
 * that has been idle for more than 60 seconds cannot have a live owner and is
 * safe to delete.
 */
function cleanStaleAuthLock(agentDir: string): void {
  const lockDir = join(agentDir, 'auth.json.lock')
  try {
    if (!existsSync(lockDir)) return
    const st = statSync(lockDir)
    if (!st.isDirectory() || readdirSync(lockDir).length > 0) return
    if (Date.now() - st.mtimeMs < 60_000) return
    rmdirSync(lockDir)
    console.log('[ai] 已清理残留的 auth.json.lock 孤儿锁(上次异常退出留下的)')
  } catch {
    // A failed cleanup must not block the main flow.
  }
}

/** The model runtime (with its catalog and auth snapshot) is reused in-process so rebuilding a session does not refresh it again. */
async function getRuntime(): Promise<ModelRuntime> {
  if (runtime) return runtime
  const sdk = await loadSdk()
  cleanStaleAuthLock(sdk.getAgentDir())
  runtime = await sdk.ModelRuntime.create()
  return runtime
}

/**
 * Get a healthy runtime: an empty model snapshot means the refresh that ran at
 * creation time failed (disk full, orphaned lock, network trouble). Clear a
 * leftover lock once more and retry the refresh.
 * Otherwise the empty snapshot is cached forever, which leaves the model
 * unresolvable and makes every call fail with "No API key for provider".
 */
async function ensureRuntime(): Promise<ModelRuntime> {
  const rt = await getRuntime()
  if (rt.getAvailableSnapshot().length === 0) {
    const sdk = await loadSdk()
    cleanStaleAuthLock(sdk.getAgentDir())
    try {
      await rt.refresh()
    } catch {
      // Ignore: the caller turns any failure into a readable message.
    }
  }
  return rt
}

/** Resolve the "provider/id" key from settings into a runtime model (the provider must have credentials configured). */
async function resolveModel(key: string | null): Promise<any | undefined> {
  if (!key) return undefined
  const sep = key.indexOf('/')
  if (sep <= 0) return undefined
  const rt = await ensureRuntime()
  const provider = key.slice(0, sep)
  const id = key.slice(sep + 1)
  const model = rt.getModel(provider, id)
  if (!model) return undefined
  // Never pick a provider without credentials, otherwise the call itself would
  // fail with "No API key".
  if (!rt.hasConfiguredAuth(provider)) return undefined
  return model
}

/** Turn the SDK's raw English errors into actionable Chinese messages for the user. */
function humanizeAiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const noKey = /No API key for provider[:\s]*([\w.-]+)/i.exec(msg)
  if (noKey) {
    return `提供商「${noKey[1]}」没有可用凭据。请在设置里换一个模型,或为本机 pi 配置该提供商的密钥(~/.pi/agent/auth.json)。`
  }
  if (/disk is full|no space left|ENOSPC/i.test(msg)) {
    return '磁盘空间不足,操作未能写入。请清理磁盘后重试。'
  }
  return msg
}

/** Chinese labels for the tools, shown in the AI panel's tool activity list. */
const TOOL_LABELS: Record<string, string> = {
  notes_list_pages: '列出页面',
  notes_read_page: '读取页面',
  notes_search: '搜索笔记',
  notes_create_page: '新建页面',
  notes_append_blocks: '追加内容',
  notes_update_block: '修改块',
  notes_delete_block: '删除块'
}

/** The tools that modify the notes; only these make the renderer refetch them. */
const MUTATING_TOOLS = new Set([
  'notes_create_page',
  'notes_append_blocks',
  'notes_update_block',
  'notes_delete_block'
])

/**
 * The window the AI events are delivered to.
 *
 * The window is looked up on every send instead of being cached: on macOS the
 * app stays alive after the last window is closed, and the 'activate' handler
 * then opens a new one. A cached reference would still point at the destroyed
 * window, and every event would be silently dropped.
 */
function targetWindow(): BrowserWindow | null {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) return w
  }
  return null
}

function emit(event: AiEvent): void {
  const w = targetWindow()
  if (w) {
    w.webContents.send('ai:event', event)
  }
}

function emitNotesChanged(): void {
  const w = targetWindow()
  if (w) {
    w.webContents.send('ai:notes-changed')
  }
}

function handleEvent(event: AgentSessionEvent): void {
  switch (event.type) {
    case 'agent_start':
      emit({ type: 'run_start' })
      break
    case 'message_update': {
      const e = event.assistantMessageEvent
      if (e.type === 'text_delta') {
        emit({ type: 'text_delta', delta: e.delta })
      } else if (e.type === 'thinking_delta') {
        emit({ type: 'thinking_delta', delta: e.delta })
      }
      break
    }
    case 'tool_execution_start':
      emit({
        type: 'tool_start',
        id: event.toolCallId,
        name: event.toolName,
        label: TOOL_LABELS[event.toolName] ?? event.toolName,
        args: event.args
      })
      break
    case 'tool_execution_end':
      emit({
        type: 'tool_end',
        id: event.toolCallId,
        name: event.toolName,
        isError: event.isError
      })
      // Only the mutating tools change the notes, so the renderer refetches
      // them when something actually changed.
      if (MUTATING_TOOLS.has(event.toolName)) {
        emitNotesChanged()
      }
      break
    case 'auto_retry_start':
      emit({ type: 'notice', text: `请求失败,自动重试(${event.attempt}/${event.maxAttempts})…` })
      break
    case 'agent_end':
      emit({ type: 'run_end', error: session?.state.errorMessage })
      break
  }
}

type TypeBox = typeof import('@earendil-works/pi-ai').Type

/** Normalize the model's two-dimensional array into a rectangular table (the first row is the header) and write the plain-text summary alongside it. */
function tableContent(raw: unknown): BlockContent {
  const list = Array.isArray(raw) ? raw.filter((r): r is unknown[] => Array.isArray(r)) : []
  const rows = list.map((r) => r.map((v) => (v == null ? '' : String(v))))
  if (rows.length === 0) rows.push([''])
  const width = Math.max(1, ...rows.map((r) => r.length))
  const padded = rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => '')])
  const table = { header: true, rows: padded }
  return { table, text: tableToText(table) }
}

// The `any` type parameters keep each tool's execute params as `any`, so the
// Static<T> types do not have to be spelled out one by one.
function buildNotesTools(Type: TypeBox): Array<ToolDefinition<any, any>> {
  const blockTypeSchema = Type.Union([
    Type.Literal('paragraph'),
    Type.Literal('heading1'),
    Type.Literal('heading2'),
    Type.Literal('heading3'),
    Type.Literal('bulletedList'),
    Type.Literal('numberedList'),
    Type.Literal('todo'),
    Type.Literal('quote'),
    Type.Literal('code'),
    Type.Literal('divider'),
    Type.Literal('table')
  ])

  const ok = (data: unknown): { content: Array<{ type: 'text'; text: string }>; details: Record<string, never> } => ({
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    details: {}
  })

  const fail = (message: string): { content: Array<{ type: 'text'; text: string }>; details: Record<string, never>; isError: boolean } => ({
    content: [{ type: 'text', text: message }],
    details: {},
    isError: true
  })

  return [
    {
      name: 'notes_list_pages',
      label: TOOL_LABELS.notes_list_pages,
      description: '列出笔记应用中的所有页面,返回 id、标题、图标 emoji、父页面 id',
      parameters: Type.Object({}),
      execute: async () =>
        ok(
          db.listPages().map((p) => ({
            id: p.id,
            title: p.title || '无标题',
            icon: p.icon,
            parentId: p.parentId
          }))
        )
    },
    {
      name: 'notes_read_page',
      label: TOOL_LABELS.notes_read_page,
      description: '读取一个页面的全部块,返回每个块的 id、类型、文本、待办勾选状态',
      parameters: Type.Object({
        pageId: Type.String({ description: '页面 id' })
      }),
      execute: async (_id, params: any) => {
        const blocks = db.listBlocks(params.pageId)
        if (blocks.length === 0) return ok('(空页面)')
        return ok(
          blocks.map((b) => ({
            id: b.id,
            type: b.type,
            text: b.content.text ?? '',
            ...(b.type === 'todo' ? { checked: !!b.content.checked } : {})
          }))
        )
      }
    },
    {
      name: 'notes_search',
      label: TOOL_LABELS.notes_search,
      description: '在全部笔记中搜索关键词,匹配页面标题和块正文',
      parameters: Type.Object({
        query: Type.String({ description: '搜索关键词' })
      }),
      execute: async (_id, params: any) => {
        const results = db.search(params.query)
        if (results.length === 0) return ok('没有找到匹配的内容')
        return ok(results)
      }
    },
    {
      name: 'notes_create_page',
      label: TOOL_LABELS.notes_create_page,
      description: '新建一个页面,返回新页面 id',
      parameters: Type.Object({
        title: Type.String({ description: '页面标题' }),
        parentId: Type.Optional(Type.String({ description: '父页面 id,省略则创建顶级页面' }))
      }),
      execute: async (_id, params: any) => {
        const page = db.createPage({ title: params.title, parentId: params.parentId ?? null })
        return ok({ id: page.id, title: page.title })
      }
    },
    {
      name: 'notes_append_blocks',
      label: TOOL_LABELS.notes_append_blocks,
      description: '向页面末尾依次追加多个块',
      parameters: Type.Object({
        pageId: Type.String({ description: '页面 id' }),
        blocks: Type.Array(
          Type.Object({
            type: blockTypeSchema,
            text: Type.Optional(Type.String({ description: '块文本内容,divider 可省略' })),
            checked: Type.Optional(Type.Boolean({ description: '仅 todo 块:是否勾选' })),
            table: Type.Optional(
              Type.Array(Type.Array(Type.String()), {
                description: '仅 table 块:二维字符串数组,第一行作为表头(如 [["名称","数量"],["苹果","3"]])'
              })
            )
          }),
          { minItems: 1 }
        )
      }),
      execute: async (_id, params: any) => {
        const page = db.listPages().find((p) => p.id === params.pageId)
        if (!page) return fail(`页面不存在: ${params.pageId}`)
        let lastId: string | null = null
        const existing = db.listBlocks(params.pageId)
        if (existing.length > 0) lastId = existing[existing.length - 1].id
        const created: string[] = []
        for (const b of params.blocks) {
          const block = db.createBlock({
            pageId: params.pageId,
            type: b.type as BlockType,
            content: b.type === 'table' ? tableContent(b.table) : {
              text: b.text ?? '',
              ...(b.type === 'todo' ? { checked: !!b.checked } : {})
            },
            afterId: lastId
          })
          created.push(block.id)
          lastId = block.id
        }
        return ok(`已追加 ${created.length} 个块`)
      }
    },
    {
      name: 'notes_update_block',
      label: TOOL_LABELS.notes_update_block,
      description: '修改一个块:文本内容、块类型、待办勾选状态、表格数据,至少提供一项',
      parameters: Type.Object({
        blockId: Type.String({ description: '块 id' }),
        text: Type.Optional(Type.String({ description: '新的文本内容' })),
        type: Type.Optional(blockTypeSchema),
        checked: Type.Optional(Type.Boolean({ description: '仅 todo 块:是否勾选' })),
        table: Type.Optional(
          Type.Array(Type.Array(Type.String()), {
            description: '仅 table 块:新的二维字符串数组(整表替换,第一行为表头)'
          })
        )
      }),
      execute: async (_id, params: any) => {
        const block = db.getBlock(params.blockId)
        if (!block) return fail(`块不存在: ${params.blockId}`)
        let content = { ...block.content }
        if (params.table !== undefined) {
          content = tableContent(params.table)
        }
        if (params.text !== undefined) content.text = params.text
        if (params.checked !== undefined) content.checked = params.checked
        if (params.type !== undefined && params.type === 'divider') content.text = ''
        db.updateBlock({
          id: block.id,
          type: (params.type as BlockType | undefined) ?? block.type,
          content
        })
        return ok('已更新')
      }
    },
    {
      name: 'notes_delete_block',
      label: TOOL_LABELS.notes_delete_block,
      description: '删除一个块(不可恢复)',
      parameters: Type.Object({
        blockId: Type.String({ description: '块 id' })
      }),
      execute: async (_id, params: any) => {
        const block = db.getBlock(params.blockId)
        if (!block) return fail(`块不存在: ${params.blockId}`)
        db.deleteBlock(params.blockId)
        return ok('已删除')
      }
    }
  ]
}

async function ensureSession(): Promise<AgentSession> {
  if (session) return session
  if (!initPromise) {
    initPromise = (async () => {
      // The SDK is pure ESM while the main process bundle is CJS, so it is
      // loaded with a dynamic import.
      const sdk = await loadSdk()
      const { Type } = await import('@earendil-works/pi-ai')

      const settings = getSettings()
      const systemPrompt = buildSystemPrompt(settings)
      const modelRuntime = await ensureRuntime()
      const model = await resolveModel(settings.ai.model)

      // With no usable model pi would fail at call time with "No API key for
      // provider: x"; intercept it here and give an actionable reason.
      if (modelRuntime.getAvailableSnapshot().length === 0) {
        const detail = modelRuntime.getError()
        throw new Error(
          `没有检测到可用模型${detail ? `(${detail})` : ''}。` +
            '请确认本机 pi 的凭据有效(~/.pi/agent/auth.json),并确保磁盘有可用空间。'
        )
      }

      const resourceLoader = new sdk.DefaultResourceLoader({
        cwd: app.getPath('userData'),
        agentDir: sdk.getAgentDir(),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt,
        // Do not mix in the user's pi CLI extras such as APPEND_SYSTEM.md.
        appendSystemPromptOverride: () => []
      })
      await resourceLoader.reload()

      const { session: s } = await sdk.createAgentSession({
        modelRuntime,
        resourceLoader,
        sessionManager: sdk.SessionManager.inMemory(),
        // Use the model from settings when set, otherwise let pi pick its default.
        ...(model ? { model } : {}),
        // Disable the read/bash/edit/write builtin tools and keep only the note tools.
        noTools: 'builtin',
        customTools: buildNotesTools(Type)
      })
      s.subscribe(handleEvent)
      session = s
      activeSystemPrompt = systemPrompt
      lastContextKey = null
      return s
    })()
    // Allow a retry on the next attempt when initialization failed.
    initPromise.catch(() => {
      initPromise = null
    })
  }
  return initPromise
}

/** Discard the current session; the next question rebuilds it from the latest settings. */
function resetSession(): void {
  try {
    session?.dispose()
  } catch {
    // ignore
  }
  session = null
  initPromise = null
  lastContextKey = null
  activeSystemPrompt = ''
}

/** Keep the session in sync with settings: a model change switches in place (keeping the conversation), a prompt change rebuilds the session. */
async function applySettings(next: AppSettings): Promise<void> {
  if (!session) return

  const nextPrompt = buildSystemPrompt(next)
  if (nextPrompt !== activeSystemPrompt) {
    resetSession()
    emit({ type: 'notice', text: '设置已更新,对话上下文已重置' })
    return
  }

  const current = session.model ? `${session.model.provider}/${session.model.id}` : null
  if (next.ai.model === current) return

  // "Follow pi's default" cannot be applied in place: the SDK's setModel()
  // only accepts an explicit model. The session is rebuilt instead, so the
  // next question runs on whatever pi picks by default. Without this branch
  // the setting said "default" while the session kept running the old model.
  if (next.ai.model === null) {
    resetSession()
    emit({ type: 'notice', text: '已切换为 pi 默认模型,对话上下文已重置' })
    return
  }

  const model = await resolveModel(next.ai.model)
  if (!model) return
  try {
    await session.setModel(model)
    emit({ type: 'notice', text: `已切换模型:${model.provider}/${model.id}` })
  } catch (err) {
    emit({
      type: 'notice',
      text: `切换模型失败:${humanizeAiError(err)}`
    })
  }
}

/**
 * Render the current page into a context text that is injected as a custom
 * message. A custom message is delivered to the model as a user message and
 * does not trigger another generation round.
 */
function renderContext(ctx: AiPageContext): string {
  const lines: string[] = [
    '[当前页面上下文]',
    `页面 id: ${ctx.pageId}`,
    `标题: ${ctx.icon ? ctx.icon + ' ' : ''}${ctx.title || '无标题'}`
  ]
  if (ctx.blocks.length === 0) {
    lines.push('内容: (空页面)')
  } else {
    lines.push('内容(每行 = 一个块,方括号内是块类型):')
    for (const b of ctx.blocks) {
      const text = b.text.replace(/\n/g, '⏎ ')
      lines.push(
        b.type === 'todo'
          ? `- [${b.id}] (${b.type},${b.checked ? '已勾选' : '未勾选'}) ${text}`
          : `- [${b.id}] (${b.type}) ${text}`
      )
    }
  }
  lines.push(
    '这是发送时的快照。要精确改动某个块请直接用上面的块 id;若怀疑内容已变化,先用 notes_read_page 重新读取。'
  )
  return lines.join('\n')
}

/** Context fingerprint: the context is not injected again while neither the page nor its content changed. */
function contextKey(ctx: AiPageContext): string {
  const body = ctx.blocks.map((b) => `${b.id}:${b.type}:${b.text}:${b.checked ? 1 : 0}`).join('|')
  return `${ctx.pageId}::${ctx.title}::${body}`
}

function currentStatus(s: AgentSession): AiStatus {
  const m = s.model
  return { ready: true, model: m ? `${m.provider} / ${m.id}` : undefined }
}

/** Register the AI IPC handlers and keep the running session in sync with the settings. */
export function registerAi(): void {
  // Keep the session in sync when the settings panel changes the model, the
  // prompt, or the context switch.
  onSettingsChanged((next) => {
    void applySettings(next)
  })

  ipcMain.handle(
    'ai:send',
    async (_e, text: string, context: AiPageContext | null): Promise<AiSendResult> => {
      try {
        const s = await ensureSession()
        // The page context is injected only when it changes, so it does not
        // pile up with every turn.
        if (context && getSettings().ai.autoContext) {
          const key = contextKey(context)
          if (key !== lastContextKey) {
            await s.sendCustomMessage(
              {
                customType: 'notes_context',
                content: renderContext(context),
                display: false,
                details: {}
              },
              { triggerTurn: false }
            )
            lastContextKey = key
          }
        }
        await s.prompt(text)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: humanizeAiError(err) }
      }
    }
  )

  ipcMain.handle('ai:abort', async () => {
    try {
      await session?.abort()
    } catch {
      // ignore
    }
  })

  // The first call also completes the session initialization (model and auth
  // loading), so the panel can show the model info as early as possible.
  ipcMain.handle('ai:status', async (): Promise<AiStatus> => {
    try {
      const s = await ensureSession()
      return currentStatus(s)
    } catch (err) {
      return { ready: false, error: humanizeAiError(err) }
    }
  })

  // List the models available on this machine, for the settings panel's picker.
  ipcMain.handle('ai:models', async (): Promise<AiModelInfo[]> => {
    const rt = await ensureRuntime()
    let models = rt.getAvailableSnapshot()
    if (models.length === 0) {
      // If the refresh failed at creation time, try once more here.
      models = await rt.getAvailable().catch(() => rt.getAvailableSnapshot())
    }
    const list: AiModelInfo[] = models.map((m) => ({
      provider: m.provider,
      id: m.id,
      name: m.name || m.id,
      reasoning: !!m.reasoning,
      contextWindow: m.contextWindow ?? 0
    }))
    list.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id))
    if (rt.getError()) {
      emit({ type: 'notice', text: `模型列表可能不完整:${rt.getError()}` })
    }
    return list
  })

  // Clear the conversation (the settings are kept); the next question builds a
  // new session.
  ipcMain.handle('ai:reset', async () => {
    resetSession()
  })
}
