# Notion Clone

> 本地优先的块笔记应用 —— 所有数据保存在本机 SQLite 数据库中，不上传任何服务器。

Electron + Vite + React + shadcn/ui + SQLite 构建的桌面块编辑器，
带页面树、拖拽排序、全文搜索、表格、图片，以及一个能直接读写笔记的 AI 助手。

📖 **完整文档见 [`docs/`](docs/README.md)**

---

## 快速开始

```bash
npm install
npm run dev
```

首次启动会自动创建一个「欢迎使用 Notion Clone」示例页面。

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式（热更新） |
| `npm run build` | 构建产物到 `out/` |
| `npm start` | 预览构建产物 |
| `npm run dist` | 打包 Windows 安装包 |
| `npm run dist:mac` | 打包 macOS DMG |
| `npm run docs:check` | 校验文档内部链接与锚点 |

环境要求：Node.js 20+。不需要单独安装 SQLite。

---

## 功能

- **块编辑器** —— 12 种块类型，斜杠命令菜单，Markdown 快捷输入（`# `、`- `、`[] `…）
- **页面树** —— 无限层级，拖拽同时支持排序和改变父子关系
- **表格** —— 纯文本行列数据，键盘导航，可被搜索和 AI 读取
- **图片** —— 本地存储，任意文本块 `Ctrl+V` 直接粘贴
- **全文搜索** —— 同时匹配页面标题与块正文
- **AI 助手** —— 复用本机 `~/.pi/agent` 的模型配置，能直接读写笔记
- **主题与外观** —— 浅色 / 深色 / 跟随系统，字号与内容宽度可调

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 主进程 | Electron 39、Node 内置 `node:sqlite` |
| 预加载 | `contextBridge` 白名单桥接 |
| 渲染进程 | React 18、TypeScript、Tailwind CSS、zustand、dnd-kit、Radix UI |
| AI | `@earendil-works/pi-coding-agent`（Pi SDK） |

---

## 数据存放位置

```
<userData>/notion-clone/
├── notion-clone.db      # 页面、块、设置
└── assets/              # 图片资源
```

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\notion-clone` |
| macOS | `~/Library/Application Support/notion-clone` |
| Linux | `~/.config/notion-clone` |

备份 = 复制整个目录。

---

## 文档

| 入口 | 内容 |
| --- | --- |
| [快速开始](docs/getting-started/index.md) | 安装、运行、打包 |
| [功能巡览](docs/getting-started/quick-tour.md) | 5 分钟走一遍 |
| [用户指南](docs/user-guide/editor.md) | 编辑器、页面、搜索、表格、AI、快捷键 |
| [架构总览](docs/architecture/overview.md) | 进程模型、数据流、分层 |
| [数据模型](docs/architecture/data-model.md) | SQLite 表结构与位置策略 |
| [开发环境](docs/development/setup.md) | 目录结构、调试、扩展指引 |
| [ADR 索引](docs/adr/README.md) | 架构决策记录 |

📚 **[文档总览 →](docs/README.md)**

---

## 许可

私有项目，版权归作者所有。
