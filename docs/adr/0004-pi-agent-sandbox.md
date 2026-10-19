# ADR-0004：AI 走 Pi SDK 并禁用内置工具

- **状态**：已接受
- **日期**：2026-10-14
- **相关**：[ADR-0002](0002-electron-vite-three-process.md)

---

## 背景

应用要有一个 AI 助手，能**读写用户的笔记**——不只是回答问题，
而是"帮我在当前页面写一份周计划"然后真的把内容写进笔记。

需求：

1. 支持多种模型提供商。
2. **不自己管理 API Key**——用户已经有一套本机的模型配置。
3. AI 的能力边界必须**明确受限**：它只能操作笔记，不能碰文件系统、不能执行命令。
4. AI 操作笔记后，界面要**立即同步**。
5. AI 要能看到当前页面，省掉一次"找页面"调用。

---

## 决策

用 **Pi SDK**（`@earendil-works/pi-coding-agent`）在**主进程**内运行 agent 会话，
复用用户本机 `~/.pi/agent` 的模型目录与认证配置。

关键配置：

```ts
const { session } = await sdk.createAgentSession({
  modelRuntime,
  resourceLoader,
  sessionManager: sdk.SessionManager.inMemory(),
  ...(model ? { model } : {}),
  noTools: 'builtin',              // ← 禁用全部内置工具
  customTools: buildNotesTools(Type)  // ← 只暴露 7 个笔记工具
})
```

资源加载全部关闭：

```ts
new sdk.DefaultResourceLoader({
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  appendSystemPromptOverride: () => []
})
```

配套决策：

- **会话在主进程**，不在渲染进程。
- **对话历史在内存**（`SessionManager.inMemory()`），不落盘。
- **只暴露 7 个 `notes_*` 工具**，禁止 Pi 内置的 `read`/`bash`/`edit`/`write`。
- **写操作后广播** `ai:notes-changed`，前端重新加载。
- **自动附带当前页面上下文**，用指纹去重避免重复注入。

---

## 理由

### 为什么复用 Pi 而不是自己接模型 API

自己接 SDK 意味着：

- 要自己实现多提供商的鉴权、流式、重试、工具调用协议。
- 用户要**在应用里重新配置一遍** API Key。

复用 Pi 的收益：

- 用户本机已有的模型配置**直接可用**，零配置成本。
- 多提供商、推理模型、上下文窗口这些信息 Pi 已经处理好。
- Pi 已经有成熟的 agent 会话抽象（事件流、工具调用、模型切换）。

代价是引入了对 Pi SDK 的依赖，SDK 升级可能带来 breaking change。

### 为什么 `noTools: 'builtin'` 是必须的

Pi 默认带 `read`、`bash`、`edit`、`write` 等通用工具。
**这些工具对笔记应用是危险的**：

- `bash` 能执行任意命令。
- `read` / `write` 能读写任意文件——包括用户的私钥、其他项目源码。
- 一个被提示词注入的网页内容可能诱导模型调用这些工具。

AI 助手的价值在于"操作笔记"，**不在于"操作电脑"**。
给它超出职责范围的能力，用户不会知道发生了什么。

`noTools: 'builtin'` + 只挂 `notes_*` 工具，从**能力层面**限制了它，
而不是靠提示词请求模型"请不要用 bash"——提示词约束不可靠，能力约束才可靠。

### 为什么资源加载全部关闭

Pi 的 `DefaultResourceLoader` 默认会加载用户 pi CLI 的：

- 扩展（extensions）
- 技能（skills）
- 提示词模板（prompt templates）
- 上下文文件（`AGENTS.md` 之类的项目上下文）

这些是**给 pi CLI 用的**，和本应用的场景无关。加载它们会：

- 引入不可预测的行为（用户某次写的 skill 可能改变 AI 的行为）。
- 泄漏用户的项目上下文到笔记助手的会话里。
- 增加启动开销。

`appendSystemPromptOverride: () => []` 额外屏蔽 `APPEND_SYSTEM.md` 这类附加提示词。

### 为什么会话在主进程

1. **主进程有 Node 能力**——Pi SDK 需要访问文件系统读 `~/.pi/agent`。
   渲染进程没有这个能力。
2. **工具直接调数据库**——`notes_*` 工具的 `execute()` 直接调 `db.*`，
   没有额外 IPC 往返。
3. **凭据不经过渲染层**——API Key 只在主进程和 Pi SDK 之间流动。

### 为什么对话历史不落盘

对话内容可能包含用户的笔记片段。落盘意味着：

- 多一份需要备份和清理的数据。
- 可能被同步工具带去别处。

而"关掉应用对话就没了"这个行为对笔记助手来说完全合理——
它是**工具**，不是聊天记录存档。

### 为什么自动附带当前页面

用户问"帮我整理这页"，如果 AI 还得自己 `notes_list_pages` 找页面、
再 `notes_read_page` 读内容，一轮要多两次工具调用，延迟明显变长。

自动附带上下文后，AI 直接就有块 id，可以一步到位。

**指纹去重**是关键：上下文不变就不重复注入，否则多轮对话里
会堆叠同一份内容，白白消耗 token 和上下文窗口。

### 为什么写操作后要广播

AI 通过主进程直接改数据库，渲染层**不知道**。如果不同步，
用户会看到"AI 说改好了，但页面没变"。

广播机制：

```
AI 调用写工具 → 主进程发 ai:notes-changed → 前端 refreshFromAi()
```

`refreshFromAi()` 里**先 `flushSaves()`** 再重读——顺序很重要，
否则前端未落库的编辑会被 AI 的改动覆盖。

---

## 后果

### 正面

- 用户零配置就能用上已有的模型凭据。
- AI 的能力边界是**机制保证**的，不是提示词请求。
- 用户的 pi 配置不会渗透进本应用。
- 凭据不经过渲染层。
- AI 改完笔记界面立即同步。

### 负面

- **依赖 Pi SDK**，升级可能带来 breaking change。
- **Pi SDK 是纯 ESM**，主进程是 CJS，必须用动态 `import()` 加载，
  失去了静态导入的类型检查（要用 `typeof import(...)` 手动标注类型）。
- **会话状态在内存里**，应用重启对话就没了。
- **孤儿锁问题**：Pi 用空目录做锁，进程异常退出会留下残留，
  导致之后每次认证读取都失败。需要专门的清理逻辑
  （见 [AI 排障](../ai/troubleshooting.md)）。
- **模型快照会被永久缓存**：创建时刷新失败会导致快照永久为空，
  需要 `ensureRuntime()` 在快照为空时强制刷新。
- AI 仍然会**犯错**——比如用过期块 id、误删内容。
  系统提示词要求它删除前确认，但这是提示词层的约束，不是机制保证。

### 后续影响

- 工具 schema 和 `BlockType` **必须同步维护**——加块类型时忘了加进
  `buildNotesTools()` 的枚举，AI 就无法创建这种块。
- 错误信息必须**本地化**。SDK 抛的是英文异常，
  直接透传给用户等于让用户去读英文报错栈。
- 若将来支持别的 agent 框架，工具层（`notes_*`）可以复用——
  它们只依赖 `db.*`，不依赖 Pi。

---

## 相关文档

- [Pi SDK 集成](../ai/integration.md)
- [笔记工具集](../ai/tools.md)
- [AI 排障](../ai/troubleshooting.md)
