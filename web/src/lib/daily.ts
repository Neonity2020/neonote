/**
 * 日记模式(Daily Note)的数据约定与日期工具。
 *
 * 日记页就是普通页面:零 schema、零协议改动,完全走现有离线同步链路。
 * - 识别:页面 id 由日期确定性派生(`daily-YYYY-MM-DD` 前缀);用户页面
 *   的 id 全是 UUID,不存在撞前缀。parentId 存 null(顶层)——parent_id
 *   是指向真实页面的外键,不能用哨兵值,服务端 push 时也会把指向不存在
 *   页面的 parentId 兜底为 null。
 * - 幂等:两台离线设备同一天各自创建的日记在同步后按行级 LWW 合并为
 *   同一页,而不是两页。
 * - position 用创建时间戳:日记页混在顶层兄弟里但被侧边栏过滤,时间戳
 *   保证它排在 allPages() 尾部,不会抢走「第一页」的选中资格。
 * - 认领手动页面:标题恰为「2026年10月24日」格式的普通页面也算该天的
 *   日记(有回链、进月历、日记视图兜底显示),但保留在侧边栏——只有
 *   日记模式创建的(daily- 前缀)才从页面树隐藏。
 */
import type { PageMeta } from '~/lib/shared'
import { parseWikiLinks } from '~/lib/shared'
import * as local from '~/lib/local-db'

const DAILY_ID_PREFIX = 'daily-'

/** 与 store.createPage 一致的首块 position 间隔。 */
const POSITION_STEP = 1024

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 本地时区某天的 dayKey(YYYY-MM-DD)。日记的一切日期比较都基于这个字符串,无时区歧义。 */
export function dayKeyOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayKey(): string {
  return dayKeyOf(new Date())
}

/** dayKey → 本地时区当天零点的 Date。 */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function dailyPageIdOf(dayKey: string): string {
  return `${DAILY_ID_PREFIX}${dayKey}`
}

/** 日记模式创建的页面(daily- 前缀 id)。只有这类页面会从侧边栏页面树隐藏。 */
export function isDailyPage(page: PageMeta): boolean {
  return page.id.startsWith(DAILY_ID_PREFIX)
}

const DAILY_TITLE_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/

/** 标题恰为「2026年10月24日」格式的页面视作该天的日记(用户不走日记入口手动建页的常见写法)。 */
function dayKeyFromTitle(title: string): string | null {
  const m = DAILY_TITLE_RE.exec(title.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dayKeyOf(dt)
}

/**
 * 从页面反解它属于哪一天:daily- 前缀 id 优先,否则看标题是否为日期格式。
 * 用于回链、月历圆点与日记视图兜底显示;非日记页返回 null。
 */
export function dayKeyOfPage(page: PageMeta): string | null {
  if (isDailyPage(page)) return page.id.slice(DAILY_ID_PREFIX.length)
  return dayKeyFromTitle(page.title ?? '')
}

/** 某天的日记页:daily- 前缀页优先,没有则认领标题为该日期的手动页面(取最近更新的)。 */
export function dailyPageOf(pages: PageMeta[], dayKey: string): PageMeta | undefined {
  const byId = pages.find((p) => p.id === dailyPageIdOf(dayKey))
  if (byId) return byId
  return pages
    .filter((p) => dayKeyOfPage(p) === dayKey)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

/**
 * 页面自身或任一祖先(沿 parentId 上溯,防环)是日记页时,返回那天的 dayKey。
 * 日记下挂的子笔记据此也能显示「日记 · 日期」回链返回对应日期。
 */
export function dailyKeyOfSelfOrAncestor(page: PageMeta, pages: PageMeta[]): string | null {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const seen = new Set<string>()
  let cur: PageMeta | undefined = page
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    const key = dayKeyOfPage(cur)
    if (key) return key
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return null
}

/**
 * 反链兜底:页面在 parentId 链上不属于任何日记,但被某篇日记的 [[wiki 链接]]
 * 引用时,视为那天的日记笔记(多篇命中取最近引用的)。双链创建的页面默认挂
 * 顶层,「日记里链接出去的笔记」正是这个形态。
 */
export function dailyKeyReferencing(title: string): string | null {
  const t = title.trim()
  if (!t) return null
  let best: { key: string; ts: number } | null = null
  for (const p of local.allPages()) {
    const key = dayKeyOfPage(p)
    if (!key) continue
    for (const b of local.blocksOf(p.id)) {
      const text = b.content.text ?? ''
      if (!text.includes('[[')) continue
      const hit = parseWikiLinks(text).some((l) => l.title === t)
      if (hit && (!best || b.updatedAt > best.ts)) best = { key, ts: b.updatedAt }
    }
  }
  return best?.key ?? null
}

/** 手动建的日期标题页:daily- 之外被日记认领的页面,侧边栏折叠进「日记」分组。 */
export function isTitledDailyPage(page: PageMeta): boolean {
  return !isDailyPage(page) && dayKeyOfPage(page) !== null
}

/** 一组根页面的全部后代 id(不含根自身;防环)。 */
export function subtreeIdsOf(pages: PageMeta[], roots: Set<string>): Set<string> {
  const ids = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const p of pages) {
      if (p.parentId && (roots.has(p.parentId) || ids.has(p.parentId)) && !ids.has(p.id)) {
        ids.add(p.id)
        grew = true
      }
    }
  }
  return ids
}

/** daily- 前缀日记页及其全部后代的 id 集合:侧边栏页面树整体隐藏这一子树(日记里建的链接页都挂在它下面)。 */
export function dailySubtreeIds(pages: PageMeta[]): Set<string> {
  return new Set([
    ...pages.filter(isDailyPage).map((p) => p.id),
    ...subtreeIdsOf(pages, new Set(pages.filter(isDailyPage).map((p) => p.id))),
  ])
}

/** 日记页标题,如「2026年10月24日」。 */
export function formatDailyTitle(dayKey: string): string {
  const d = parseDayKey(dayKey)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function weekdayLabel(dayKey: string): string {
  return `星期${WEEKDAY_LABELS[parseDayKey(dayKey).getDay()]}`
}

/** ISO 8601 周数(以含 1 月 4 日的那周为第 1 周,周一开头)。 */
export function isoWeekOf(dayKey: string): number {
  const date = parseDayKey(dayKey)
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // 移到本周周四,再与当年第一周的周四对齐求差。
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7))
  const week1 = new Date(target.getFullYear(), 0, 4)
  week1.setDate(week1.getDate() + 3 - ((week1.getDay() + 6) % 7))
  return 1 + Math.round((target.getTime() - week1.getTime()) / (7 * 24 * 3600 * 1000))
}

/** 「今天 / 昨天 / N 天前」式的相对描述,用于最近日记列表。 */
export function relativeLabel(dayKey: string): string {
  const diff = Math.round(
    (parseDayKey(todayKey()).getTime() - parseDayKey(dayKey).getTime()) / 86_400_000
  )
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'
  if (diff > 0) return `${diff} 天前`
  if (diff === -1) return '明天'
  return `${-diff} 天后`
}

/** dayKey 加 N 天。 */
export function addDays(dayKey: string, delta: number): string {
  const d = parseDayKey(dayKey)
  d.setDate(d.getDate() + delta)
  return dayKeyOf(d)
}

/**
 * 确保某天的日记页存在(确定性 id),不存在则连同首空段落一起创建。
 * 与 store.createPage 的落库行为一致:写穿 local-db,由订阅刷新视图。
 */
export function ensureDailyPage(dayKey: string): string {
  const id = dailyPageIdOf(dayKey)
  if (local.pageById(id)) return id
  const ts = local.nextStamp()
  local.writePage({
    id,
    title: formatDailyTitle(dayKey),
    icon: null,
    cover: null,
    parentId: null,
    position: ts,
    createdAt: ts,
    updatedAt: ts,
  })
  local.writeBlock({
    id: crypto.randomUUID(),
    pageId: id,
    type: 'paragraph',
    content: { text: '' },
    position: POSITION_STEP,
    createdAt: ts,
    updatedAt: ts,
  })
  return id
}
