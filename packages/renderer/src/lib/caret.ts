/** Caret offset helpers for plaintext contenteditable elements. */

/**
 * Character offset of the caret inside a plain-text contenteditable element.
 *
 * The offset is measured against the element's text content, so it stays
 * meaningful even though the element is made up of many separate text nodes.
 */
export function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return 0
  const range = sel.getRangeAt(0)
  if (!el.contains(range.endContainer)) return 0
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.endContainer, range.endOffset)
  return pre.toString().length
}

/**
 * Place the caret at a character offset inside a plain-text contenteditable element.
 *
 * A contenteditable element holds many text nodes, so the target node is found
 * by walking them with a TreeWalker and counting characters.
 */
export function setCaretOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection()
  if (!sel) return
  el.focus()
  const range = document.createRange()
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()
  let last: Node | null = null
  let placed = false
  while (node) {
    const len = (node.textContent ?? '').length
    if (remaining <= len) {
      range.setStart(node, remaining)
      placed = true
      break
    }
    remaining -= len
    last = node
    node = walker.nextNode()
  }
  if (!placed) {
    if (last) {
      range.setStart(last, (last.textContent ?? '').length)
    } else {
      range.setStart(el, 0)
    }
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

/* ---------- Focus registry ---------- */

// Editable element of every mounted block, keyed by block id. The registry lets
// code outside React (the wiki link picker, the slash menu) find and focus a
// block without going through the component tree.
const blockElements = new Map<string, HTMLElement>()

export function registerBlockElement(id: string, el: HTMLElement | null): void {
  if (el) {
    blockElements.set(id, el)
  } else {
    blockElements.delete(id)
  }
}

/** The editable element of a block, used when inserting a wiki link. */
export function getBlockElement(id: string): HTMLElement | undefined {
  return blockElements.get(id)
}

/** Focus a block now, placing the caret at `offset` or at the end of its text. */
export function focusBlock(id: string, offset?: number): void {
  const el = blockElements.get(id)
  if (!el) return
  if (el instanceof HTMLTextAreaElement) {
    el.focus()
    const pos = offset ?? el.value.length
    el.setSelectionRange(pos, pos)
  } else if (el.isContentEditable) {
    const len = (el.textContent ?? '').length
    setCaretOffset(el, offset ?? len)
  } else {
    el.focus()
  }
}

/** Focus a block on the next frame, after React has had a chance to paint it. */
export function focusSoon(id: string, offset?: number): void {
  requestAnimationFrame(() => focusBlock(id, offset))
}

/**
 * Overwrite a block's text in the DOM.
 *
 * Assigning `textContent` also drops the wiki link spans; the decorator
 * rebuilds them on the next pass.
 */
export function setBlockElementText(id: string, text: string): void {
  const el = blockElements.get(id)
  if (el && el.isContentEditable) {
    el.textContent = text
  }
}

/* ---------- Pending focus (for blocks not yet mounted) ---------- */

let pendingFocus: { id: string; offset?: number } | null = null

/**
 * Focus a block, deferring until it exists if necessary.
 *
 * The block is usually already mounted by the time this runs: zustand's
 * `useSyncExternalStore` flushes the insertion synchronously, so the new
 * BlockItem's mount effect has already fired and consumed nothing. Waiting for
 * another mount effect would therefore drop the request and leave focus on the
 * previous block. Apply it directly whenever the element is available, and only
 * park it for a future mount when it isn't.
 */
export function requestFocus(id: string, offset?: number): void {
  if (blockElements.has(id)) {
    pendingFocus = null
    focusBlock(id, offset)
    return
  }
  pendingFocus = { id, offset }
}

export function consumePendingFocus(id: string): number | null | undefined {
  if (pendingFocus && pendingFocus.id === id) {
    const offset = pendingFocus.offset
    pendingFocus = null
    return offset ?? null
  }
  return undefined
}

/* ---------- Pending table cell focus ---------- */
/**
 * A table block has no single editable element, so focusing the block body
 * means focusing its first cell.
 * When the slash menu has just converted the block into a table the component
 * is not mounted yet, so the request is parked here and consumed by the table
 * once it mounts.
 */
let pendingCellFocus: string | null = null

export function requestCellFocus(id: string): void {
  pendingCellFocus = id
}

export function consumeCellFocus(id: string): boolean {
  if (pendingCellFocus === id) {
    pendingCellFocus = null
    return true
  }
  return false
}

/* ---------- Pending scroll (jumping in from a backlink) ---------- */

/**
 * Request that a block is scrolled into the middle of the viewport.
 * Used when jumping into another page from a backlink: the request is parked
 * until the target block has mounted and consumes it.
 */
let pendingScroll: { id: string } | null = null

export function requestScrollTo(id: string): void {
  pendingScroll = { id }
}

export function consumeScrollRequest(id: string): boolean {
  if (pendingScroll && pendingScroll.id === id) {
    pendingScroll = null
    return true
  }
  return false
}
