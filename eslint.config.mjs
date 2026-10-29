// ESLint flat config。
//
// 项目有三个运行时边界，globals 各不相同，所以分层配置：
//   1. src/**            —— Electron 主进程 + preload，Node 环境
//   2. packages/renderer —— 渲染进程，浏览器环境 + React
//   3. web/src           —— Web 端，浏览器环境 + React（server/ 子目录另有 Node 能力）
//
// 规则集刻意保持在「能立刻全绿」的范围内：typescript-eslint recommended
// + react-hooks recommended。不引入 type-aware 规则，那需要 projectService
// 并且会一次性翻出几百条历史问题，得当成独立的重构单来做。
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
      'web/dist/**',
      'web/.wrangler/**',
      // Cloudflare Workers 类型由 `wrangler types` 生成，不手写。
      'web/worker-configuration.d.ts',
      // TanStack Router 路由树由插件生成。
      'web/src/routeTree.gen.ts',
    ],
  },

  // ---- TypeScript 源码：typescript-eslint recommended ----
  // 只作用于 .ts/.tsx。CJS 的构建配置（tailwind/postcss）是 CommonJS，
  // 由下面单独的块处理，不该被 TS 规则扫。
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      // ignoreRestSiblings：`const { dirty: _dirty, ...rest } = row` 是
      // 「摘掉一个字段」的惯用法，被摘掉的字段本来就不该被使用。
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // ---- CommonJS 构建配置：postcss/tailwind/electron-builder 脚本 ----
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ---- Node 边界：主进程、preload ----
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ---- React 边界：渲染进程与 Web 端 ----
  {
    files: ['packages/renderer/src/**/*.{ts,tsx}', 'web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Fast Refresh 要求一个文件只导出组件；常量导出放行。
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // ---- shadcn/ui 组件：官方写法就是「组件 + variants 常量」同文件 ----
  {
    files: ['**/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  // ---- Web 端的 server 目录跑在 Workers 上，需要 Node 能力 ----
  {
    files: ['web/src/server/**/*.ts', 'web/src/lib/db.ts', 'web/src/lib/auth.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // ---- 共享契约层：纯类型与纯函数，两端都不能依赖 ----
  {
    files: ['packages/shared/src/**/*.ts'],
    languageOptions: {
      globals: {},
    },
  },

  // ---- Pi SDK 边界 ----
  // ai.ts 的工具定义用 ToolDefinition<any, any>：每个工具的 TypeBox schema
  // 都不同，数组元素类型只能放宽成 any，execute 的参数类型随之是 any。
  // 这是第三方 SDK 的动态边界，不是随手写的 any，故单文件豁免。
  {
    files: ['src/main/ai.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
