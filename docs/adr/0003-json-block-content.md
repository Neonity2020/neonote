# ADR-0003：块内容以 JSON 文本存储

- **状态**：已接受
- **日期**：2026-10-14

---

## 背景

块是应用的核心数据结构。12 种块类型里，多数只需要文本，
但 `todo` 需要勾选状态、`image` 需要资源引用、`table` 需要二维数据。

数据库里 `blocks.content` 这个字段要能装下所有这些。
同时，搜索、AI 上下文、复制粘贴这几条链路都需要**读块里的纯文本**。

---

## 决策

`blocks.content` 存 **JSON 字符串**（`TEXT NOT NULL DEFAULT '{}'`），
解析后是一个随类型变化的对象：

```ts
export interface BlockContent {
  text?: string
  checked?: boolean
  src?: string
  table?: TableData
}
```

配套三条规则：

1. **解析失败时降级**：JSON 解析出错就把整个字段当纯文本处理
   （`{ text: row.content }`），不让一个坏块读崩整个页面。
2. **表格双写**：`table` 块同时写结构化数据（`content.table`）
   和纯文本摘要（`content.text`）。
3. **扩展优先改 JSON，不加列**。

---

## 理由

### 为什么不用一列 JSON

（这个决策在"是否加独立列"之前就定了。）

JSON 的好处：

- **加字段不用改表结构**。新增块类型只需在 `BlockContent` 里加个可选字段。
- 稀疏：多数块只有 `text`，其他字段是 `undefined`，不占空间。
- 一次读取就能拿到全部内容。

代价是没法直接对某个字段建索引或用 SQL 约束。

### 为什么不用固定列（`text` / `checked` / `src` / `table_data` 四列）

固定列会让每加一种块类型就要改表。而表结构**没有迁移机制**
（见 [ADR-0001](0001-local-first-sqlite.md#后果)），
改表意味着用户必须删库重建。

JSON 把"改表"这个动作推迟到了真正需要的时候——而用 JSON 的话，
很多时候根本不需要。

### 为什么表格要双写

表格的结构化数据是二维数组，**没有天然的纯文本表示**。
但搜索、AI 上下文、复制粘贴这三条链路都想要纯文本。

如果每次要用都现算：

- `notes_read_page` 要把表格转成文本才能返回给模型。
- 搜索要先把所有表格块拉出来转换，才能匹配。
- 复制粘贴要在复制时临时转换。

而**写入时算一次**的成本可以忽略（改一个单元格就重算一次），
换来的是：

- 搜索可以直接用 SQL 的 `json_extract(b.content, '$.text')` 过滤，
  **不用把表读进内存**。这是搜索能用 SQL 实现的前提。
- AI 直接读到表格的文本内容。
- 复制粘贴零成本。

### 为什么用 `json_extract` 而不是把 text 提成独立列

`json_extract` 是 SQLite 内置的 JSON1 扩展，能在 SQL 里直接取 JSON 字段：

```sql
WHERE json_extract(b.content, '$.text') LIKE ?
```

这让搜索保持纯 SQL，不需要"先查出来再在 JS 里过滤"。
代价是全表扫描（JSON 提取没法走索引），但有 `LIMIT 30` 兜着。

### 为什么不把 `text` 提成独立列

`text` 是 90% 块都在用的字段，提成独立列确实能建索引。
但这样 `content` 里的 `text` 和列就**重复**了，产生了"两个真相来源"的问题。

现在的做法是：`text` 住在 JSON 里，SQL 用 `json_extract` 读它。
单一真相来源，代价是搜索不能走索引——数据量不大时可以接受。

---

## 后果

### 正面

- 加块类型、加字段**不需要改表结构**。
- 坏数据不会让页面读不出来（解析失败降级为纯文本）。
- 搜索保持纯 SQL。
- 表格能复用所有纯文本通道。

### 负面

- **JSON 提取不能走索引**，搜索是全表扫描。数据量大时会变慢。
  届时可以引入 FTS5 虚拟表。
- **JSON 里的字段没有类型约束**，写坏了只能靠应用层校验。
- **双写存在不一致风险**：如果只改了 `table` 没同步 `text`，搜索和 AI 就会看到旧摘要。
  目前所有表格修改路径都走 `commit()` 统一更新两个字段，规避了这个风险，
  但这是一个**需要维护的约定**，不是机制保证。
- 代码里到处是 `?? ''` 这样的空值兜底。

### 后续影响

- **新增字段时**，在 `BlockContent` 加可选字段即可，不用碰 DDL。
  但要记得同步更新这些地方：
  - `renderer/store.ts` 的 `setBlockType()` —— 类型转换时的字段清理
  - `main/ai.ts` 的 `buildNotesTools()` —— 工具的 schema
  - `renderer/lib/blockTypes.tsx` —— 块类型元数据
- **JSON1 扩展**是 SQLite 3.38+ 内置的。Electron 39 的 Node 22 捆绑的 SQLite 版本足够新，
  但如果将来降级 Electron，需要验证 `json_extract` 仍可用。
- 将来若要做全文搜索，**不要**给 `content.text` 加索引——正确做法是引入 FTS5 虚拟表，
  用触发器同步。

---

## 相关文档

- [数据模型](../architecture/data-model.md#块内容content-是一段-json)
- [类型参考](../reference/types.md)
- [ADR-0001](0001-local-first-sqlite.md)
