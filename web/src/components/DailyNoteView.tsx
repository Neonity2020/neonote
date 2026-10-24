/**
 * 日记模式主视图(参考 Capacities 的 Daily Note 交互):
 * 主列 = 日期导航(‹ 今天 ›)+ 星期/大日期标题 + 当日笔记(复用 Editor);
 * 右栏 = 联动月历(今天圆形高亮、有日记的日期圆点)+ 最近日记列表。
 *
 * 「某天有没有日记」始终按 pages 投影(dailyPageOf)判断,而不是 currentPageId:
 * 这样删除/远端合并后视图自动回到创建空态,不依赖编辑器状态。
 */
import { useEffect, useMemo, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useStore } from '~/store'
import { cn } from '~/lib/utils'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { Editor } from './Editor'
import {
  addDays,
  dayKeyOf,
  dayKeyOfPage,
  dailyPageOf,
  formatDailyTitle,
  isoWeekOf,
  parseDayKey,
  relativeLabel,
  todayKey,
  weekdayLabel,
} from '~/lib/daily'

export function DailyNoteView(): JSX.Element {
  const storedDate = useStore((s) => s.dailyDate)
  const pages = useStore((s) => s.pages)
  const selectDailyDate = useStore((s) => s.selectDailyDate)
  const createDailyPage = useStore((s) => s.createDailyPage)

  const dailyDate = storedDate ?? todayKey()
  const dayPage = dailyPageOf(pages, dailyDate)
  const isToday = dailyDate === todayKey()

  const notedDays = useMemo(
    () =>
      pages
        .map(dayKeyOfPage)
        .filter((k): k is string => k !== null)
        .sort()
        .reverse(),
    [pages]
  )
  const notedSet = useMemo(() => new Set(notedDays), [notedDays])
  const recentDays = useMemo(
    () => notedDays.filter((k) => k !== dailyDate).slice(0, 6),
    [notedDays, dailyDate]
  )

  return (
    <div className="flex min-h-full">
      <div className="min-w-0 flex-1">
        {/* 日期导航:前后一天,不在今天时提供一键回今天。 */}
        <div className="flex items-center gap-1 px-6 pt-4">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="前一天"
            onClick={() => selectDailyDate(addDays(dailyDate, -1))}
          >
            <ChevronLeft />
          </Button>
          {!isToday && (
            <Button variant="outline" size="sm" onClick={() => selectDailyDate(todayKey())}>
              今天
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="后一天"
            onClick={() => selectDailyDate(addDays(dailyDate, 1))}
          >
            <ChevronRight />
          </Button>
        </div>

        {/* 日期标题区。 */}
        <div className="px-8 pb-2 pt-6 md:px-20">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{weekdayLabel(dailyDate)}</span>
            {isToday && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                今天
              </span>
            )}
          </div>
          <h1 className="text-[32px] font-bold leading-tight tracking-tight">
            {formatDailyTitle(dailyDate)}
          </h1>
          <div className="text-xs text-muted-foreground">第 {isoWeekOf(dailyDate)} 周</div>
        </div>

        {/* 当日笔记:已有则内嵌编辑器(隐藏页面题头,日期标题在上方),没有则给出创建入口。 */}
        {dayPage ? (
          <Editor key={dayPage.id} hideHeader />
        ) : (
          <div className="mx-auto flex w-full max-w-[var(--editor-max-width,768px)] flex-col items-start gap-3 px-8 py-10 md:px-20">
            <p className="text-sm text-muted-foreground">
              {isToday ? '今天写点什么?' : '这一天还没有日记。'}
            </p>
            <Button onClick={() => createDailyPage(dailyDate)}>
              <Plus data-icon="inline-start" />
              {isToday ? '写今天的日记' : '补写这天的日记'}
            </Button>
          </div>
        )}
      </div>

      {/* 右栏:联动月历 + 最近日记。小屏隐藏,靠顶部导航切日期。 */}
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-l bg-muted/30 lg:flex">
        <div className="p-3">
          <MonthCalendar
            selectedDay={dailyDate}
            notedDays={notedSet}
            onPick={selectDailyDate}
          />
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto p-3">
          <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
            <BookOpen className="size-3.5" />
            最近日记
          </h2>
          {recentDays.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">还没有写过日记</p>
          ) : (
            <div className="space-y-0.5">
              {recentDays.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
                  onClick={() => selectDailyDate(key)}
                >
                  <span className="text-sm">{formatDailyTitle(key)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {relativeLabel(key)} · {weekdayLabel(key)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

/* ---------- 月历 ---------- */

interface MonthCalendarProps {
  selectedDay: string
  notedDays: Set<string>
  onPick: (dayKey: string) => void
}

/** 周一开头的联动月历:今天圆形高亮,选中日强调,有日记的日期带圆点。 */
function MonthCalendar({ selectedDay, notedDays, onPick }: MonthCalendarProps): JSX.Element {
  const [cursor, setCursor] = useState(() => monthOf(selectedDay))

  // 选中日在别处切换(‹ › 导航、最近日记)时,月历跟随到它所在的月份。
  useEffect(() => {
    setCursor(monthOf(selectedDay))
  }, [selectedDay])

  const cells = useMemo(() => buildCells(cursor), [cursor])
  const today = todayKey()

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-sm font-medium">
          {cursor.y}年{cursor.m + 1}月
        </span>
        <span className="flex gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="上个月"
            onClick={() => setCursor(shiftMonth(cursor, -1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下个月"
            onClick={() => setCursor(shiftMonth(cursor, 1))}
          >
            <ChevronRight />
          </Button>
        </span>
      </div>
      <div className="grid grid-cols-7 pb-1 text-center text-[11px] text-muted-foreground">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {cells.map((key) => {
          const d = parseDayKey(key)
          const inMonth = d.getMonth() === cursor.m && d.getFullYear() === cursor.y
          const isSel = key === selectedDay
          const isToday = key === today
          const hasNote = notedDays.has(key)
          return (
            <button
              key={key}
              type="button"
              aria-label={`${formatDailyTitle(key)}${hasNote ? ',有日记' : ''}`}
              onClick={() => onPick(key)}
              className={cn(
                'relative mx-auto flex size-8 items-center justify-center rounded-full text-xs transition-colors',
                !inMonth && 'text-muted-foreground/40',
                inMonth && !isSel && !isToday && 'hover:bg-accent',
                isSel && !isToday && 'bg-accent font-semibold text-accent-foreground',
                isToday && 'bg-primary font-semibold text-primary-foreground'
              )}
            >
              {d.getDate()}
              {hasNote && (
                <span
                  className={cn(
                    'absolute bottom-0.5 size-1 rounded-full',
                    isToday ? 'bg-primary-foreground' : 'bg-primary'
                  )}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface MonthCursor {
  y: number
  m: number
}

function monthOf(dayKey: string): MonthCursor {
  const d = parseDayKey(dayKey)
  return { y: d.getFullYear(), m: d.getMonth() }
}

function shiftMonth({ y, m }: MonthCursor, delta: number): MonthCursor {
  const d = new Date(y, m + delta, 1)
  return { y: d.getFullYear(), m: d.getMonth() }
}

/** 覆盖整月的网格:补足上月尾部与下月头部对齐周一,行数按需。 */
function buildCells({ y, m }: MonthCursor): string[] {
  const first = new Date(y, m, 1)
  const offset = (first.getDay() + 6) % 7 // 周一 = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const total = Math.ceil((offset + daysInMonth) / 7) * 7
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(y, m, 1 - offset + i)
    return dayKeyOf(d)
  })
}
