# Notion Clone 文档

> 本地优先的块笔记应用 · Electron + Vite + React + SQLite
> 所有数据保存在本机，不上传任何服务器。

本目录是项目的**唯一权威文档源**。文档全部以 `docs/` 为根，使用相对链接，任何 Markdown 阅读器
（VS Code、GitHub、Typora）都能直接打开，无需构建工具。

---

## 快速导航

### 🚀 第一次接触

| 文档 | 内容 |
| --- | --- |
| [快速开始](getting-started/index.md) | 环境要求、安装、启动、打包、数据存放位置 |
| [功能巡览](getting-started/quick-tour.md) | 5 分钟走一遍编辑器、页面树、搜索、AI 助手 |

### 📖 用户指南

面向最终使用者，描述每个功能"怎么用"。

| 文档 | 内容 |
| --- | --- |
| [块编辑器](user-guide/editor.md) | 输入、拆分、合并、拖拽、保存机制 |
| [块类型参考](user-guide/blocks.md) | 12 种块类型 + Markdown 快捷输入对照 |
| [页面与层级](user-guide/pages.md) | 页面树、拖拽改层级、折叠、删除级联 |
| [搜索](user-guide/search.md) | 匹配范围、结果规则、命中上限 |
| [图片与表格](user-guide/media-and-tables.md) | 图片插入/粘贴、表格编辑与导航 |
| [双链](user-guide/links.md) | `[[页面]]` 语法、反向链接面板、改名传播 |
| [AI 助手](user-guide/ai-assistant.md) | 模型选择、页面上下文、工具能力 |
| [设置](user-guide/settings.md) | 外观 / AI 助手 / 数据与存储 / 关于 |
| [快捷键速查](user-guide/shortcuts.md) | 全部键盘操作一览 |

### 🏗️ 架构

面向开发者，解释系统"怎么搭的"。

| 文档 | 内容 |
| --- | --- |
| [架构总览](architecture/overview.md) | 三进程模型、分层、数据流全景 |
| [数据模型](architecture/data-model.md) | SQLite 表结构、位置策略、级联删除 |
| [IPC 桥接](architecture/ipc-bridge.md) | preload 白名单桥接、通道设计约定 |
| [状态管理](architecture/state-management.md) | 两个 zustand store 与防抖落库 |
| [资源管线](architecture/assets.md) | 图片存储、`nc-asset://` 协议、GC |

### 🤖 AI 集成

| 文档 | 内容 |
| --- | --- |
| [Pi SDK 集成](ai/integration.md) | 会话生命周期、模型解析、设置联动 |
| [笔记工具集](ai/tools.md) | 7 个 `notes_*` 工具的参数与语义 |
| [AI 排障](ai/troubleshooting.md) | 无可用模型、孤儿锁、上下文异常 |

### 🛠️ 开发

| 文档 | 内容 |
| --- | --- |
| [开发环境](development/setup.md) | 目录结构、脚本、调试技巧 |
| [样式与主题](development/styling.md) | Tailwind token、CSS 变量、深色模式 |
| [构建与发布](development/build-and-release.md) | 三段式构建、macOS 签名、Windows NSIS |
| [贡献指南](development/contributing.md) | 提交规范、文档维护要求 |

### 📚 参考

| 文档 | 内容 |
| --- | --- |
| [类型参考](reference/types.md) | shared 包（`@neonity/notion-clone-shared`）全量类型说明 |
| [IPC 通道表](reference/ipc-channels.md) | 所有通道、参数、返回值一览 |
| [文件地图](reference/file-map.md) | 每个源文件负责什么 |

### 📐 架构决策记录（ADR）

记录"为什么这样设计"，避免后来者推翻已有决策。
索引与模板见 [adr/README.md](adr/README.md)。

| 编号 | 决策 |
| --- | --- |
| [0001](adr/0001-local-first-sqlite.md) | 本地优先：SQLite 单文件存储 |
| [0002](adr/0002-electron-vite-three-process.md) | Electron + electron-vite 三进程结构 |
| [0003](adr/0003-json-block-content.md) | 块内容以 JSON 文本存储 |
| [0004](adr/0004-pi-agent-sandbox.md) | AI 走 Pi SDK 并禁用内置工具 |
| [0005](adr/0005-fractional-position-ordering.md) | 分数位置排序（position） |
| [0006](adr/0006-extract-renderer-package.md) | 前端抽取为可发布的 npm 包 |
| [0007](adr/0007-wiki-links-as-plain-text.md) | 双链以纯文本形式存在于正文 |

---

## 文档约定

为了让文档保持可信、可维护，全目录遵循以下约定：

- **语言**：简体中文，与界面文案保持一致。（代码注释统一用英文，文档统一用中文。）
- **代码引用**：一律标注 `文件路径:行号`，可直接点击跳转，例如 `src/main/db.ts:157`。
- **不臆造**：文档描述的行为必须能在代码里找到出处。行为变更时，**代码与文档同一次提交更新**。
- **面向对象分层**：
  - `user-guide/` 只讲用户能感知到的行为，不出现内部类名；
  - `architecture/`、`ai/`、`development/` 才涉及实现细节；
  - `reference/` 是查表用的速查表，不做长篇解释。
- **ADR 不可改写**：已接受的 ADR 只能被新的 ADR 取代，不能原地修改。

## 本地校验

```bash
npm run docs:check
```

校验全部 Markdown 内部链接与锚点是否存在，以及相对路径是否可解析。提交前请运行。
校验脚本说明见 [development/contributing.md](development/contributing.md#文档校验)。

## 文档地图

```
docs/
├── README.md                    # 你在这里：导航中心
├── getting-started/             # 入门
│   ├── index.md
│   └── quick-tour.md
├── user-guide/                  # 用户指南
│   ├── editor.md
│   ├── blocks.md
│   ├── pages.md
│   ├── search.md
│   ├── media-and-tables.md
│   ├── links.md
│   ├── ai-assistant.md
│   ├── settings.md
│   └── shortcuts.md
├── architecture/                # 架构
│   ├── overview.md
│   ├── data-model.md
│   ├── ipc-bridge.md
│   ├── state-management.md
│   └── assets.md
├── ai/                          # AI 集成
│   ├── integration.md
│   ├── tools.md
│   └── troubleshooting.md
├── development/                 # 开发
│   ├── setup.md
│   ├── styling.md
│   ├── build-and-release.md
│   └── contributing.md
├── reference/                   # 参考
│   ├── types.md
│   ├── ipc-channels.md
│   └── file-map.md
└── adr/                         # 架构决策记录
    ├── README.md
    ├── 0001-local-first-sqlite.md
    ├── 0002-electron-vite-three-process.md
    ├── 0003-json-block-content.md
    ├── 0004-pi-agent-sandbox.md
    ├── 0005-fractional-position-ordering.md
    ├── 0006-extract-renderer-package.md
    └── 0007-wiki-links-as-plain-text.md
```
