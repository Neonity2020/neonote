# 资源管线

图片文件存在**磁盘**，数据库只存**引用**。本��文档讲清从粘贴到渲染、再到回收的完整链路。

---

## 存储位置

```
<userData>/assets/
├── 9f1c2e3a-....png
├── 4b7d8e91-....jpg
└── 2a5f0c64-....webp
```

- 目录在 `getAssetsDir()` 里**按需创建**（`mkdirSync(recursive: true)`）。
- 文件名 = **UUID + 扩展名**。UUID 保证不冲突，扩展名由 MIME 推断。

---

## 写入路径

### 路径 A：粘贴图片

```
用户 Ctrl+V 粘贴图片
  → BlockItem.handlePaste 检测到 image/* 的剪贴板项
  → file.arrayBuffer() 取二进制
  → window.api.saveImage({ name, mime, data })
  → 主进程 saveImage()
      id = randomUUID() + extFor({name, mime})
      writeFileSync(assets/id, Buffer.from(data))
      return { id, url: 'nc-asset://asset/<id>' }
  → 渲染层按光标位置拆成三块（文字 / 图片 / 文字）
  → 新图片块 content.src = url
```

### 路径 B：文件选择器

```
用户点击空图片块
  → window.api.pickImage()
  → 主进程 dialog.showOpenDialog()
  → 选中后 copyFileSync(源文件, assets/<uuid><ext>)
  → return { id, url }
  → 块 content.src = url
```

区别：粘贴路径**接收二进制**（`ArrayBuffer`），选择器路径**复制文件**。

---

## 扩展名与 MIME 的双向映射

`src/main/assets.ts` 维护两张表：

**MIME → 扩展名**（写入时用，决定新文件的扩展名）：

```
image/png → .png      image/jpeg → .jpg     image/gif → .gif
image/webp → .webp    image/bmp → .bmp      image/svg+xml → .svg
image/avif → .avif    image/x-icon → .ico
```

**扩展名 → MIME**（读取时用，响应头）：

```
.png → image/png      .jpg/.jpeg → image/jpeg    .gif → image/gif
.webp → image/webp   .bmp → image/bmp            .svg → image/svg+xml
.avif → image/avif   .ico → image/x-icon
```

**推断优先级**：先看 MIME 表，MIME 命中就用；否则看原始文件名的扩展名；都没有则**默认 `.png`**。

选择器路径直接用源文件的扩展名（`extname(src)`），不做 MIME 推断。

---

## 读取路径：`nc-asset://` 协议

数据库里存的是 `nc-asset://asset/<uuid>.png` 这样的字符串，
渲染层直接当 `<img src>` 用。Electron 侧注册自定义协议来兑现。

### 协议注册

必须在 `app.whenReady()` **之前**调用 `registerSchemesAsPrivileged`（`src/main/index.ts:98`）：

```ts
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'nc-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])
```

| 特权 | 作用 |
| --- | --- |
| `standard` | 按标准 URL 解析（有 host / pathname） |
| `secure` | 视为安全上下文 |
| `supportFetchAPI` | 支持 `fetch()` |
| `stream` | 支持流式响应 |

### 请求处理

```ts
protocol.handle(ASSET_SCHEME, async (request) => {
  const url = new URL(request.url)
  const id = basename(decodeURIComponent(url.pathname))
  const filePath = join(getAssetsDir(), id)
  const res = await net.fetch(pathToFileURL(filePath).toString())
  const headers = new Headers(res.headers)
  headers.set('Content-Type', MIME_BY_EXT[extname(id).toLowerCase()] ?? 'application/octet-stream')
  return new Response(res.body, { status: res.status, headers })
})
```

关键点：

- **用 `basename` 取文件名**，防止路径穿越（`../../etc/passwd` 之类）。
- 用 `net.fetch` 读本地文件，而不是 `fs.readFile` 再 `new Response(buffer)`——
  前者能拿到正确的 `status` 和 `content-length`，并且支持流式传输。
- 异常时返回 **404**，不抛错，避免整个渲染进程崩掉。

> 协议里的 `nc-asset://asset/<id>` 中，`asset` 是 host 部分，
> `basename(url.pathname)` 取到的是 `/<id>` 的最后一段。

---

## 垃圾回收

应用启动时执行一次：

```ts
db.initDb()
gcAssets(db.listImageAssetIds())
```

`listImageAssetIds()` 扫全部 `type = 'image'` 的块，
用正则 `^nc-asset://asset/(.+)$` 提取被引用的文件 id 集合。

`gcAssets(keepIds)` 遍历 `assets/` 目录，**删掉不在引用集合里的文件**。

### 重要限制

> **GC 只在启动时跑一次。** 会话期间删除图片块，磁盘上的文件**不会立即删除**，
> 要等到下一次启动才被清理。

这是有意为之的取舍：运行期 GC 需要维护引用计数，处理"正在编辑的块""刚粘贴还没落库"
等中间状态，复杂度和风险都高得多。启动时 GC 足够安全——此时所有引用都是稳定状态。

### 副作用

如果某个图片文件被手动从 `assets/` 目录删掉，对应块会显示破图。
数据库里的引用还在，GC 不会去动它（`keepIds` 里有它），但文件已经没了。

---

## 与数据库的关系

```
数据库                              磁盘
────────────────────────────────    ────────────────────────────
blocks.content.src                 assets/<uuid>.png
  = "nc-asset://asset/<uuid>.png"  │
  │                                │
  └──── 正则提取 id ──────────────▶┘
```

数据库**不存图片数据**，只存引用。图片文件是**独立**的实体。

这带来一个后果：**数据库和资源目录可能不一致**（手动删文件、外部拷贝数据库等）。
应用在启动 GC 时会清理"多出来的文件"，但不会修复"缺失的文件"。

---

## 表格的对照

表格块**不走**资源管线——它完全存在数据库里（`content.table`），
额外的 `content.text` 摘要也是纯文本，不需要额外文件。

---

## 相关文档

- [图片与表格](../user-guide/media-and-tables.md) —— 用户视角的操作
- [数据模型](data-model.md) —— `content.src` 的存储
- [IPC 桥接](ipc-bridge.md) —— `images:save` / `images:pick` 通道
