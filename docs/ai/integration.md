# Pi SDK 集成

AI 助手在**主进程**内运行一个 Pi agent 会话，复用用户本机 `~/.pi/agent` 的模型与认证配置。

全部实现集中在 `src/main/ai.ts`。

---

## 基本形态

```
渲染进程                        主进程                          Pi SDK
   │                             │                               │
   │ window.ai.send(text, ctx)   │                               │
   ├────────────────────────────▶│ ensureSession()               │
   │                             ├──────────────────────────────▶│
   │                             │  ModelRuntime.create()        │
   │                             │  DefaultResourceLoader        │
   │                             │  createAgentSession()         │
   │                             │◀──────────────────────────────┤
   │                             │                               │
   │◀── ai:event (text_delta) ───┤◀── agent events ────────────┤
   │◀── ai:event (tool_start) ───┤                               │
   │◀── ai:event (tool_end)   ───┤                               │
   │◀── ai:event (run_end)    ───┤                               │
```

**SDK 是纯 ESM，主进程产物是 CJS**，所以用动态 `import()` 加载：

```ts
let sdkPromise: Promise<typeof import('@earendil-works/pi-coding-agent')> | null = null

function loadSdk(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  if (!sdkPromise) sdkPromise = import('@earendil-works/pi-coding-agent')
  return sdkPromise
}
```

---

## 会话创建

`ensureSession()`（`src/main/ai.ts:428`）是**惰性**的：第一次 `ai:send` 或 `ai:status` 时才建。

```ts
const resourceLoader = new sdk.DefaultResourceLoader({
  cwd: app.getPath('userData'),
  agentDir: sdk.getAgentDir(),
  noExtensions: true,        // 不加载用户扩展
  noSkills: true,            // 不加载技能
  noPromptTemplates: true,   // 不加载提示词模板
  noThemes: true,            // 不加载主题
  noContextFiles: true,      // 不加载上下文文件（AGENTS.md 之类）
  systemPrompt,              // 我们自己构造
  appendSystemPromptOverride: () => []  // 屏蔽 APPEND_SYSTEM.md
})
await resourceLoader.reload()

const { session: s } = await sdk.createAgentSession({
  modelRuntime,
  resourceLoader,
  sessionManager: sdk.SessionManager.inMemory(),  // 不落盘对话历史
  ...(model ? { model } : {}),                     // 有指定模型才覆盖
  noTools: 'builtin',                             // 禁用全部内置工具
  customTools: buildNotesTools(Type)              // 只暴露笔记工具
})
```

### 两个关键约束

**`noTools: 'builtin'`** —— Pi 内置的 `read` / `bash` / `edit` / `write` 等工具全部禁用。
AI **无法**读写文件系统、执行命令。它只能通过 `notes_*` 工具操作笔记。

**`SessionManager.inMemory()`** —— 对话历史只在内存里，**不写入磁盘**。
关掉应用，对话就没了。

### 资源加载全面关闭

所有 `no*` 开关都是 `true`，加上 `appendSystemPromptOverride: () => []`。
这保证了用户的 pi CLI 配置**不会渗透**进本应用的 AI 会话——
本应用是一个隔离的、只服务于笔记的工具。

### 初始化失败可重试

```ts
initPromise.catch(() => { initPromise = null })
```

初始化失败时清空 `initPromise`，下次调用会重新尝试。`ai:reset` 也走同一套清理逻辑。

---

## 模型解析

`resolveModel(key)`（`src/main/ai.ts:134`）把设置里的 `"provider/id"` 解析成运行时模型对象：

```ts
const sep = key.indexOf('/')
if (sep <= 0) return undefined
const provider = key.slice(0, sep)
const id = key.slice(sep + 1)
const model = rt.getModel(provider, id)
if (!model) return undefined
if (!rt.hasConfiguredAuth(provider)) return undefined   // 没凭据就不用
return model
```

**两道过滤**：

1. 模型必须在运行时里存在。
2. **provider 必须已配置凭据**。否则调用阶段会直接抛 `No API key for provider: x`，
   与其在调用时崩，不如在选择阶段就排除。

`key = null` 表示"跟随 pi 默认"，返回 `undefined`，此时不传 `model` 参数，
让 Pi 自己挑。

---

## 运行时刷新：应对"没有可用模型"

`ModelRuntime` 在创建时会刷新一次可用模型快照。这个快照**会永久缓存**——
如果创建时刷新失败（比如磁盘满、孤儿锁），快照会**空着**，导致模型解析不出、
调用时抛 "No API key"，而且不会自己恢复。

`ensureRuntime()`（`src/main/ai.ts:119`）针对这个问题：

```ts
async function ensureRuntime(): Promise<ModelRuntime> {
  const rt = await getRuntime()
  if (rt.getAvailableSnapshot().length === 0) {
    cleanStaleAuthLock(sdk.getAgentDir())
    try { await rt.refresh() } catch { /* 失败原因由调用方转成可读提示 */ }
  }
  return rt
}
```

**快照为空 → 清一次孤儿锁 → 强制刷新**。

另外 `ai:models` 通道也有类似兜底：快照为空时再试 `getAvailable()`，
仍失败才用旧快照。

---

## 孤儿锁清理

Pi 给 `auth.json` 加锁的方式是创建一个**同名的空目录** `auth.json.lock`。
持锁进程会周期性刷新它的 mtime。

如果进程被强杀（崩溃 / `kill -9` / `app.exit`），锁**不会**被释放。
残留的空目录会让之后**每一次**认证读取和模型刷新都失败——
界面上就表现为"设置里没有匹配的模型"。

`cleanStaleAuthLock()`（`src/main/ai.ts:91`）的判断条件非常保守：

```ts
if (!existsSync(lockDir)) return
if (!st.isDirectory() || readdirSync(lockDir).length > 0) return   // 必须��空目录
if (Date.now() - st.mtimeMs < 60_000) return                       // 必须超过 60 秒没动
rmdirSync(lockDir)
```

三个条件同时满足才删：**是目录 + 是空的 + 超过 60 秒没更新**。
活着的持锁者会刷新 mtime，所以 60 秒没动过的空锁一定没有活的持有者。

---

## 错误本地化

`humanizeAiError()`（`src/main/ai.ts:149`）把 SDK 的英文错误翻成可操作的中文：

| 原始错误 | 转换后 |
| --- | --- |
| `No API key for provider: anthropic` | 提供商「anthropic」没有可用凭据。请在设置里换一个模型,或为本机 pi 配置该提供商的密钥(~/.pi/agent/auth.json)。 |
| `disk is full` / `ENOSPC` | 磁盘空间不足,操作未能写入。请清理磁盘后重试。 |
| 其他 | 原样透传 |

---

## 系统提示词

三段拼接（`buildSystemPrompt`，`src/main/ai.ts:63`）：

```
SYSTEM_PROMPT_BASE   基础说明 + 工具清单 + 行为准则开头
+ CONTEXT_RULE_ON    自动附带上下文时的准则
  或
+ CONTEXT_RULE_OFF   关闭时的准则
+ SYSTEM_PROMPT_TAIL 行为准则结尾
+ 用户附加指令（可选）
```

完整提示词内容见 [笔记工具集](tools.md#系统提示词)。

**提示词随设置变化**。`activeSystemPrompt` 记录当前会话实际用的提示词，
设置变更时对比：

```ts
if (nextPrompt !== activeSystemPrompt) {
  resetSession()                       // 提示词变了 → 重建会话
  emit({ type: 'notice', text: '设置已更新,对话上下文已重置' })
  return
}
```

而**只改模型**不重建会话，用 `session.setModel(model)` **就地切换**，保留对话历史：

```ts
await session.setModel(model)
emit({ type: 'notice', text: `已切换模型:${model.provider}/${model.id}` })
```

---

## 页面上下文注入

发送消息时，如果开启了自动上下文，主进程会把当前页面渲染成文本，
作为一条 **custom 消息**塞进会话：

```ts
await s.sendCustomMessage(
  { customType: 'notes_context', content: renderContext(context), display: false, details: {} },
  { triggerTurn: false }        // 不触发新一轮生成
)
```

`triggerTurn: false` 很关键：custom 消息会转成 user 消息送进模型，
但**不**额外触发一次生成，只是作为上下文垫在用户消息前面。

### 指纹去重

```ts
function contextKey(ctx: AiPageContext): string {
  const body = ctx.blocks.map((b) => `${b.id}:${b.type}:${b.text}:${b.checked ? 1 : 0}`).join('|')
  return `${ctx.pageId}::${ctx.title}::${body}`
}
```

指纹 = 页面 id + 标题 + 所有块的 id/类型/文本/勾选状态。

**指纹不变就不重复注入**，避免每轮对话都在历史里堆同一份上下文。
用户在页面上改一个字，指纹就变了，下次发送会带上新快照。

### 上下文格式

```
[当前页面上下文]
页面 id: <uuid>
标题: 👋 欢迎使用 Notion Clone
内容(每行 = 一个块,方括号内是块类型):
- [block-id] (paragraph) 这是���个本地优先的块笔记应用
- [block-id] (todo,未勾选) 试试勾选这个待办事项
- [block-id] (todo,已勾选) 已完成的事项会显示删除线
这是发送时的快照。要精确改动某个块请直接用上面的块 id;若怀疑内容已变化,先用 notes_read_page 重新读取。
```

块文本里的换行会被替换成 `⏎ `，保证**一行一个块**的格式不被破坏。

---

## 事件流

主进程订阅 Pi 的 `AgentSessionEvent`，翻译成 `AiEvent` 推给渲染层：

| Pi 事件 | 转成 | 说明 |
| --- | --- | --- |
| `agent_start` | `run_start` | 一轮开始 |
| `message_update`（`text_delta`） | `text_delta` | 正文增量 |
| `message_update`（`thinking_delta`） | `thinking_delta` | 思考增量 |
| `tool_execution_start` | `tool_start` | 工具开始，带中文标签 |
| `tool_execution_end` | `tool_end` | 工具结束，带错误标记 |
| `auto_retry_start` | `notice` | 自动重试提示 |
| `agent_end` | `run_end` | 一轮结束，可能带错误 |

### 写操作触发刷新

```ts
const MUTATING_TOOLS = new Set([
  'notes_create_page', 'notes_append_blocks', 'notes_update_block', 'notes_delete_block'
])
```

只要执行了写操作工具，就发一次 `ai:notes-changed`，渲染层收到后重新加载数据。

---

## 工具标签

工具的英文名会映射成中文标签，显示在对话气泡里的徽标上：

| 工具名 | 标签 |
| --- | --- |
| `notes_list_pages` | 列出页面 |
| `notes_read_page` | 读取页面 |
| `notes_search` | 搜索笔记 |
| `notes_create_page` | 新建页面 |
| `notes_append_blocks` | 追加内容 |
| `notes_update_block` | 修改块 |
| `notes_delete_block` | 删除块 |

---

## 相关文档

- [笔记工具集](tools.md) —— 工具参数与语义
- [AI 排障](troubleshooting.md) —— 出问题时看这里
- [ADR-0004](../adr/0004-pi-agent-sandbox.md) —— 为什么用 Pi SDK 而不是自建
