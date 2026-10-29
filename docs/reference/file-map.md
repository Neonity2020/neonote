# 文件地图

每个源文件负责什么。改代码前先看这里，能少走弯路。

---

## `packages/shared/`（@neonity/notion-clone-shared）

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `src/index.ts` | 全部共享类型、常量、纯函数 | `BlockType`、`Block`、`PageMeta`、`AppSettings`、`AiApi`、`NotionApi`、`SettingsApi`、`DEFAULT_SETTINGS`、`createTableData`、`tableToText`、`WELCOME_PAGE_TITLE`、`parseWikiLinks`、`replaceWikiLinkTitle`、`lookupPageByTitle` |

> **唯一**被主进程和渲染进程同时 import 的地方。没有副作用，没有依赖。

---

## `src/main/`（主进程）

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `index.ts` | 入口：窗口创建、协议注册、IPC 路由、启动流程 | — |
| `db.ts` | 全部 SQLite 读写。**唯一的数据出口** | `initDb`、`listPages`、`createPage`、`updatePage`、`deletePage`、`movePage`、`resetWelcomePage`、`listBlocks`、`createBlock`、`updateBlock`、`deleteBlock`、`reorderBlocks`、`search`、`getPageLinks`、`listImageAssetIds`、`loadSettingsRaw`、`saveSettingsSection`、`clearSettings`、`countRows` |
| `assets.ts` | 图片存取、扩展名映射、GC、`nc-asset://` 协议实现 | `ASSET_SCHEME`、`MIME_BY_EXT`、`getAssetsDir`、`saveImage`、`pickImage`、`gcAssets` |
| `settings.ts` | 设置校验、落库、广播、AppInfo | `sanitize`、`getSettings`、`updateSettings`、`resetSettings`、`getAppInfo`、`onSettingsChanged`、`registerSettings` |
| `ai.ts` | Pi agent 会话、7 个笔记工具、事件转发、上下文注入 | `registerAi` |

### `index.ts` 里的关键点

- `resolvedTheme()` —— 读设置算当前主题，用作窗口底色（防闪白）。
- `registerAssetProtocol()` —— `protocol.handle('nc-asset', ...)`。
- `registerIpc()` —— 所有业务通道的 `ipcMain.handle` 集中在这里。
- `app.whenReady()` —— 固定的启动顺序：db → gc → protocol → ipc → settings → window → ai。

---

## `src/preload/`

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 通过 `contextBridge` 暴露 `api`、`ai`、`settings` 三个对象 |

**手写转发**，每个通道一行。新增能力时**必须**在这里加，否则渲染层调不到。

---

## `packages/renderer/`（@neonity/notion-clone-ui）

### 入口与外壳

| 文件 | 职责 |
| --- | --- |
| `src/main.tsx` | React 挂载，引入 `index.css`（应用启动入口） |
| `src/index.ts` | npm 发布入口：导出 `App`、两个 store、主要组件 |
| `src/App.tsx` | 应用外壳：主题分发、CSS 变量下发、AI 变更订阅、面板开关 |
| `src/index.css` | CSS 变量、编辑器专用样式、滚动条 |

### 状态

| 文件 | 职责 |
| --- | --- |
| `store.ts` | 笔记状态：页面、块、块级操作、400ms 防抖落库、链接版本号 |
| `settingsStore.ts` | 设置状态：读、改、重置 |

### 工具

| 文件 | 职责 |
| --- | --- |
| `lib/utils.ts` | `cn()`（clsx + tailwind-merge） |
| `lib/caret.ts` | 光标偏移计算、焦点注册表、待处理焦点/单元格焦点/滚动请求 |
| `lib/blockTypes.ts` | 14 种块的元数据、过滤、占位提示 |
| `lib/wikiLink.ts` | 双链装饰器（把 `[[标题]]` 包成可点击 span）、`[[` 触发点查找、链接插入 |

### 组件

| 文件 | 职责 |
| --- | --- |
| `Sidebar.tsx` | 页面树：搜索、折叠、拖拽改层级、重命名、删除菜单 |
| `Editor.tsx` | 编辑器外壳：标题、图标、斜杠菜单状态、拖拽排序上下文、有序列表编号 |
| `BlockItem.tsx` | 单个块的渲染 + 全部键盘行为（拆分/合并/导航/粘贴/Markdown 前缀） |
| `TableBlock.tsx` | 表格：单元格编辑、键盘导航、增删行列工具条 |
| `DatabaseBlock.tsx` | 数据库：属性定义、记录编辑、搜索与排序 |
| `ImageBlock.tsx` | 图片：选择、删除、导航 |
| `SlashMenu.tsx` | 斜杠命令菜单（纯展示） |
| `LinkPicker.tsx` | 双链页面选择器（`[[` 触发，含「新建页面」项） |
| `LinkPanel.tsx` | 页面底部的双向链接面板（反链 + 出链） |
| `EmojiPicker.tsx` | 页面图标选择器（64 个 emoji） |
| `AssistantPanel.tsx` | AI 对话面板：消息流、工具徽标、思考过程、发送/中断 |
| `SettingsPanel.tsx` | 设置弹窗：外观 / AI / 数据 / 关于 四个分区 |

### UI 基础组件（shadcn/ui 风格）

| 文件 | 依赖 |
| --- | --- |
| `ui/button.tsx` | `@radix-ui/react-slot`、`class-variance-authority` |
| `ui/input.tsx` | — |
| `ui/separator.tsx` | `@radix-ui/react-separator` |
| `ui/dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` |
| `ui/tooltip.tsx` | `@radix-ui/react-tooltip` |

---

## 配置与脚本

| 文件 | 职责 |
| --- | --- |
| `electron.vite.config.ts` | 三段构建配置、renderer root 指向 `packages/renderer`、路径别名、外部化策略 |
| `packages/renderer/tailwind.config.js` | 语义色 token、圆角、`darkMode: ['class']` |
| `packages/renderer/postcss.config.js` | PostCSS 插件：tailwindcss（显式指向包内 tailwind 配置）+ autoprefixer |
| `tsconfig.json`（根） | 主进程/preload 的严格模式类型检查 |
| `packages/renderer/tsconfig.json` | 渲染进程类型检查，`@/*` 别名 |
| `packages/shared/tsconfig.json` | shared 包类型检查 |
| `package.json` | workspaces、脚本、依赖、electron-builder 配置 |
| `build/entitlements.mac.plist` | macOS 签名权限（JIT 等） |
| `build/entitlements.mac.inherit.plist` | 辅助进程的继承权限 |
| `scripts/sign-mac.js` | electron-builder `afterPack` 钩子，做 macOS 签名 |
| `scripts/check-docs.mjs` | 文档内部链接与锚点校验 |

---

## 按"我想改 X"查

| 我想改… | 去这些文件 |
| --- | --- |
| 加一种块类型 | shared 包 → `renderer/lib/blockTypes.ts` → `renderer/components/BlockItem.tsx` → `main/ai.ts`；有专门视图的块（如表格、数据库）还要加自己的组件 |
| 改数据库块行为 | `renderer/components/DatabaseBlock.tsx` |
| 改块的编辑行为 | `renderer/components/BlockItem.tsx` |
| 改表格行为 | `renderer/components/TableBlock.tsx` |
| 改侧边栏拖拽 | `renderer/components/Sidebar.tsx`（落点算法在 `updatePreview`） |
| 改数据库结构 | `main/db.ts`（注意**没有迁移机制**，见数据模型文档） |
| 改搜索逻辑 | `main/db.ts` 的 `search()` |
| 改 AI 工具 | `main/ai.ts` 的 `buildNotesTools()` + 系统提示词常量 |
| 改 AI 上下文注入 | `main/ai.ts` 的 `renderContext()` / `contextKey()` |
| 改设置校验 | `main/settings.ts` 的 `sanitize()` |
| 改设置界面 | `renderer/components/SettingsPanel.tsx` |
| 改主题配色 | `renderer/src/index.css` 的 CSS 变量 |
| 改 AI 模型解析 | `main/ai.ts` 的 `resolveModel()` / `ensureRuntime()` |
| 改图片存储 | `main/assets.ts` |
| 改打包配置 | `package.json` 的 `build` 字段 |

---

## 相关文档

- [架构总览](../architecture/overview.md) —— 分层与数据流
- [IPC 通道表](ipc-channels.md) —— 通道速查
- [类型参考](types.md) —— 共享类型
