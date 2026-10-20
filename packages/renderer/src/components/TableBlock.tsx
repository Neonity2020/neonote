import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownFromLine,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  ArrowUpFromLine,
  Trash2
} from 'lucide-react'
import type { Block, TableData } from '@neonity/notion-clone-shared'
import { createTableData, tableToText } from '@neonity/notion-clone-shared'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { consumeCellFocus, focusSoon, getCaretOffset, setCaretOffset } from '@/lib/caret'

interface TableBlockProps {
  block: Block
  registerRef: (el: HTMLElement | null) => void
  getNeighbors: () => { prev: Block | null; next: Block | null }
}

/** Insert plain text at the caret (a Shift+Enter newline or a paste); the caller syncs it to the store. */
function insertPlainText(text: string): void {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

export function TableBlock({ block, registerRef, getNeighbors }: TableBlockProps): JSX.Element {
  const updateBlockLocal = useStore((s) => s.updateBlockLocal)
  const insertBlockAfter = useStore((s) => s.insertBlockAfter)
  const removeBlock = useStore((s) => s.removeBlock)

  const table = block.content.table ?? createTableData()
  const rows = table.rows
  const width = rows[0]?.length ?? 1
  const height = rows.length

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  /** Registry of the mounted cell elements, keyed by "row:column". */
  const cells = useRef(new Map<string, HTMLDivElement>())
  /** The cell the toolbar acts on (the most recently focused or clicked one). */
  const [active, setActive] = useState({ r: 0, c: 0 })
  const [engaged, setEngaged] = useState(false)

  const key = (r: number, c: number): string => `${r}:${c}`

  /** Always read the latest data from the store, so rapid successive edits never act on stale props. */
  const readTable = (): TableData => {
    const b = useStore.getState().blocks.find((x) => x.id === block.id)
    return b?.content.table ?? table
  }

  // The block's text field keeps a flattened copy of the table, so search, the AI context and
  // copy-paste work on it without having to special-case tables.
  const commit = (next: TableData): void => {
    const b = useStore.getState().blocks.find((x) => x.id === block.id)
    updateBlockLocal(block.id, { ...(b?.content ?? block.content), table: next, text: tableToText(next) })
  }

  const focusCell = (r: number, c: number): void => {
    setActive({ r, c })
    requestAnimationFrame(() => {
      const el = cells.current.get(key(r, c))
      if (!el) return
      el.focus()
      setCaretOffset(el, (el.textContent ?? '').length)
    })
  }

  const navigate = (r: number, c: number, pos: number | 'start' | 'end'): void => {
    const el = cells.current.get(key(r, c))
    if (!el) return
    setActive({ r, c })
    el.focus()
    const len = (el.textContent ?? '').length
    setCaretOffset(el, pos === 'start' ? 0 : pos === 'end' ? len : Math.min(pos, len))
  }

  // A table created from the slash menu: hand the focus to the first cell once mounted.
  useEffect(() => {
    if (consumeCellFocus(block.id)) {
      requestAnimationFrame(() => {
        const el = cells.current.get(key(0, 0))
        if (el) {
          el.focus()
          setCaretOffset(el, 0)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync the cell text when the data changes externally (an AI edit, switching pages back); the
  // cell being edited is left alone so the caret is not disturbed.
  useEffect(() => {
    for (const [k, el] of cells.current) {
      if (document.activeElement === el) continue
      const [r, c] = k.split(':').map(Number)
      const value = table.rows[r]?.[c] ?? ''
      if ((el.textContent ?? '') !== value) el.textContent = value
    }
  }, [table])

  const cellRef = (r: number, c: number) => (el: HTMLDivElement | null) => {
    const k = key(r, c)
    if (!el) {
      cells.current.delete(k)
      return
    }
    cells.current.set(k, el)
    const value = table.rows[r]?.[c] ?? ''
    if ((el.textContent ?? '') !== value) el.textContent = value
  }

  const writeCell = (r: number, c: number, text: string): void => {
    const base = readTable()
    if (!base.rows[r]) return
    commit({
      ...base,
      rows: base.rows.map((row, ri) => (ri === r ? row.map((v, ci) => (ci === c ? text : v)) : row))
    })
  }

  const insertRowAt = (index: number, col: number): void => {
    const base = readTable()
    const cols = base.rows[0]?.length ?? 1
    const next = [...base.rows]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, Array.from({ length: cols }, () => ''))
    commit({ ...base, rows: next })
    focusCell(index, Math.min(col, cols - 1))
  }

  const insertColAt = (index: number, row: number): void => {
    const base = readTable()
    const next = base.rows.map((r) => {
      const cells2 = [...r]
      cells2.splice(Math.max(0, Math.min(index, cells2.length)), 0, '')
      return cells2
    })
    commit({ ...base, rows: next })
    focusCell(Math.min(row, next.length - 1), index)
  }

  const deleteRowAt = (index: number): void => {
    const base = readTable()
    if (base.rows.length <= 1) return
    const row = Math.max(0, Math.min(index, base.rows.length - 1))
    const next = base.rows.filter((_, i) => i !== row)
    commit({ ...base, rows: next })
    focusCell(Math.min(row, next.length - 1), Math.min(active.c, (next[0]?.length ?? 1) - 1))
  }

  const deleteColAt = (index: number): void => {
    const base = readTable()
    const cols = base.rows[0]?.length ?? 1
    if (cols <= 1) return
    const col = Math.max(0, Math.min(index, cols - 1))
    const next = base.rows.map((r) => r.filter((_, i) => i !== col))
    commit({ ...base, rows: next })
    focusCell(Math.min(active.r, next.length - 1), Math.min(col, (next[0]?.length ?? 1) - 1))
  }

  const toggleHeader = (): void => {
    const base = readTable()
    commit({ ...base, header: !base.header })
  }

  const removeTable = (): void => {
    const { prev, next } = getNeighbors()
    void removeBlock(block.id).then(() => {
      if (prev) focusSoon(prev.id)
      else if (next) focusSoon(next.id, 0)
    })
  }

  const insertParagraphAfter = (): void => {
    void insertBlockAfter(block.id, 'paragraph', { text: '' }).then((nb) => {
      if (nb) focusSoon(nb.id, 0)
    })
  }

  // Enter moves down and inserts a row at the bottom, Shift+Enter inserts a newline inside the
  // cell, Tab moves right and wraps to the next row, and the arrow keys only leave the cell when
  // the caret sits on the first or last visual line.
  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    r: number,
    c: number
  ): void => {
    // While an IME is composing, Enter confirms the candidate word instead of
    // moving to the next cell, so the cell keys are left alone until the
    // composition ends.
    if (e.nativeEvent.isComposing) return
    const el = e.currentTarget
    const text = el.textContent ?? ''
    const offset = getCaretOffset(el)

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (r === height - 1) insertRowAt(height, c)
      else navigate(r + 1, c, 'end')
      return
    }

    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      insertPlainText('\n')
      writeCell(r, c, el.textContent ?? '')
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (!e.shiftKey) {
        if (c + 1 < width) navigate(r, c + 1, 'start')
        else if (r + 1 < height) navigate(r + 1, 0, 'start')
        else insertRowAt(height, 0)
      } else if (c > 0) {
        navigate(r, c - 1, 'end')
      } else if (r > 0) {
        navigate(r - 1, width - 1, 'end')
      }
      return
    }

    const atFirstLine = !text.slice(0, offset).includes('\n')
    const atLastLine = !text.slice(offset).includes('\n')

    if (e.key === 'ArrowUp' && atFirstLine) {
      e.preventDefault()
      if (r > 0) navigate(r - 1, c, offset)
      else {
        const { prev } = getNeighbors()
        if (prev) focusSoon(prev.id)
      }
      return
    }
    if (e.key === 'ArrowDown' && atLastLine) {
      e.preventDefault()
      if (r < height - 1) navigate(r + 1, c, offset)
      else {
        const { next } = getNeighbors()
        if (next) focusSoon(next.id, 0)
      }
      return
    }
    if (e.key === 'ArrowLeft' && offset === 0) {
      e.preventDefault()
      if (c > 0) navigate(r, c - 1, 'end')
      else {
        const { prev } = getNeighbors()
        if (prev) focusSoon(prev.id)
      }
      return
    }
    if (e.key === 'ArrowRight' && offset === text.length) {
      e.preventDefault()
      if (c + 1 < width) navigate(r, c + 1, 'start')
      else if (r + 1 < height) navigate(r + 1, 0, 'start')
      return
    }
    if (e.key === 'Backspace' && offset === 0 && text === '') {
      // Backspace in an empty cell moves to the previous cell; the very first cell does nothing,
      // to avoid deleting the whole table by accident.
      if (r === 0 && c === 0) return
      e.preventDefault()
      if (c > 0) navigate(r, c - 1, 'end')
      else navigate(r - 1, width - 1, 'end')
    }
  }

  const handleWrapperKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Only handle the case where the table body itself has the focus; keys bubbling up from a
    // cell are let through.
    if (e.target !== e.currentTarget) return
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      removeTable()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      insertParagraphAfter()
    }
  }

  const toolButton = (
    label: string,
    Icon: typeof ArrowUpFromLine | null,
    onClick: () => void,
    danger = false
  ): JSX.Element => (
    <button
      key={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-6 cursor-pointer items-center gap-0.5 rounded px-1.5 text-[11px] leading-none text-muted-foreground hover:bg-accent hover:text-foreground',
        danger && 'hover:text-destructive',
        Icon ? 'w-6 justify-center px-0' : ''
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : label}
    </button>
  )

  return (
    <div
      ref={(el) => {
        wrapperRef.current = el
        registerRef(el)
      }}
      tabIndex={0}
      role="group"
      onKeyDown={handleWrapperKeyDown}
      onFocus={(e) => {
        if (e.target === e.currentTarget) focusCell(0, 0)
      }}
      onMouseEnter={() => setEngaged(true)}
      onMouseLeave={() => setEngaged(false)}
      onFocusCapture={() => setEngaged(true)}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null
        if (!next || !e.currentTarget.contains(next)) setEngaged(false)
      }}
      className="relative my-1 rounded-md outline-none focus:ring-2 focus:ring-foreground/10"
    >
      {engaged && (
        <div className="absolute -top-8 right-0 z-10 flex items-center gap-0.5 rounded-md border bg-popover px-1 py-0.5 text-muted-foreground shadow-sm">
          {toolButton('上方插入行', ArrowUpFromLine, () => insertRowAt(active.r, active.c))}
          {toolButton('下方插入行', ArrowDownFromLine, () => insertRowAt(active.r + 1, active.c))}
          {toolButton('左侧插入列', ArrowLeftFromLine, () => insertColAt(active.c, active.r))}
          {toolButton('右侧插入列', ArrowRightFromLine, () => insertColAt(active.c + 1, active.r))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          <button
            title="把第一行作为表头"
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleHeader}
            className={cn(
              'h-6 rounded px-1.5 text-[11px] leading-none transition-colors hover:bg-accent hover:text-foreground',
              table.header ? 'bg-accent text-foreground' : 'text-muted-foreground'
            )}
          >
            表头
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {toolButton('删除行', null, () => deleteRowAt(active.r), true)}
          {toolButton('删除列', null, () => deleteColAt(active.c), true)}
          <span className="mx-0.5 h-4 w-px bg-border" />
          {toolButton('删除表格', Trash2, removeTable, true)}
        </div>
      )}

      <table className="w-full table-fixed border-collapse text-[0.95em]">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((_value, c) => {
                const isHeader = table.header && r === 0
                return (
                  <td
                    key={c}
                    className={cn(
                      'border border-border p-0 align-top',
                      isHeader && 'bg-muted/60',
                      r === active.r && c === active.c && 'ring-1 ring-inset ring-foreground/10'
                    )}
                  >
                    <div
                      ref={cellRef(r, c)}
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      onInput={(e) => writeCell(r, c, e.currentTarget.textContent ?? '')}
                      onKeyDown={(e) => handleCellKeyDown(e, r, c)}
                      onFocus={() => setActive({ r, c })}
                      onPaste={(e) => {
                        e.preventDefault()
                        insertPlainText(e.clipboardData.getData('text/plain'))
                        writeCell(r, c, e.currentTarget.textContent ?? '')
                      }}
                      className={cn(
                        'min-h-[34px] whitespace-pre-wrap break-words px-2 py-1.5 outline-none',
                        isHeader && 'font-semibold'
                      )}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
