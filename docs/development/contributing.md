# 贡献指南

---

## 提交前

```bash
npm run build        # 确认能构建
npx tsc --noEmit     # 确认没有类型错误
npm run docs:check   # 确认文档链接没坏
```

项目**没有**配置 ESLint / Prettier。代码风格靠人工保持一致：

| 项 | 规范 |
| --- | --- |
| 缩进 | 2 空格 |
| 分号 | 无 |
| 引号 | 单引号 |
| 尾随逗号 | 多行结构加 |
| 命名 | 组件用 PascalCase，函数/变量用 camelCase，常量用 SCREAMING_SNAKE |

---

## 提交信息

用中文，遵循 Conventional Commits 的类型前缀：

```
feat: 支持插入简单表格
fix: 修复切页时未落库编辑丢失
refactor: 抽出光标工具到 lib/caret.ts
docs: 补充数据模型文档
build: 接入 electron-builder 打包 Windows NSIS 安装器
chore: 升级依赖
```

现有提交历史可以参考：

```
a1fbb5d feat: 支持插入简单表格
74321b2 feat: 侧边栏支持拖拽排序与调整页面层级
4b139eb feat: AI 助手与设置系统
b949fc4 build: 接入 electron-builder 打包 Windows NSIS 安装器
66058b5 feat: 支持恢复欢迎页面示例内容
9883e2a feat: Notion Clone 本地优先块笔记应用
```

---

## 改动的边界

### 分层约束

改动前先确认自己在正确的层（详见 [开发环境](setup.md#架构约束)）：

- **渲染进程禁止** import `node:` 模块、禁止直接访问文件系统。
- **主进程**只做数据与业务，不持有 UI 状态。
- **shared 包（`@neonity/notion-clone-shared`）** 不依赖任何一方。

### 加一个块类型要改的地方

这是最容易漏的地方，共 **4 处**：

1. `packages/shared/src/index.ts` —— `BlockType` 联合类型加成员
2. `packages/renderer/src/lib/blockTypes.tsx` —— `BLOCK_TYPE_ITEMS` 加元数据（label / description / keywords / icon）
3. `packages/renderer/src/components/BlockItem.tsx` —— `renderContent()` 加渲染分支
4. `src/main/ai.ts` —— `buildNotesTools()` 里的 `blockTypeSchema` 加枚举

漏掉第 4 处的话，AI 就无法创建这种类型的块。

### 加一个 IPC 能力要改的地方

共 **3 处**，顺序不能少：

1. `packages/shared/src/index.ts` —— 定义类型，挂到对应的 `*Api` 接口
2. `src/main/index.ts` —— `ipcMain.handle()`
3. `src/preload/index.ts` —— 加一行转发

### 加一个设置项要改的地方

1. `packages/shared/src/index.ts` —— `AppSettings` 加字段
2. `src/main/settings.ts` —— **`sanitize()` 里加校验**，否则坏值会直接进库
3. `packages/renderer/src/components/SettingsPanel.tsx` —— 加 UI

`DEFAULT_SETTINGS` 也别忘了更新。

---

## 文档维护

**行为变更时，代码和文档必须同一次提交更新。**

具体来说：

| 改了什么 | 要更新哪份文档 |
| --- | --- |
| 块类型增删 | `user-guide/blocks.md`、`reference/types.md` |
| 快捷键增删 | `user-guide/shortcuts.md` |
| 编辑行为（拆分/合并规则） | `user-guide/editor.md` |
| 数据库结构 | `architecture/data-model.md` |
| IPC 通道增删 | `architecture/ipc-bridge.md`、`reference/ipc-channels.md` |
| AI 工具增删 | `ai/tools.md`、`ai/integration.md` |
| 设置项增删 | `user-guide/settings.md` |
| 架构决策变更 | **新增 ADR**，不要改旧 ADR |

### 文档写法约定

- 中文撰写，与界面文案和代码注释一致。
- 引用代码标注 `文件路径:行号`。
- 不臆造行为——写进去的每一条都要能在代码里找到出处。
- 用户指南不出现内部类名；实现细节放到 `architecture/`、`ai/`、`development/`。

---

## 文档校验

```bash
npm run docs:check
```

校验内容：

1. 所有 Markdown 内部链接指向的文件**存在**。
2. 所有相对路径能正确解析（不越出 `docs/`）。
3. 所有 `#锚点` 在目标文件里**真实存在**。

新增文档后**必须**跑一次。CI 或提交前本地跑都行。

脚本源码：[`scripts/check-docs.mjs`](../../scripts/check-docs.mjs)。

---

## 架构决策记录（ADR）

当一个决定**不显然**、或者未来有人可能会问"为什么这么做"时，写一份 ADR。

写 ADR 的判断标准：

- ✅ "为什么用 SQLite 而不是 IndexedDB？" —— 会有人问，写。
- ✅ "为什么禁用 Pi 的内置工具？" —— 安全边界，必须写。
- ❌ "为什么按钮用 rounded-md？" —— 没人会问，不写。

已接受的 ADR **不能原地修改**。想改变决策就写一份新的，并在新 ADR 里说明它取代了哪一份。

模板和索引见 [adr/README.md](../adr/README.md)。

---

## 相关文档

- [开发环境](setup.md) —— 目录结构与调试
- [架构总览](../architecture/overview.md) —— 分层与数据流
- [adr/README.md](../adr/README.md) —— ADR 规范
