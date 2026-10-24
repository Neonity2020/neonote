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
 *   保证它排在 allPages 尾部,不会抢走「第一页」的选中资格。
 * 页面标题只是展示文案(可被用户改掉),一切机器识别都只看 id。
 */
import type { PageMeta } from '~/lib/shared'
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

export function isDailyPage(page: PageMeta): boolean {
  return page.id.startsWith(DAILY_ID_PREFIX)
}

/** 从页面 id 反解 dayKey;非日记页返回 null。 */
export function dayKeyOfPage(page: PageMeta): string | null {
  return isDailyPage(page) ? page.id.slice(DAILY_ID_PREFIX.length) : null
}

export function dailyPageOf(pages: PageMeta[], dayKey: string): PageMeta | undefined {
  return pages.find((p) => p.id === dailyPageIdOf(dayKey))
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
