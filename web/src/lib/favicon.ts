const FAVICON_ID = 'current-page-favicon'

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    }
    return entities[character]
  })
}

export function syncPageFavicon(pageIcon: string | null | undefined): void {
  const glyph = pageIcon?.trim() || 'N'
  const isDefault = glyph === 'N' && !pageIcon?.trim()
  const background = isDefault
    ? '<rect x="4" y="4" width="56" height="56" rx="12" fill="white" stroke="#d4d4d8" stroke-width="2"/>'
    : ''
  const foreground = isDefault ? '#18181b' : 'currentColor'
  const fontSize = isDefault ? 42 : 48
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${background}<text x="32" y="34" text-anchor="middle" dominant-baseline="middle" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif" font-size="${fontSize}" font-weight="700" fill="${foreground}">${escapeXml(glyph)}</text></svg>`

  let favicon = document.head.querySelector<HTMLLinkElement>(`#${FAVICON_ID}`)
  if (!favicon) {
    favicon = document.createElement('link')
    favicon.id = FAVICON_ID
    favicon.rel = 'icon'
    favicon.type = 'image/svg+xml'
    document.head.appendChild(favicon)
  }
  favicon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}
