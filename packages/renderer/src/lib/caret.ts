/** Caret offset helpers for plaintext contenteditable elements. */

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

const blockElements = new Map<string, HTMLElement>()

export function registerBlockElement(id: string, el: HTMLElement | null): void {
  if (el) {
    blockElements.set(id, el)
  } else {
    blockElements.delete(id)
  }
}

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

export function focusSoon(id: string, offset?: number): void {
  requestAnimationFrame(() => focusBlock(id, offset))
}

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
 * 表格块没有"一个"可编辑元素,聚焦主体时应该落到第一个单元格。
 * 斜杠菜单刚把块转成表格时组件还没挂载,这里先登记,等表格挂载后自行消费。
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
