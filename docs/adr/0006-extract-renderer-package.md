# ADR-0006：前端抽取为可发布的 npm 包

- **状态**：已接受
- **日期**：2026-10-20

---

## 背景

项目原本是单包结构：`src/main`、`src/preload`、`src/shared`、`src/renderer`
平铺在一个 `package.json` 下。前端（渲染进程）无法脱离这个 Electron 宿主被复用，
也没有清晰的对外 API 边界。

需求：把前端部分抽到 `packages/` 下，使其可以**独立发布到 npm**。

有利条件是边界本来就很干净：

- 渲染进程**零 `electron` import**，对宿主的依赖全部收敛在三个全局桥
  （`window.api` / `window.ai` / `window.settings`）和 `nc-asset://` 图片协议上。
- `src/shared/types.ts` 是主进程与渲染进程之间**唯一**的契约层，
  无副作用、无依赖，天然可以独立成包。

---

## 决策

改为 **npm workspaces** 单仓多包：

```
.                             Electron 宿主（main + preload + electron-builder）
├── src/main/
├── src/preload/
└── packages/
    ├── shared/               @neonity/notion-clone-shared（契约层）
    │   └── src/index.ts
    └── renderer/             @neonity/notion-clone-ui（前端，可 npm 发布）
        ├── index.html
        ├── tailwind.config.js / postcss.config.js
        └── src/
            ├── main.tsx      应用启动入口（index.html 引用，不属于对外 API）
            └── index.ts      npm 发布入口（导出 App、store、组件）
```

关键选择：

1. **两个包而不是一个**。契约层（shared）单独成包，
   主进程 / preload / 渲染进程都用包名 `@neonity/notion-clone-shared` import。
   如果并进前端包，主进程就得依赖 UI 包拿类型，方向是反的。

2. **源码包形态**（`main`/`exports` 直接指向 `.ts`）。
   消费方需要 bundler（vite/webpack），本项目自己的 electron-vite 就是第一个消费者。
   不引入 tsc/vite 库构建步骤，开发和迭代成本最低。

3. **`react`/`react-dom` 走 `peerDependencies`**，
   避免 npm 消费方装出第二份 React。

4. **shared 不外部化**：`externalizeDepsPlugin({ exclude: ['@neonity/notion-clone-shared'] })`。
   源码包的 `main` 指向 `.ts` 文件，**不能**被主进程产物在运行时 `require`，
   必须直接打进 `out/main`（`node:sqlite` 仍然 external）。

5. **根 package.json 不依赖 UI 包**。渲染进程构建时已完整打包进 `out/renderer`，
   运行时不需要它；不列依赖可以避免 electron-builder 把整棵 UI 依赖树
   （radix、dnd-kit……）塞进 asar。npm workspaces 会把所有包自动链接进
   根 `node_modules`，vite 解析不受影响。

---

## 理由

### 为什么契约层独立成包

`shared/types.ts` 被三端 import（主进程 6 个文件、preload、渲染进程 14 处）。
它定义的是 **IPC 协议**，不是 UI 的一部分。
独立成包后，任何一方改契约都会显式体现在包版本上，
也为"换一个宿主实现同一套协议"留了可能。

### 为什么是源码包

- 宿主（本项目）用 electron-vite，渲染进程本来就是 bundler 场景，
  源码包零配置接入。
- 不需要维护构建产物、sourcemap、d.ts 生成链。
- 代价（消费方必须有 bundler）在可预见的场景里不存在。

### electron-vite 的两个坑（实现时踩过）

- **默认 renderer input 固定从 `<项目根>/src/renderer/index.html` 找**，
  设置 `renderer.root` 后不会跟着走，必须显式写
  `build.rollupOptions.input`。
- **tailwind v3 的 postcss 插件按 `process.cwd`（仓库根）找配置**，
  不是按 CSS 文件位置。配置移进包后必须在 `postcss.config.js` 里
  显式传 `path.join(__dirname, 'tailwind.config.js')`。

---

## 后果

### 正面

- 前端有了明确的对外 API（`packages/renderer/src/index.ts`）和发布身份。
- 契约层成为显式的包边界，跨进程改动的影响一目了然。
- tsconfig 拆分为 web-only（renderer）与 node（宿主），类型环境不再混装。

### 负面

- 目录层级变深；改一处功能可能跨宿主与包两个目录。
- 源码包形态意味着 `npm publish` 出去的包**要求消费方使用 bundler**。
- 三个 tsc 工程，类型检查命令变长（已收敛进 `npm run typecheck`）。

### 后续影响

- 给渲染进程加依赖装到 `packages/renderer`；主进程依赖才装根目录。
- `npm publish` 前记得先在 npm 创建 `@neonity` scope（个人 scope 即可）。
- 如果未来要给纯 web 宿主复用 UI 包，需要把 `nc-asset://` 协议和
  三个 window 桥做成可注入的适配层（当前直接读全局）。

---

## 相关文档

- [架构总览](../architecture/overview.md)
- [IPC 桥](../architecture/ipc-bridge.md)
- [开发环境](../development/setup.md)
- [文件地图](../reference/file-map.md)
