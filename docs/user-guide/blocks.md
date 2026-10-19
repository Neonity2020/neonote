# 块类型参考

共 12 种块类型。类型定义在 `packages/shared/src/index.ts:1`，渲染逻辑在
`packages/renderer/src/components/BlockItem.tsx:311`。

---

## 总览

| 类型 | 显示名 | 说明 | 有文本 | 占位提示 |
| --- | --- | --- | --- | --- |
| `paragraph` | 正文 | 普通段落 | ✅ | 输入正文,按 '/' 唤起命令菜单 |
| `heading1` | 标题 1 | 28px 粗体 | ✅ | 标题 1 |
| `heading2` | 标题 2 | 22px 半粗 | ✅ | 标题 2 |
| `heading3` | 标题 3 | 18px 半粗 | ✅ | 标题 3 |
| `bulletedList` | 无序列表 | `•` 项目符号 | ✅ | 列表项 |
| `numberedList` | 有序列表 | 自动编号 | ✅ | 列表项 |
| `todo` | 待办事项 | 可勾选复选框 | ✅ | 待办事项 |
| `quote` | 引用 | 左侧 3px 竖线 | ✅ | 引用 |
| `code` | 代码块 | 等宽字体 textarea | ✅ | 代码… |
| `divider` | 分割线 | 水平线 | ❌ | — |
| `image` | 图片 | 本地图片 | ❌ | — |
| `table` | 表格 | 行列数据 | ✅（摘要） | — |

---

## 各类详解

### 正文 `paragraph`

默认类型。新建页面时自动附带一个空正文块（`src/main/db.ts:141`）。

只有正文块会响应 Markdown 快捷输入（见下方对照表）。

### 标题 `heading1` / `heading2` / `heading3`

字号依次为 28 / 22 / 18px。标题不参与自动编号计算。

### 无序列表 `bulletedList` / 有序列表 `numberedList`

- 渲染为「符号 + 文本」两列布局。
- 按 Enter 拆分时**继承列表类型**。
- 空列表项按 Enter **退回正文**。
- 有序列表序号由渲染时计算，插入其他块会打断序列。

### 待办事项 `todo`

- 左侧是原生 `checkbox`，`checked` 状态存在 `content.checked`。
- 勾选后文字加**删除线**并变灰。
- 按 Enter 拆分时继承待办类型，新块 `checked` 为 `false`。
- 空待办按 Enter 退回正文。

### 引用 `quote`

左侧 3px 竖线 + 内边距，文字样式与正文一致。

### 代码块 `code`

- 用 `textarea` 而非 `contentEditable`，**保留换行**。
- 字体等宽 13px，行高 24px，高度随行数自动增长。
- `Tab` 插入**两个空格**（而不是切换焦点）。
- `Esc` 或 `Ctrl/Cmd + Enter` 跳出代码块，在下方新建正文块。
- 空代码块按 `Backspace` 删除该块。
- 代码块内的文本**不参与** Markdown 快捷输入。

### 分割线 `divider`

- 不可编辑，只有一条 1px 细线。
- 按 `Backspace` / `Delete` 删除自身。
- 按 `Enter` 在下方插入正文块。
- 因为没有文本，**上一块无法与它合并**（Backspace 会删除它而不是合并）。

### 图片 `image`

详见 [图片与表格](media-and-tables.md)。

### 表格 `table`

详见 [图片与表格](media-and-tables.md)。

---

## Markdown 快捷输入

在**正文块**中输入以下前缀，会立即转换成对应类型并清空前缀：

| 输入 | 转换结果 |
| --- | --- |
| `# ` | 标题 1 |
| `## ` | 标题 2 |
| `### ` | 标题 3 |
| `- ` 或 `* ` | 无序列表 |
| `1. `（任意数字 + `. `） | 有序列表 |
| `[] ` 或 `[ ] ` | 待办事项 |
| `> ` | 引用 |
| ` ``` ` | 代码块 |
| `---` | 分割线 |

规则细节：

- 只在 `paragraph` 类型上生效，**已经是列表的块再输入 `# ` 不会变成标题**。
- 转换分割线（`---`）时会**额外插入一个正文块**在下方，光标落在那里。
- 待办转换会重置 `checked` 为 `false`。
- 其他转换只改类型并清空文本，块内原有的其他 `content` 字段保留。

> 前缀的判定基于**整块文本精确匹配**（`matchMarkdown`，`packages/renderer/src/components/BlockItem.tsx:21`），
> 所以 `1. ` 必须有空格，`#` 后面没有空格不触发。

---

## 类型转换规则

通过斜杠菜单切换类型时（`setBlockType`，`packages/renderer/src/store.ts:173`）：

| 转换 | 副作用 |
| --- | --- |
| → `divider` | 清空 `content.text` |
| → 非 `todo` | 删除 `content.checked` |
| → `table` | 若原无 `table` 数据，生成 3×3 默认表格并同步写入 `text` 摘要 |
| 从 `table` 转走 | **保留** `content.table` 数据，方便再转回来 |
| 其他 | 保留原有 `content` 字段 |

---

## 斜杠命令菜单

在任意文本块输入 `/` 唤起。

- 菜单项按**名称、描述、关键词**三者匹配过滤（`packages/renderer/src/lib/blockTypes.tsx:45`）。
- 关键词包含中英文与拼音首字母，例如 `表格` 块可被 `biaoge` / `bg` / `table` 命中。
- `↑` / `↓` 移动选中项，`Enter` 应用，`Esc` 关闭。
- 用鼠标点击时用 `onMouseDown` + `preventDefault()`，避免先触发 blur 丢失光标。
- 选中**表格**时，块会先初始化为默认表格，光标自动落到第一个单元格。

---

## 相关文档

- [块编辑器](editor.md) —— 输入、拆分、合并、拖拽
- [图片与表格](media-and-tables.md) —— 图片与表格块的详细操作
- [块类型参考](../reference/types.md#块类型) —— 类型定义原文
