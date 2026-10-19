# 样式与主题

样式体系是 **Tailwind CSS + CSS 变量**，深浅色通过 `<html>` 上的 `dark` class 切换。

---

## 配置

### Tailwind

`packages/renderer/tailwind.config.js`（配置随前端包走，content 相对包根）：

```js
module.exports = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // card / popover / primary / secondary / muted / accent / destructive / border / input / ring
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
```

**颜色一律用语义 token，不用固定色值。** 这样深色模式自动生效：

```tsx
// ✅ 正确：自动适配深浅色
<div className="bg-background text-foreground border-border" />

// ❌ 错误：深色模式下会瞎
<div className="bg-white text-black" />
```

### 路径别名

PostCSS 配置无关，Tailwind 的 `content` 已经覆盖了 `packages/renderer/src/**/*.{ts,tsx}`。

---

## 颜色变量

全部定义在 `packages/renderer/src/index.css`，用 **HSL 的三个分量**（不含 `hsl()` 包裹），
这样 Tailwind 才能拼成 `hsl(var(--x))`。

### 浅色（`:root`）

```css
--background: 0 0% 100%;
--foreground: 240 10% 3.9%;
--card: 0 0% 100%;
--card-foreground: 240 10% 3.9%;
--popover: 0 0% 100%;
--popover-foreground: 240 10% 3.9%;
--primary: 240 5.9% 10%;
--primary-foreground: 0 0% 98%;
--secondary: 240 4.8% 95.9%;
--secondary-foreground: 240 5.9% 10%;
--muted: 240 4.8% 95.9%;
--muted-foreground: 240 3.8% 46.1%;
--accent: 240 4.8% 95.9%;
--accent-foreground: 240 5.9% 10%;
--destructive: 0 84.2% 60.2%;
--destructive-foreground: 0 0% 98%;
--border: 240 5.9% 90%;
--input: 240 5.9% 90%;
--ring: 240 5.9% 10%;
--radius: 0.5rem;
```

### 深色（`.dark`）

同样的 key，值换成深色系。例如：

```css
.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --primary: 0 0% 98%;            /* 注意：深色下 primary 变成白色 */
  --primary-foreground: 240 5.9% 10%;
  /* ... */
}
```

> 配色是 **shadcn/ui 的中性灰阶**（zinc 系），`primary` 用 `foreground` 的反色。
> 改配色只需改这两组变量，**不要**在组件里写具体颜色。

---

## 主题切换

`packages/renderer/src/App.tsx`：

```tsx
const [systemDark, setSystemDark] = useState(
  () => window.matchMedia('(prefers-color-scheme: dark)').matches
)

const dark = theme === 'dark' || (theme === 'system' && systemDark)

useEffect(() => {
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}, [dark])
```

- `system` 模式监听 `matchMedia` 的 `change` 事件，实时响应系统切换。
- `colorScheme` 让原生滚动条和表单控件也跟着变。

### 窗口底色

主进程在创建窗口时算一次主题，用作 `backgroundColor`：

```ts
backgroundColor: resolvedTheme() === 'dark' ? '#0a0a0b' : '#ffffff'
```

这避免了**深色模式下启动时闪白**——窗口先显示底色，内容加载完再显示。
`resolvedTheme()` 会读设置，`system` 模式下看 `nativeTheme.shouldUseDarkColors`。

---

## 运行时下发的 CSS 变量

两个变量由**设置面板**驱动，在 `App.tsx` 里写到根节点：

```tsx
useEffect(() => {
  const root = document.documentElement.style
  root.setProperty('--editor-font-size', `${editor.fontSize}px`)
  root.setProperty('--editor-max-width', `${CONTENT_WIDTHS[editor.contentWidth]}px`)
}, [editor.fontSize, editor.contentWidth])
```

| 变量 | 取值 | 消费者 |
| --- | --- | --- |
| `--editor-font-size` | 14 / 15 / 17 / 19 px | `.block-body` |
| `--editor-max-width` | 640 / 768 / 1080 px | 编辑器容器 |

### `.block-body`

```css
.block-body {
  font-size: var(--editor-font-size, 15px);
  line-height: 1.8;
}
```

**只有带 `.block-body` 的元素受字号设置影响**：
正文、列表、待办、引用。标题（28/22/18px）和代码块（13px 等宽）
有各自的固定字号，不随设置变化。

### 消费宽度

```tsx
<div
  className="mx-auto w-full px-20 pb-[30vh] pt-14"
  style={{ maxWidth: 'var(--editor-max-width, 768px)' }}
>
```

---

## 编辑器专用样式

```css
.block-editable {
  outline: none;
  user-select: text;
  white-space: pre-wrap;
  word-break: break-word;
}

.block-editable:empty::before {
  content: attr(data-placeholder);
  color: hsl(var(--muted-foreground) / 0.5);
  pointer-events: none;
}
```

**占位符靠 `data-placeholder` 属性 + `:empty` 伪元素**实现——
`contentEditable` 元素为空时用 `::before` 显示提示，不影响真实内容。

`white-space: pre-wrap` 让文本块保留手动换行。

```css
.code-textarea {
  resize: none;
  outline: none;
  user-select: text;
  field-sizing: content;      /* 高度随内容自动增长 */
}
```

---

## 全局样式

```css
body {
  @apply bg-background text-foreground;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI',
               'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
  user-select: none;           /* 全局禁止选中 */
}
```

**中文字体栈**里显式列了 PingFang SC（macOS）、Hiragino Sans GB（旧 macOS）、
Microsoft YaHei（Windows），保证中文在各平台的观感一致。

`user-select: none` 全局禁止选中文字，但 `.block-editable` 和 `.code-textarea`
显式恢复 `user-select: text` —— 只有正文区域能选中。

---

## 滚动条

自定义了 WebKit 滚动条（8px 宽，滑块半透明圆角）。
Firefox 不支持 `::-webkit-scrollbar`，会保持默认样式。

---

## UI 组件

`packages/renderer/src/components/ui/` 是 shadcn/ui 风格的组件：

| 组件 | 依赖 |
| --- | --- |
| `button.tsx` | `@radix-ui/react-slot` + `class-variance-authority` |
| `input.tsx` | — |
| `separator.tsx` | `@radix-ui/react-separator` |
| `dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` |
| `tooltip.tsx` | `@radix-ui/react-tooltip` |

用的是 Radix UI 的**无样式**原语 + Tailwind 外观。

### `cn()` 工具

`packages/renderer/src/lib/utils.ts`：

```ts
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
```

`clsx` 拼接条件类名，`tailwind-merge` 解决 Tailwind 类冲突
（后者会正确处理 `p-2` 和 `p-4` 互斥，`clsx` 不会）。

**新增组件时用 `cn()` 而不是字符串拼接**，否则条件样式会和 Tailwind 打架。

---

## 相关文档

- [设置](../user-guide/settings.md) —— 外观设置的用户视角
- [开发环境](setup.md) —— 项目结构
- [架构总览](../architecture/overview.md) —— 设置如何分发到三个地方
