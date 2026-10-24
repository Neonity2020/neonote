import type { PageMeta, PageTitleIndex } from '@neonity/neonote-shared'
import { buildPageTitleIndex, lookupPageByTitle, parseWikiLinks } from '@neonity/neonote-shared'
import { getBlockElement, getCaretOffset, setCaretOffset } from './caret'

/**
 * The renderer layer has two jobs for wiki links:
 * 1. Render the `[[title]]` in a block body as a clickable link (decorator).
 * 2. Offer a page picker while the user types `[[` (trigger).
 *
 * Constraint: a block body is **plain text** and its DOM children belong to the
 * browser's native editing behaviour, so React never touches them. The
 * decorator therefore must not change the text; it may only wrap the matched
 * ranges in spans, byte for byte.
 */

/** The resolved target of a wiki link. */
export interface WikiLinkTarget {
  /** Whether the target page exists. */
  exists: boolean
  /** Id of the target page, or null when the page does not exist. */
  pageId: string | null
  /** Icon of the target page. */
  icon: string | null
}

/** Attribute holding the decoration signature, used to detect structural changes. */
const SIG_ATTR = 'data-wiki-sig'

/**
 * Page list -> title index. The index is reused while the `pages` array
 * reference is unchanged, so every link does not rebuild it.
 */
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

/**
 * Get the resolver function; the same `pages` reference reuses the same
 * function, so the identity stays stable across renders.
 */
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
 * Check that the existing span structure still matches the text.
 * The browser occasionally merges or splits text nodes while editing, so an
 * unchanged signature does not prove that the DOM is still intact. The
 * structure is compared once before rebuilding, to avoid a needless rebuild.
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
 * Decorate the wiki links inside an element: wrap every `[[title]]` in a span
 * and leave the plain text content untouched.
 *
 * The signature depends only on the link ranges plus the target state, so a
 * plain text edit does not trigger a rebuild: the browser's native editing has
 * already put the new characters into the right text node. A rebuild would
 * interrupt the caret, so the caret is put back by text offset around it.
 *
 * @returns whether the DOM structure was rebuilt
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
 * Overwrite a block's content with external text and clear the decoration
 * signature. Writing `textContent` drops the spans, so the signature has to go
 * as well: otherwise the next decoration pass would think the structure is
 * unchanged and skip the rebuild.
 */
export function resetBlockText(el: HTMLElement, text: string): void {
  el.textContent = text
  el.removeAttribute(SIG_ATTR)
}

/**
 * Find the `[[` trigger point at the caret.
 * Only the text immediately left of the caret counts, and no `[`, `]` or
 * newline may appear between the `[[` and the caret.
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

/** Find the wiki link element that was clicked; the span itself or its text counts. */
export function findWikiLinkElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  const link = target.closest('.wiki-link')
  return link instanceof HTMLElement ? link : null
}

/**
 * Insert the selected page as a `[[title]]` at the caret.
 *
 * The DOM is already updated inside this function; the caller only has to sync
 * the returned text into the store. When no trigger point is found (the user may
 * have moved the caret) null is returned and the caller treats it as "give up on
 * the insertion".
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
