# 快速开始

本文档覆盖**从零到跑起来**的全过程：环境要求、安装、启动、打包，以及数据存在哪里。

---

## 环境要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | 20+ | 仅用于运行 npm 脚本与 Vite 构建。SQLite 驱动来自 Electron 内置的 Node 运行时，不依赖本机 Node |
| npm | 10+ | 随 Node 安装 |
| 操作系统 | Windows 10+ / macOS 11+ / 主流 Linux | Electron 39 的最低要求 |
| 磁盘 | 数百 MB | 含 Electron 运行时与依赖 |

> **不需要**单独安装 SQLite。应用使用 Node 内置的 `node:sqlite`（`DatabaseSync`），
> 由 Electron 39 自带的 Node 22 运行时提供，构建时通过 `external` 排除，不打进产物。

---

## 安装依赖

```bash
npm install
```

项目配置了国内镜像（`.npmrc`），国内网络下安装较快：

```
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

> 首次安装会下载 Electron 二进制（约 100MB+）和 electron-builder 工具链，耗时较长属正常现象。

---

## 启动开发环境

```bash
npm run dev
```

`electron-vite dev` 会同时启动三部分：

1. Vite 渲染进程开发服务器（React 热更新）
2. 主进程构建并监听
3. 预加载脚本构建

改渲染层代码会热更新；改主进程代码需要重启 `npm run dev`。

### 首次运行

应用会自动创建一个欢迎页面 **「欢迎使用 Notion Clone」**（图标 👋），里面预置了覆盖 13 种块类型中 10 种的
示例内容（不含 `heading3`、`image` 与 `database`）。这是**数据库为空时的种子数据**（`src/main/db.ts:719`），
之后不会重复生成。

在侧边栏页面行的 `⋯` 菜单 →「恢复示例内容」可以随时把该页面的示例块重新灌回去
（`src/main/db.ts:748`），注意这会**清空该页面当前所有块**。

---

## 构建与运行

```bash
npm run build     # 产出到 out/
npm start         # 预览已构建的产物
```

产物结构：

```
out/
├── main/index.js        # 主进程（CJS）
├── preload/index.js     # 预加载脚本（CJS）
└── renderer/            # 渲染进程静态资源
```

---

## 打包成安装包

```bash
npm run dist          # Windows NSIS 安装包（x64）
npm run dist:dir      # Windows 免安装目录（调试用）
npm run dist:mac      # macOS DMG（arm64 / Apple Silicon）
npm run dist:mac:dir  # macOS .app 目录（调试用）
```

产物输出到 `dist/`。

**macOS 签名**：项目内置了 `scripts/sign-mac.js` 作为 electron-builder 的 `afterPack` 钩子。
若产物已带真实 Developer ID 签名则原样保留，否则用 ad-hoc 签名补上 entitlements。
Apple Silicon 拒绝启动未签名的 bundle，Gatekeeper 也会把未封装的包报成"已损坏"——
详见 [构建与发布](../development/build-and-release.md)。

---

## 数据存放位置

应用在启动时调用 `app.setName('notion-clone')`（`src/main/index.ts:118`），因此用户数据目录是确定的：

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\notion-clone` |
| macOS | `~/Library/Application Support/notion-clone` |
| Linux | `~/.config/notion-clone` |

目录内容：

```
notion-clone/
├── notion-clone.db      # SQLite 数据库（页面、块、设置）
├── notion-clone.db-wal  # WAL 日志
├── notion-clone.db-shm  # WAL 共享内存
└── assets/              # 图片资源，文件名 = UUID + 扩展名
```

在**设置 → 数据与存储**里可以看到完整路径、数据库体积、资源数量，并一键打开对应目录
（`src/main/settings.ts:146`）。

> **备份**：直接复制整个 `notion-clone` 目录即可。数据库运行中可能有 WAL 未合并，
> 稳妥做法是先退出应用再复制。

---

## 卸载

- **Windows**：运行生成的 NSIS 安装包卸载程序。
- **macOS**：拖入废纸篓。应用**不会**自动删除 `~/Library/Application Support/notion-clone`，
  需手动清理以彻底移除数据。

---

## 下一步

- 想先看看能做什么 → [功能巡览](quick-tour.md)
- 准备改代码 → [开发环境](../development/setup.md)
- 想知道数据长什么样 → [数据模型](../architecture/data-model.md)
