/**
 * 内置封面预设。
 *
 * id 以 `preset:` 开头，用来和外链图片 URL 区分——页面的 cover 字段
 * 同时存这两种取值，靠这个前缀判断走哪条渲染路径。
 */
export const COVER_PRESETS = [
  { id: 'preset:aurora', label: '极光', background: 'linear-gradient(135deg, #0f766e 0%, #22d3ee 48%, #8b5cf6 100%)' },
  { id: 'preset:sunset', label: '日落', background: 'linear-gradient(135deg, #fb7185 0%, #f97316 48%, #facc15 100%)' },
  { id: 'preset:ocean', label: '海岸', background: 'linear-gradient(135deg, #0f172a 0%, #0369a1 50%, #67e8f9 100%)' },
  { id: 'preset:meadow', label: '原野', background: 'linear-gradient(135deg, #14532d 0%, #4d7c0f 50%, #bef264 100%)' },
  { id: 'preset:lavender', label: '薰衣草', background: 'linear-gradient(135deg, #4c1d95 0%, #a78bfa 52%, #f0abfc 100%)' },
  { id: 'preset:ink', label: '墨色', background: 'linear-gradient(135deg, #020617 0%, #334155 55%, #94a3b8 100%)' },
] as const

/**
 * 把 cover 取值转成 CSS background-image。
 *
 * 命中预设就返回预设的渐变；否则当作外链 URL，用 JSON.stringify 转义，
 * 避免引号或括号把 url() 撑破。
 */
export function getCoverBackground(cover: string): string {
  return COVER_PRESETS.find((preset) => preset.id === cover)?.background ?? `url(${JSON.stringify(cover)})`
}
