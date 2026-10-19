#!/usr/bin/env node
/**
 * 文档链接校验器。
 *
 * 校验两件事：
 *   1. 所有 Markdown 内部链接指向的文件确实存在；
 *   2. 所有 `#锚点` 在目标文件里真实存在（按 GitHub 的标题 slug 规则匹配）。
 *
 * 用法：
 *   node scripts/check-docs.mjs
 *
 * 退出码 0 表示全部通过，1 表示有错误。
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_DIR = join(ROOT, 'docs')

/** 会被一起校验的 Markdown 根文件（相对仓库根）。 */
const EXTRA_FILES = ['README.md']

/* ---------- 文件收集 ---------- */

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (extname(name) === '.md') out.push(full)
  }
  return out
}

const files = [...walk(DOCS_DIR)]
for (const rel of EXTRA_FILES) {
  const full = join(ROOT, rel)
  if (existsSync(full)) files.push(full)
}

/* ---------- Markdown 解析 ---------- */

/** 去掉围栏代码块，避免把示例里的路径当成真实链接。 */
function stripCodeBlocks(text) {
  const lines = text.split('\n')
  const out = []
  let fence = null
  for (const line of lines) {
    const m = /^\s*(```+|~~~+)/.exec(line)
    if (m) {
      if (fence === null) fence = m[1][0]
      else if (m[1][0] === fence) fence = null
      out.push('')
      continue
    }
    out.push(fence === null ? line : '')
  }
  return out.join('\n')
}

/** GitHub 风格的标题 slug：小写、去标点、空格转连字符。 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

/** 收集一个文件里所有标题的 slug（同名标题会带 -1、-2 后缀）。 */
function collectSlugs(markdown) {
  const slugs = new Map()
  const counts = new Map()
  for (const line of stripCodeBlocks(markdown).split('\n')) {
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const base = slugify(m[2])
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    const slug = n === 0 ? base : `${base}-${n}`
    if (!slugs.has(slug)) slugs.set(slug, m[2])
  }
  return slugs
}

/** 取出文件里的所有链接。返回 { target, line } 列表。 */
function collectLinks(markdown) {
  const lines = stripCodeBlocks(markdown).split('\n')
  const links = []

  lines.forEach((line, i) => {
    // 行内链接 [text](target) 与图片 ![alt](target)
    const inline = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
    let m
    while ((m = inline.exec(line)) !== null) {
      links.push({ target: m[1], line: i + 1 })
    }
    // 引用式定义 [id]: target
    const def = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/.exec(line)
    if (def) {
      links.push({ target: def[1], line: i + 1 })
    }
  })

  return links
}

const isExternal = (t) => /^(https?:|mailto:|tel:|data:|#|javascript:)/i.test(t)

/* ---------- 校验 ---------- */

const errors = []
const slugCache = new Map()

function slugsOf(file) {
  if (!slugCache.has(file)) {
    slugCache.set(file, collectSlugs(readFileSync(file, 'utf8')))
  }
  return slugCache.get(file)
}

for (const file of files) {
  const markdown = readFileSync(file, 'utf8')
  const relFile = relative(ROOT, file)

  for (const { target, line } of collectLinks(markdown)) {
    if (isExternal(target)) continue

    // 拆成 路径#锚点
    const hashIdx = target.indexOf('#')
    const pathPart = hashIdx >= 0 ? target.slice(0, hashIdx) : target
    const anchor = hashIdx >= 0 ? decodeURIComponent(target.slice(hashIdx + 1)) : ''

    const resolved = pathPart
      ? resolve(dirname(file), decodeURIComponent(pathPart))
      : file

    if (!existsSync(resolved)) {
      errors.push(`${relFile}:${line} 链接目标不存在 → ${target}`)
      continue
    }

    if (anchor) {
      if (extname(resolved) !== '.md') {
        errors.push(`${relFile}:${line} 非 Markdown 文件不能带锚点 → ${target}`)
        continue
      }
      const slugs = slugsOf(resolved)
      if (!slugs.has(anchor)) {
        const known = [...slugs.keys()].join(', ') || '(该文件没有标题)'
        errors.push(
          `${relFile}:${line} 锚点不存在 → #${anchor}\n    目标: ${relative(ROOT, resolved)}\n    可用锚点: ${known}`
        )
      }
    }
  }
}

/* ---------- 输出 ---------- */

if (errors.length > 0) {
  console.error(`✗ 文档校验失败，共 ${errors.length} 个问题：\n`)
  for (const e of errors) console.error(`  ${e}`)
  console.error('')
  process.exit(1)
}

console.log(`✓ 文档校验通过：${files.length} 个文件，所有内部链接与锚点均有效。`)
