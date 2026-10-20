#!/usr/bin/env node
/**
 * Documentation link validator.
 *
 * Checks two things:
 *   1. every internal Markdown link points at a file that actually exists;
 *   2. every `#anchor` really exists in the target file, matched with GitHub's
 *      heading slug rules.
 *
 * Usage:
 *   node scripts/check-docs.mjs
 *
 * Exit code 0 means everything passed, 1 means errors were found.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_DIR = join(ROOT, 'docs')

/** Markdown root files that are validated too, relative to the repo root. */
const EXTRA_FILES = ['README.md']

/* ---------- File collection ---------- */

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

/* ---------- Markdown parsing ---------- */

/** Strip fenced code blocks, so paths inside examples are not treated as real links. */
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

/** GitHub-style heading slug: lowercase, punctuation removed, spaces to hyphens. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

/** Collect the slugs of every heading in a file (duplicate headings get a -1, -2 suffix). */
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

/** Extract every link in a file. Returns a list of { target, line }. */
function collectLinks(markdown) {
  const lines = stripCodeBlocks(markdown).split('\n')
  const links = []

  lines.forEach((line, i) => {
    // Inline links [text](target) and images ![alt](target)
    const inline = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
    let m
    while ((m = inline.exec(line)) !== null) {
      links.push({ target: m[1], line: i + 1 })
    }
    // Reference-style definition [id]: target
    const def = /^\s{0,3}\[[^\]]+\]:\s*(\S+)/.exec(line)
    if (def) {
      links.push({ target: def[1], line: i + 1 })
    }
  })

  return links
}

const isExternal = (t) => /^(https?:|mailto:|tel:|data:|#|javascript:)/i.test(t)

/* ---------- Validation ---------- */

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

    // Split into path and #anchor
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

/* ---------- Output ---------- */

if (errors.length > 0) {
  console.error(`✗ 文档校验失败，共 ${errors.length} 个问题：\n`)
  for (const e of errors) console.error(`  ${e}`)
  console.error('')
  process.exit(1)
}

console.log(`✓ 文档校验通过：${files.length} 个文件，所有内部链接与锚点均有效。`)
