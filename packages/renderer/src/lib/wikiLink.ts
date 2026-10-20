import type { PageMeta, PageTitleIndex } from '@neonity/notion-clone-shared'
import { buildPageTitleIndex, lookupPageByTitle, parseWikiLinks } from '@neonity/notion-clone-shared'
import { getBlockElement, getCaretOffset, setCaretOffset } from './caret'

/**
 * 双链在渲染层的两件事:
 * 1. 把正文里的 `[[标题]]` 显示成可点击的链接(装饰器)
 * 2. 输入 `[[` 时弹出页面选择器(触发器)
 *
 * 约束:块正文是**纯文本**,DOM 子节点由浏览器原生编辑行为管理,React 不碰它们。
 * 所以装饰器绝不能改文本,只能在保持一字不差的前提下把匹配区间包进 span。
 */

/** 链接解析出来的目标 */
export interface WikiLinkTarget {
  /** 目标页面是否存在 */
  exists: boolean
  /** 目标页面 id;不存在时为 null */
  pageId: string | null
  /** 目标页面图标 */
  icon: string | null
}

/** 装饰签名挂在元素上,用来判断"结构有没有变过" */
const SIG_ATTR = 'data-wiki-sig'

/** 页面列表 → 标题索引。页面数组引用不变时复用,避免每个链接都重建索引 */
let cachedPages: PageMeta[] | null = null
let cachedIndex: PageTitleIndex<PageMeta> | null = null
let cachedResolver: ((title: string) => WikiLinkTarget) | null = null

function titleIndex(pages: PageMeta[]): PageTitleIndex<PageMeta> {
  if (cachedIndex && cachedPages === pages) return cachedIndex
  cachedPages = pages
  cachedIndex = buildPageTitleIndex(pages)
  cachedResolver = null
  return cachedIndex
}

/** 取得解析函数;同一个 pages 引用下复用同一个函数,免得每次渲染都换引用 */
export function getLinkResolver(pages: PageMeta[]): (title: string) => WikiLinkTarget {
  const index = titleIndex(pages)
  if (cachedResolver) return cachedResolver
  cachedResolver = (title: string): WikiLinkTarget => {
    const hit = lookupPageByTitle(index, title)
    return { exists: !!hit, pageId: hit?.id ?? null, icon: hit?.icon ?? null }
  }
  return cachedResolver
}

/**
 * 核对现有的 span 结构是否还和文本对得上。
 * 浏览器在编辑时偶尔会合并/拆分文本节点,签名没变不代表 DOM 还完好,
 * 所以重建前先比一次,省掉一次无谓的重建。
 */
function spansMatch(el: HTMLElement, matches: ReturnType<typeof parseWikiLinks>, text: string): boolean {
  const spans = el.querySelectorAll('.wiki-link')
  if (spans.length !== matches.length) return false
  for (let i = 0; i < matches.length; i++) {
    if (spans[i].textContent !== text.slice(matches[i].start, matches[i].end)) return false
  }
  return true
}

/**
 * 装饰元素里的双链:把 `[[标题]]` 包进 span,纯文本内容保持不变。
 *
 * 签名只由"链接区间 + 目标状态"决定 —— 单纯的文字改动不会触发重建,
 * 因为浏览器原生编辑已经把新字符插进了正确的文本节点。
 * 重建会打断光标,所以重建前后用文本偏移把光标放回原处。
 *
 * @returns DOM 结构是否被重建过
 */
export function decorateWikiLinks(
  el: HTMLElement,
  resolve: (title: string) => WikiLinkTarget
): boolean {
  const text = el.textContent ?? ''
  const matches = parseWikiLinks(text)
  const targets = matches.map((m) => resolve(m.title))
  const sig = matches
    .map((m, i) => `${m.start}-${m.end}:${m.title}:${targets[i].exists ? '1' : '0'}`)
    .join('|')

  if (el.getAttribute(SIG_ATTR) === sig && spansMatch(el, matches, text)) return false

  const focused = document.activeElement === el
  const caret = focused ? getCaretOffset(el) : null

  const frag = document.createDocumentFragment()
  let cursor = 0
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    if (m.start > cursor) {
      frag.appendChild(document.createTextNode(text.slice(cursor, m.start)))
    }
    const span = document.createElement('span')
    span.className = targets[i].exists ? 'wiki-link' : 'wiki-link wiki-link-missing'
    span.dataset.wikiTitle = m.title
    span.textContent = text.slice(m.start, m.end)
    span.title = targets[i].exists ? `打开「${m.title}」` : `创建「${m.title}」`
    frag.appendChild(span)
    cursor = m.end
  }
  if (cursor < text.length) {
    frag.appendChild(document.createTextNode(text.slice(cursor)))
  }

  el.replaceChildren(frag)
  el.setAttribute(SIG_ATTR, sig)
  if (caret !== null) setCaretOffset(el, caret)
  return true
}

/**
 * 用外部文本覆盖块内容,并清掉装饰签名。
 * 直接写 textContent 会抹掉 span,签名不清掉的话下一次装饰会以为"结构没变"而跳过重建。
 */
export function resetBlockText(el: HTMLElement, text: string): void {
  el.textContent = text
  el.removeAttribute(SIG_ATTR)
}

/**
 * 在光标位置找 `[[` 触发点。
 * 只认光标左边紧挨着的一段,`[[` 与光标之间不能出现 `[`、`]` 或换行。
 */
export function findLinkTrigger(
  text: string,
  offset: number
): { start: number; filter: string } | null {
  const before = text.slice(0, Math.max(0, offset))
  const m = /\[\[([^[\]\n]*)$/.exec(before)
  if (!m) return null
  return { start: offset - m[0].length, filter: m[1] }
}

/** 找出元素里被点到的双链元素(点 span 本身或 span 里的文字都算) */
export function findWikiLinkElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  const link = target.closest('.wiki-link')
  return link instanceof HTMLElement ? link : null
}

/**
 * 把选中的页面写成 `[[标题]]` 插到光标处。
 *
 * DOM 已经在函数里改好,调用方拿返回的 text 去同步 store 即可。
 * 找不到触发点(用户可能已经移开光标)时返回 null,调用方按"放弃插入"处理。
 */
export function applyWikiLink(
  blockId: string,
  title: string
): { text: string; caret: number } | null {
  const el = getBlockElement(blockId)
  if (!el || !el.isContentEditable) return null
  const text = el.textContent ?? ''
  const offset = getCaretOffset(el)
  const trigger = findLinkTrigger(text, offset)
  if (!trigger) return null
  const next = text.slice(0, trigger.start) + `[[${title}]]` + text.slice(offset)
  resetBlockText(el, next)
  const caret = trigger.start + title.length + 4
  setCaretOffset(el, caret)
  return { text: next, caret }
}
