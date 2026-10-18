import { app, ipcMain, type BrowserWindow } from 'electron'
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
} from '../shared/types'
import { tableToText } from '../shared/types'

/**
 * AI 助手服务:在主进程内运行一个 Pi agent 会话。
 * - 复用用户本机 ~/.pi/agent 的模型与认证配置
 * - 禁用所有内置工具(read/bash/edit/write),只暴露笔记读写工具
 * - 流式事件通过 IPC 推送给渲染进程
 */

const SYSTEM_PROMPT_BASE = `你是 Notion Clone 笔记应用内置的 AI 助手,使用简体中文回答。

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

/** 开启「自动附带当前页面上下文」时的行为准则 */
const CONTEXT_RULE_ON = `- 用户提问时,系统会自动附带"当前页面上下文"(用户正在看的页面 id、标题和块内容),
  里面的块 id 可以直接用于 notes_update_block / notes_delete_block,不必再调 notes_read_page。
- 上下文只是快照,若怀疑内容已变化(比如你自己改动过),先用 notes_read_page 重新读取。
`

/** 关闭自动上下文时的行为准则 */
const CONTEXT_RULE_OFF = `- 你看不到用户当前打开的页面。要操作页面内容时,先用 notes_list_pages 找到页面,
  再用 notes_read_page 拿到块 id,不要凭空猜测块 id。
`

const SYSTEM_PROMPT_TAIL = `- 回答简洁,直接给结果,不要废话。
- 用户让你写东西到笔记里时,直接用工具写入,不要只把内容贴在回复里。
- 修改已有内容前先读取页面,确认块 id,避免误改。
- 删除操作是不可逆的,执行前向用户确认,除非用户已明确表达删除意图。
- 你只能通过工具操作笔记,不要假装能访问文件系统或网络。`

/** 系统提示词 = 基础说明 + 上下文准则 + 用户自定义附加指令 */
function buildSystemPrompt(settings: AppSettings): string {
  const contextRule = settings.ai.autoContext ? CONTEXT_RULE_ON : CONTEXT_RULE_OFF
  const extra = settings.ai.extraPrompt.trim()
  return SYSTEM_PROMPT_BASE + contextRule + SYSTEM_PROMPT_TAIL + (extra ? `\n\n附加要求(来自用户设置):\n${extra}` : '')
}

let win: BrowserWindow | null = null
let session: AgentSession | null = null
let initPromise: Promise<AgentSession> | null = null
let lastContextKey: string | null = null
/** 当前会话实际使用的系统提示词,用于判断设置变更后是否需要重建会话 */
let activeSystemPrompt = ''
let sdkPromise: Promise<typeof import('@earendil-works/pi-coding-agent')> | null = null
let runtime: ModelRuntime | null = null

function loadSdk(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  if (!sdkPromise) sdkPromise = import('@earendil-works/pi-coding-agent')
  return sdkPromise
}

/**
 * pi 给 auth.json 加的是"目录锁"(锁就是一个同名 .lock 空目录)。
 * 进程被强杀(崩溃 / kill -9 / app.exit)时锁不会被释放,残留的空目录会让之后每一次
 * 认证读取与模型刷新都失败 —— 界面上就表现为设置里"没有匹配的模型"。
 *
 * 这里只清理"空目录 + 长时间未更新"的锁:持有锁的进程会周期性刷新锁的 mtime,
 * 因此超过 60 秒没动过的空锁一定没有活着的持有者,删除是安全的。
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
    // 清理失败不影响主流程
  }
}

/** 模型运行时(含目录与认证快照)在进程内复用,避免每次重建会话都重新刷新 */
async function getRuntime(): Promise<ModelRuntime> {
  if (runtime) return runtime
  const sdk = await loadSdk()
  cleanStaleAuthLock(sdk.getAgentDir())
  runtime = await sdk.ModelRuntime.create()
  return runtime
}

/**
 * 取一个"健康"的运行时:若可用模型快照是空的,说明创建时的刷新失败了
 * (磁盘写满、孤儿锁、网络异常等),这里清一次残留锁再补一次 refresh。
 * 否则快照会被永久缓存成空,导致模型解析不出、调用时抛 "No API key for provider"。
 */
async function ensureRuntime(): Promise<ModelRuntime> {
  const rt = await getRuntime()
  if (rt.getAvailableSnapshot().length === 0) {
    const sdk = await loadSdk()
    cleanStaleAuthLock(sdk.getAgentDir())
    try {
      await rt.refresh()
    } catch {
      // 忽略:失败原因由调用方统一转成可读提示
    }
  }
  return rt
}

/** 把设置里的 "provider/id" 解析成运行时里的模型对象(要求该 provider 已配置凭据) */
async function resolveModel(key: string | null): Promise<any | undefined> {
  if (!key) return undefined
  const sep = key.indexOf('/')
  if (sep <= 0) return undefined
  const rt = await ensureRuntime()
  const provider = key.slice(0, sep)
  const id = key.slice(sep + 1)
  const model = rt.getModel(provider, id)
  if (!model) return undefined
  // provider 没有凭据时不要选它,否则调用阶段会直接抛 "No API key"
  if (!rt.hasConfiguredAuth(provider)) return undefined
  return model
}

/** 把 SDK 抛出的英文错误翻译成用户能看懂、可操作的中文提示 */
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

const TOOL_LABELS: Record<string, string> = {
  notes_list_pages: '列出页面',
  notes_read_page: '读取页面',
  notes_search: '搜索笔记',
  notes_create_page: '新建页面',
  notes_append_blocks: '追加内容',
  notes_update_block: '修改块',
  notes_delete_block: '删除块'
}

const MUTATING_TOOLS = new Set([
  'notes_create_page',
  'notes_append_blocks',
  'notes_update_block',
  'notes_delete_block'
])

function emit(event: AiEvent): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('ai:event', event)
  }
}

function emitNotesChanged(): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('ai:notes-changed')
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

/** 把模型传来的二维数组规范化成矩形表格(第一行作表头),同时写入纯文本摘要 */
function tableContent(raw: unknown): BlockContent {
  const list = Array.isArray(raw) ? raw.filter((r): r is unknown[] => Array.isArray(r)) : []
  const rows = list.map((r) => r.map((v) => (v == null ? '' : String(v))))
  if (rows.length === 0) rows.push([''])
  const width = Math.max(1, ...rows.map((r) => r.length))
  const padded = rows.map((r) => [...r, ...Array.from({ length: width - r.length }, () => '')])
  const table = { header: true, rows: padded }
  return { table, text: tableToText(table) }
}

// 用 any 泛型让各工具 execute 的 params 保持 any,避免逐个手写 Static<T> 类型
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
      // SDK 是纯 ESM,主进程构建产物是 CJS,用动态 import 加载
      const sdk = await loadSdk()
      const { Type } = await import('@earendil-works/pi-ai')

      const settings = getSettings()
      const systemPrompt = buildSystemPrompt(settings)
      const modelRuntime = await ensureRuntime()
      const model = await resolveModel(settings.ai.model)

      // 一个可用模型都没有时,pi 会在调用阶段抛 "No API key for provider: x",
      // 这里提前拦下并给出可操作的原因。
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
        // 不混入用户 pi CLI 的 APPEND_SYSTEM.md 等附加提示词
        appendSystemPromptOverride: () => []
      })
      await resourceLoader.reload()

      const { session: s } = await sdk.createAgentSession({
        modelRuntime,
        resourceLoader,
        sessionManager: sdk.SessionManager.inMemory(),
        // 设置里指定了模型就用它,否则交给 pi 的默认选择
        ...(model ? { model } : {}),
        // 禁用 read/bash/edit/write 等内置工具,只保留笔记工具
        noTools: 'builtin',
        customTools: buildNotesTools(Type)
      })
      s.subscribe(handleEvent)
      session = s
      activeSystemPrompt = systemPrompt
      lastContextKey = null
      return s
    })()
    // 初始化失败允许下次重试
    initPromise.catch(() => {
      initPromise = null
    })
  }
  return initPromise
}

/** 丢弃当前会话;下次提问时按最新设置重建 */
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

/** 设置变更后让会话跟上:改模型就地切换(保留对话),改提示词则重建会话 */
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
 * 把当前页面渲染成一段上下文文本,作为一条 custom 消息塞进会话。
 * custom 消息会转成 user 消息送进模型,且不会触发新一轮生成。
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

/** 上下文指纹:页面没变且内容没变时不再重复注入 */
function contextKey(ctx: AiPageContext): string {
  const body = ctx.blocks.map((b) => `${b.id}:${b.type}:${b.text}:${b.checked ? 1 : 0}`).join('|')
  return `${ctx.pageId}::${ctx.title}::${body}`
}

function currentStatus(s: AgentSession): AiStatus {
  const m = s.model
  return { ready: true, model: m ? `${m.provider} / ${m.id}` : undefined }
}

export function registerAi(mainWindow: BrowserWindow): void {
  win = mainWindow

  // 设置面板改了模型 / 提示词 / 上下文开关时,让会话跟上
  onSettingsChanged((next) => {
    void applySettings(next)
  })

  ipcMain.handle(
    'ai:send',
    async (_e, text: string, context: AiPageContext | null): Promise<AiSendResult> => {
      try {
        const s = await ensureSession()
        // 页面上下文只在发生变化时注入一次,避免每轮重复堆叠
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

  // 首次调用时顺便完成会话初始化(模型/认证加载),让面板尽快显示模型信息
  ipcMain.handle('ai:status', async (): Promise<AiStatus> => {
    try {
      const s = await ensureSession()
      return currentStatus(s)
    } catch (err) {
      return { ready: false, error: humanizeAiError(err) }
    }
  })

  // 列出本机可用模型(设置面板的模型选择器)
  ipcMain.handle('ai:models', async (): Promise<AiModelInfo[]> => {
    const rt = await ensureRuntime()
    let models = rt.getAvailableSnapshot()
    if (models.length === 0) {
      // 创建时若刷新失败,这里再尝试一次
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

  // 清空对话(保留设置),下次提问重新建会话
  ipcMain.handle('ai:reset', async () => {
    resetSession()
  })
}
