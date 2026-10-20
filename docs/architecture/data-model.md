# 数据模型

数据全部存在**本机一个 SQLite 文件**里。数据库位置见 [快速开始](../getting-started/index.md#数据存放位置)。

驱动是 Node 内置的 `node:sqlite`（`DatabaseSync`），**同步 API**，没有连接池概念。

---

## 表结构

数据库初始化在 `src/main/db.ts:43`。

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pages (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  icon       TEXT,
  parent_id  TEXT REFERENCES pages(id) ON DELETE CASCADE,
  position   REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  type       TEXT NOT NULL DEFAULT 'paragraph',
  content    TEXT NOT NULL DEFAULT '{}',
  position   REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocks_page  ON blocks(page_id, position);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, position);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 字段说明

| 表 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `pages` | `id` | TEXT PK | UUID v4 |
| | `title` | TEXT | 空字符串表示无标题（**不存占位符**） |
| | `icon` | TEXT | emoji 或 NULL |
| | `parent_id` | TEXT FK | 父页面，自引用，`ON DELETE CASCADE` |
| | `position` | REAL | 同级排序位置 |
| `pages` | `created_at` / `updated_at` | INTEGER | 毫秒时间戳 |
| `blocks` | `id` | TEXT PK | UUID v4 |
| | `page_id` | TEXT FK | 所属页面，`ON DELETE CASCADE` |
| | `type` | TEXT | 13 种块类型之一 |
| | `content` | TEXT | **JSON 字符串**，见下文 |
| `settings` | `key` | TEXT PK | 分区名：`theme` / `editor` / `ai` |
| | `value` | TEXT | JSON 字符串 |

---

## 块内容：`content` 是一段 JSON

`content` 存的是 JSON 文本，解析后形状随块类型变化：

```jsonc
// paragraph / heading* / bulletedList / numberedList / quote / code / divider
{ "text": "内容" }

// todo
{ "text": "任务", "checked": true }

// image
{ "text": "", "src": "nc-asset://asset/9f1c....png" }

// table
{ "text": "列1 | 列2\n值1 | 值2", "table": { "header": true, "rows": [["列1","列2"],["值1","值2"]] } }

// database
{ "text": "名称 | 状态\n待办 | 未开始", "database": { "name": "未命名数据库", "view": "table", "properties": [...], "records": [...] } }
```

**容错**：如果 `content` 解析失败，当作纯文本处理（`{ text: row.content }`），
不会让整个页面读不出来。

**表格与数据库的双写**：`table` 和 `database` 块同时写结构化数据和纯文本摘要。摘要是为了复用
既有的纯文本通道——搜索、AI 上下文、复制粘贴都能直接用，不必为它们单独开一条路。

设计取舍见 [ADR-0003](../adr/0003-json-block-content.md)。

---

## 位置策略

排序**不**用整数序号，而是用浮点数 `position`，步长 `POSITION_STEP = 1024`。

### 插入到末尾

```sql
SELECT MAX(position) AS m FROM blocks WHERE page_id = ?;
-- 新 position = m + 1024
```

### 插入到中间

取**前后邻居的中点**，避免为了插一个节点重写整层：

```ts
if (prev && next) position = (prev.position + next.position) / 2
else if (prev)     position = prev.position + POSITION_STEP
else if (next)     position = next.position - POSITION_STEP
else               position = POSITION_STEP
```

### 整体重排

拖拽结束后整层重写，位置是 `(index + 1) * 1024`（`reorderBlocks`，`src/main/db.ts:432`），
在**单个事务**内完成，失败回滚。

### 为什么用浮点数

| 方案 | 插入中间的成本 | 缺点 |
| --- | --- | --- |
| 整数序号 | 整层重写 | 高频编辑下写放大严重 |
| **浮点中点** | 只写一行 | 长期插在同一个位置会导致精度耗尽 |

精度耗尽的缓解：重排时会归一化到 1024 的倍数。极端情况下（同一位点连续插入上千次）
中点会退化，表现为插入位置不精确——这是浮点排序的固有限制，可接受。

详见 [ADR-0005](../adr/0005-fractional-position-ordering.md)。

---

## 页面树

层级由 `pages.parent_id` 自引用表达。

```sql
SELECT * FROM pages ORDER BY parent_id IS NOT NULL, position;
```

这个排序保证**顶层页面在前**，同层按 `position` 升序。前端再用 `parentId` 把它拼成树
（`buildTree`，`packages/renderer/src/components/Sidebar.tsx:559`）。

### 级联删除

`parent_id` 和 `page_id` 都带 `ON DELETE CASCADE`，且 `PRAGMA foreign_keys = ON` 已开启：

```
删除页面 → 自动删除子页面 → 自动删除所有子页面的块
```

前端在调用删除前会先在内存里算出受影响的页面集合（含后代），
从列表中移除，并在当前页被删时自动跳转。

### 循环保护

数据库层**没有**防止把页面挂到自己的后代下的约束（SQLite 的自引用 FK 不检查这种环）。
校验在两个层次各做一次：

- 渲染层 `isSelfOrDescendant()` —— 拖拽时提前拦下。
- 主进程 `db.isSelfOrDescendant()` —— 最终裁决，抛错拒绝。

---

## 设置表

设置**不**用单行 JSON，而是按分区拆成多行：

```
key          value
theme        "light"
editor       {"fontSize":15,"contentWidth":"standard"}
ai           {"model":null,"autoContext":true,"extraPrompt":""}
```

`theme` 分区的值是**裸字符串**（不是对象），因为 `saveSettingsSection(section, next[section])`
存的就是分区本身的值。读取时 `loadSettingsRaw()` 逐条 `JSON.parse`，
再交给 `sanitize()` 与默认值合并、校验。

每个分区独立读写，解析失败的分区被忽略（回落默认），不影响其他分区。

写入用 UPSERT：

```sql
INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
```

---

## 搜索

搜索**不用 FTS**，而是两个 `LIKE` 查询：

```sql
-- 页面标题，最多 20 条
SELECT id, title, icon FROM pages
WHERE title LIKE ? ORDER BY updated_at DESC LIMIT 20;

-- 块正文，最多 30 条
SELECT b.id, b.page_id, p.title, p.icon,
       json_extract(b.content, '$.text') AS text
FROM blocks b JOIN pages p ON p.id = b.page_id
WHERE json_extract(b.content, '$.text') LIKE ?
ORDER BY b.updated_at DESC LIMIT 30;
```

用 `json_extract` 直接在 SQL 里取出 `content` 的 `text` 字段，
这样**不需要**把全部块读进内存再过滤。

没有全文索引，数据量大时搜索会变慢。详见 [搜索](../user-guide/search.md)。

---

## 双链

**双链没有单独的表。** `[[页面标题]]` 就是块正文里的一段纯文本，
出链和反链都是**查询时解析**出来的。

```
blocks.content.text = "详见 [[计划]] 这一页的排版"
         ↓ 查询时解析
出链:  计划 → pageId
反链:  哪些块的正文里写了 [[本页标题]]
```

### 查询

反链扫描所有含 `[[` 的块，用 `instr(content, '[[') > 0` 过滤：

```sql
SELECT b.id AS block_id, b.page_id, b.content, p.title AS page_title, p.icon AS page_icon
FROM blocks b JOIN pages p ON p.id = b.page_id
WHERE instr(b.content, '[[') > 0
ORDER BY b.updated_at DESC
```

然后在 JS 里解析正文、按标题解析目标页面。同一块里有多条链接指向同一页面时，
**只算一条反链**（用 `some()` 判断）。

### 改名传播

页面改名时，主进程会扫一遍含 `[[` 的块，把指向旧标题的链接改写成新标题，
并返回被改写的块 id（`PageUpdateResult.updatedBlockIds`），
前端据此把受影响的块拉回本地。

标题的匹配**忽略大小写**，与解析规则保持一致：`[[notes]]` 指向标题为「Notes」的页面，
改名时同样会被改写。

**只有旧标题在库里唯一时才改写。** 存在同名页面时，`[[旧标题]]` 究竟指哪一个是不确定的，
贸然改写反而会把链接指错——这种情况下保持原样，由用户自己消歧。

**新标题已被别的页面占用时也不改写**，理由同上：改写后的链接会解析到那个已有页面上。

### 为什么这样设计

正文即索引意味着**链接只有一份真身**，永远不会出现"索引和正文对不上"。
代价是每次查询要现算，对本地 SQLite 来说完全够用。

详见 [ADR-0007](../adr/0007-wiki-links-as-plain-text.md)。

---

## 种子数据

数据库为空时（`pages` 表 count 为 0），自动创建一个欢迎页并写入 **16 个示例块**，
覆盖 13 种块类型中的 10 种（不含 `heading3`、`image` 与 `database`）。

**恢复示例内容**（`resetWelcomePage`）会：

1. 按标题找到欢迎页（取创建时间最早的一个）。
2. 在**单个事务**内删除该页所有块、重新插入种子块。
3. 页面本身的 id、标题、图标保持不变。

---

## 演进与迁移

**当前没有迁移机制。** 建表语句全部是 `CREATE TABLE IF NOT EXISTS`，
启动时不会改动已存在的表。

要加字段，只能：

1. 手动 `ALTER TABLE`（对每个用户的手动步骤，不现实），或
2. 引入一个 `schema_version` 表 + 版本化迁移函数，或
3. 删库重建（会丢数据）。

**新增功能时的建议**：优先**扩展 `content` 的 JSON 形状**而不是加列——
`content` 已经是 JSON，加字段不需要改表结构，旧数据读出来时该字段为 `undefined` 即可。

> 升级到不兼容的 schema 时，目前需要用户手动删除数据目录。
> 如果要支持自动升级，需要先补上版本表与迁移框架。

---

## 相关文档

- [架构总览](overview.md) —— 进程模型与数据流
- [状态管理](state-management.md) —— 前端如何与数据库保持一致
- [资源管线](assets.md) —— 图片文件与数据库引用的关系
- [ADR-0001](../adr/0001-local-first-sqlite.md) —— 为什么用本地 SQLite
- [ADR-0003](../adr/0003-json-block-content.md) —— 为什么 content 用 JSON
- [ADR-0005](../adr/0005-fractional-position-ordering.md) —— 为什么要浮点位置
- [ADR-0007](../adr/0007-wiki-links-as-plain-text.md) —— 为什么双链没有单独的表
- [双链（Wiki Link）](../user-guide/links.md) —— `[[]]` 语法与反向链接
