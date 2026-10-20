# 构建与发布

---

## 三段式构建

electron-vite 把应用拆成三段，各自有独立的构建配置：

| 段 | 入口 | 产物 | 格式 |
| --- | --- | --- | --- |
| main | `src/main/index.ts` | `out/main/index.js` | CJS |
| preload | `src/preload/index.ts` | `out/preload/index.js` | CJS |
| renderer | `packages/renderer/index.html` | `out/renderer/` | 静态资源 |

```bash
npm run build
```

### 外部化

```ts
export default defineConfig({
  main: {
    // shared 包是 .ts 源码包，必须排除出外部化，直接打进 out/main
    plugins: [
      externalizeDepsPlugin({ exclude: ['@neonity/notion-clone-shared'] })
    ],
    build: {
      rollupOptions: {
        external: ['node:sqlite']     // Node 内置模块，由 Electron 的 Node 运行时提供
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@neonity/notion-clone-shared'] })]
  },
  renderer: { resolve: { alias: { '@': resolve(__dirname, 'packages/renderer/src') } } }
})
```

`externalizeDepsPlugin()` 把 `dependencies` 里的包排除在打包之外——
运行时从 `node_modules` 加载。这也意味着**新增依赖必须进 `dependencies`，
不能放 `devDependencies`**（除非只在构建期用）。

### 一个环境坑

`electron.vite.config.ts` 开头有：

```ts
delete process.env.ELECTRON_RUN_AS_NODE
```

当终端的父进程本身是 Electron 应用（比如某些 IDE）时，
`ELECTRON_RUN_AS_NODE` 会泄漏进来，强制 Electron 以纯 Node 模式运行——
`require('electron')` 返回二进制路径字符串而不是 API，导致 `electron.app` 是 `undefined`。
在配置里删掉它，被 spawn 出来的 Electron 进程就永远继承不到。

---

## 打包

```bash
npm run dist          # Windows NSIS 安装包（x64）
npm run dist:mac      # macOS DMG（arm64）
```

产物在 `dist/`。

### electron-builder 配置

```jsonc
{
  "appId": "com.example.notion-clone",
  "productName": "Notion Clone",
  "directories": { "output": "dist" },
  "files": ["out/**/*", "package.json"],
  "npmRebuild": false,
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64"] }]
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "Notion Clone"
  },
  "mac": {
    "target": [{ "target": "dmg", "arch": ["arm64"] }],
    "category": "public.app-category.productivity",
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.inherit.plist"
  },
  "afterPack": "scripts/sign-mac.js"
}
```

几个要点：

- **`files` 只包含 `out/**/*` 和 `package.json`** —— 打包产物不带 `node_modules`，
  依赖靠 electron-builder 按 `dependencies` 重新安装。改依赖后要重新打包。
- **`npmRebuild: false`** —— 跳过原生模块重编译。`node:sqlite` 是内置模块，不需要重编译。
- **NSIS 是非一键安装**（`oneClick: false`），用户可选安装目录。
- **`perMachine: false`** —— 默认装到用户目录，不需要管理员权限。

### 免安装目录

```bash
npm run dist:dir      # Windows
npm run dist:mac:dir  # macOS
```

产出未封装的目录，方便直接运行调试。**macOS 上必须用这个方式验证签名是否正常**。

---

## macOS 签名

`scripts/sign-mac.js` 是 electron-builder 的 `afterPack` 钩子。

### 为什么需要它

Apple Silicon 拒绝启动**未签名**的 bundle，Gatekeeper 也会把**未封装（unsealed）**的包
报成"文件已损坏"。没有这一步，macOS 产物根本不可分发。

### 逻辑

```
1. 非 darwin 平台 → 直接返回
2. 解析 .app bundle 路径（用 productFilename）
3. bundle 不存在 → 跳过
4. 已有真正的 Developer ID 签名 → 原样保留，不降级
5. 否则用 ad-hoc 签名（-），带上 entitlements
6. codesign --verify --deep --strict 校验
```

关键在第 4 步：**真正的 Developer ID 签名会被保留**——
用真证书打的发布包不会被 ad-hoc 签名覆盖掉。

### 为什么用 `afterPack` 而不是 `afterSign`

`afterSign` 只在 electron-builder **自己完成了签名**时才会触发——
而我们恰恰需要覆盖"electron-builder 没签名"的情况。所以钩在更早的 `afterPack`。

### 命令

```bash
codesign --deep --force --sign - --timestamp=none \
  --entitlements build/entitlements.mac.plist \
  "Notion Clone.app"
```

`-` 表示 ad-hoc 签名（不关联开发者证书）。
`--timestamp=none` 因为 ad-hoc 签名没有签名者身份，不能做时间戳。

### Entitlements

`build/entitlements.mac.plist`：

```xml
<key>com.apple.security.cs.allow-jit</key>
<true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
<true/>
<key>com.apple.security.cs.allow-dyld-environment-variables</key>
<true/>
```

**这三个都是 Electron 渲染进程 JIT 编译必需的**。缺少任何一个，
应用会在启动时崩溃或无法渲染。

`build/entitlements.mac.inherit.plist` 是给辅助进程（GPU 进程等）用的继承版本。

---

## 用真实证书签名

如果要发布给别人用，需要 Apple Developer ID 证书：

```bash
# 导入证书到钥匙串
security import DeveloperIDApplication.cer

# 用证书签名
codesign --deep --force --sign "Developer ID Application: Your Name (TEAMID)" \
  --timestamp --options runtime \
  --entitlements build/entitlements.mac.plist \
  "Notion Clone.app"

# 公证
xcrun notarytool submit "Notion Clone.dmg" \
  --keychain-profile "AC_PASSWORD" --wait
```

签名完成后 `scripts/sign-mac.js` 会**自动跳过**（检测到 Developer ID 签名）。

---

## Windows 发布

当前只配置了 **NSIS x64**。如果要发 32 位或做便携版，需要在 `electron-builder` 配置里加 target。

NSIS 安装包**没有做代码签名**。未签名的安装包会触发 SmartScreen 警告
（"Windows 已保护你的电脑"），用户需要点"更多信息 → 仍要运行"。

---

## 发布检查清单

```
□ npm run build 无错误
□ npm run docs:check 通过
□ 在干净的用户数据目录下启动一次（验证首次运行的种子数据）
□ 侧边栏拖拽页面改层级正常
□ AI 面板能连上模型并读写笔记
□ 图片粘贴、表格增删行列正常
□ 深浅色主题切换无残留样式
□ 设置 → 数据与存储 里的路径和体积正确
```

---

## 相关文档

- [开发环境](setup.md) —— 脚本与目录结构
- [构建配置速查](#electron-builder-配置) —— 上文的配置说明
- [资源管线](../architecture/assets.md) —— 打包后数据目录的结构
