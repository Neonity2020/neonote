# 笔记工具集

AI 能调用的全部工具。共 7 个，分两类：**读**（3 个：`notes_list_pages`、`notes_read_page`、`notes_search`）、
**写**（4 个：`notes_create_page`、`notes_append_blocks`、`notes_update_block`、`notes_delete_block`）。

全部定义在 `src/main/ai.ts:280` 的 `buildNotesTools()`。

---

## 工具清单

| 工具 | 类型 | 一句话 |
| --- | --- | --- |
| `notes_list_pages` | 读 | 列出所有页面 |
| `notes_read_page` | 读 | 读取一个页面的全部块 |
| `notes_search` | 读 | 搜索标题与块正文 |
| `notes_create_page` | 写 | 新建页面 |
| `notes_append_blocks` | 写 | 向页面末尾追加块 |
| `notes_update_block` | 写 | 修改块 |
| `notes_delete_block` | 写 | 删除块 |

**写操作会触发前端刷新**（`ai:notes-changed`），改完笔记界面立刻同步。

---

## 读工具

### `notes_list_pages`

列出所有页面，**不接收参数**。

返回：

```json
[
  { "id": "uuid", "title": "欢迎使用 Notion Clone", "icon": "👋", "parentId": null }
]
```

标题为空时返回「无标题」。

### `notes_read_page`

读取一个页面的全部块。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `pageId` | string | ✅ | 页面 id |

返回：

```json
[
  { "id": "block-uuid", "type": "paragraph", "text": "内容" },
  { "id": "block-uuid", "type": "todo", "text": "任务", "checked": false }
]
```

**只有 `todo` 块带 `checked` 字段**，其他类型不带这个键。
空页面返回字符串 `"(空页面)"` 而不是空数组。

> 表格块的 `text` 是纯文本摘要（每行用 ` | ` 连接），
> 所以 AI 能读到表格内容，但读不到结构化的单元格边界。
> 表格块本身的 `type` 仍是 `table`，AI 可以据此判断。

### `notes_search`

搜索标题与块正文。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | ✅ | 搜索关键词 |

返回 `SearchResult[]`（与用户搜索同一套实现）。没有结果时返回字符串「没有找到匹配的内容」。

---

## 写工具

### `notes_create_page`

新建页面。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | ✅ | 页面标题 |
| `parentId` | string | ❌ | 父页面 id，省略则建顶级页面 |

返回：

```json
{ "id": "new-page-uuid", "title": "标题" }
```

新页面自动带一个空正文块。

### `notes_append_blocks`

向页面**末尾**依次追加多个块。**至少 1 个**（schema 里有 `minItems: 1`）。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `pageId` | string | ✅ | 目标页面 id |
| `blocks` | array | ✅ | 要追加的块数组 |

`blocks` 每一项：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | enum | 应用支持的 14 种块类型里的 11 种（**不含 `image`、`audio` 与 `database`**，见下方说明） |
| `text` | string | 块文本，`divider` 可省略 |
| `checked` | boolean | 仅 `todo` 块：是否勾选 |
| `table` | string[][] | 仅 `table` 块：二维数组，第一行作表头 |

示例：

```json
{
  "pageId": "uuid",
  "blocks": [
    { "type": "heading2", "text": "本周计划" },
    { "type": "todo", "text": "写完周报", "checked": false },
    { "type": "table", "table": [["任务", "负责人"], ["写周报", "我"]] }
  ]
}
```

返回：`"已追加 3 个块"`。

**页面不存在**时返回错误：`页面不存在: <id>`。

**表格会被规范化**成矩形：列数取各行最大值，短行用空字符串补齐，
`header` 固定为 `true`，同时生成纯文本摘要写入 `content.text`。

### `notes_update_block`

修改一个块。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `blockId` | string | ✅ | 块 id |
| `text` | string | ❌ | 新文本 |
| `type` | enum | ❌ | 新类型 |
| `checked` | boolean | ❌ | 仅 `todo`：勾选状态 |
| `table` | string[][] | ❌ | 仅 `table`：**整表替换** |

规则：

- **至少要提供一项**（否则不做任何事）。
- 传 `table` 时**整表替换**（不是增量修改），并重新生成文本摘要。
- 传 `type` 为 `divider` 时会清空 `text`。
- 传 `type` 为 `todo` 但不传 `checked` 时，**保留原有的 checked 状态**。

返回：`"已更新"`。块不存在返回错误：`块不存在: <id>`。

### `notes_delete_block`

删除一个块，**不可恢复**。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `blockId` | string | ✅ | 块 id |

返回：`"已删除"`。块不存在返回错误：`块不存在: <id>`。

> 系统提示词明确要求模型：**删除前先向用户确认**，除非用户已明确表达删除意图。

---

## 为什么 AI 不能插图片

`notes_append_blocks` 的 `type` 枚举里**没有 `image`**。

原因：图片需要走 `saveImage` / `pickImage` 那条二进制通道，涉及文件写入和协议引用，
和"传一段文字创建一个块"是完全不同的操作。工具协议保持简单一致，
不让模型去拼 `nc-asset://` 引用。

AI 可以做的：改文字、改类型、增删块、增删页面。

---

## 系统提示词

工具集的可用性和行为约束来自系统提示词（`src/main/ai.ts:32`）：

```
你是 Notion Clone 笔记应用内置的 AI 助手,使用简体中文回答。

你可以通过工具读写用户的笔记:
- notes_list_pages:列出所有页面(返回 id、标题、图标、父页面)
- notes_read_page:读取一个页面的全部块内容
- notes_search:全文搜索标题与块内容
- notes_create_page:新建页面
- notes_append_blocks:向页面末尾追加块(段落、标题、列表、待办、引用、代码、分割线、表格)
- notes_update_block:修改块的内容、类型或待办勾选状态
- notes_delete_block:删除块

行为准则:
```

后面拼接**上下文准则**（随设置切换）：

开启自动上下文时：

```
- 用户提问时,系统会自动附带"当前页面上下文"(用户正在看的页面 id、标题和块内容),
  里面的块 id 可以直接用于 notes_update_block / notes_delete_block,不必再调 notes_read_page。
- 上下文只是快照,若怀疑内容已变化(比如你自己改动过),先用 notes_read_page 重新读取。
```

关闭时：

```
- 你看不到用户当前打开的页面。要操作页面内容时,先用 notes_list_pages 找到页面,
  再用 notes_read_page 拿到块 id,不要凭空猜测块 id。
```

最后是**通用准则**：

```
- 回答简洁,直接给结果,不要废话。
- 用户让你写东西到笔记里时,直接用工具写入,不要只把内容贴在回复里。
- 修改已有内容前先读取页面,确认块 id,避免误改。
- 删除操作是不可逆的,执行前向用户确认,除非用户已明确表达删除意图。
- 你只能通过工具操作笔记,不要假装能访问文件系统或网络。
```

用户可以在**设置 → AI 助手 → 附加指令**里追加自己的要求，
它会接在通用准则之后。

---

## 工具是怎么被调用的

```
模型请求调用 notes_update_block
  → Pi 执行工具的 execute(params)
  → 工具直接读写数据库（db.updateBlock 等）
  → 返回 { content: [{ type: 'text', text: '已更新' }], details: {} }
  → Pi 把结果回传给模型
  → 模型继续生成最终回答
```

工具是**同步**的——直接调用 `db.*` 函数，没有额外的 IPC 往返。
因为工具就运行在主进程里。

工具返回值有两种形态：

```ts
ok(data)    // 成功：content 数组 + details
fail(message) // 失败：额外带 isError: true
```

`fail` 用于**可预期的业务错误**（页面不存在、块不存在）——
让模型能读到错误并自我纠正，而不是让整个会话崩掉。

---

## 相关文档

- [Pi SDK 集成](integration.md) —— 会话生命周期与模型解析
- [AI 排障](troubleshooting.md) —— 工具不工作时的排查
- [AI 助手](../user-guide/ai-assistant.md) —— 用户视角
