/**
 * 外链抓取的守卫规则。
 *
 * 纯逻辑，无副作用、无依赖，服务端与客户端 bundle 都能安全引入。
 * 放在 lib/ 是为了能脱离 server 模块单独验证。
 */

/** 外链音频的最大字节数。 */
export const MAX_REMOTE_AUDIO_BYTES = 30 * 1024 * 1024

/**
 * 判断主机是否指向内网、回环或链路本地地址。
 *
 * 服务端代抓外链时必须挡住这些目标，否则登录用户能借这个接口探测
 * 本机与内网服务（SSRF）。
 *
 * 覆盖的是字面量 IP 与常见内网域名。DNS 重绑定不在此列——公网域名
 * 解析到私有地址的情形，Workers 出口本身也解析不到私有网段，
 * 但这属于平台兜底而非本函数的保证。
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host === 'home.arpa' || host.endsWith('.home.arpa')) return true
  if (host === 'metadata.google.internal' || host === 'metadata.goog') return true

  // IPv4 字面量
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a === 0 || a === 10 || a === 127) return true // 本机与 10/8
    if (a === 169 && b === 254) return true // 链路本地，含 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true // 私网 172.16/12
    if (a === 192 && b === 168) return true // 私网 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    return false
  }

  // IPv6 字面量，含 IPv4-mapped 形式
  if (host.includes(':')) {
    const inner = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
    if (inner === '::1' || inner === '::') return true
    if (inner.startsWith('::ffff:')) return isPrivateHost(inner.slice('::ffff:'.length))
    if (/^f[cd][0-9a-f]{2}:/.test(inner)) return true // fc00::/7 唯一本地地址
    if (/^fe[89ab][0-9a-f]:/.test(inner)) return true // fe80::/10 链路本地地址
  }

  return false
}

/**
 * 外链音频允许的响应类型。
 *
 * 只收音频类：audio/* 之外额外放行 video/mp4 与 video/webm——播客站点
 * 常用 mp4/webm 容器装 AAC/Opus 音轨，<audio> 能直接播。
 *
 * application/octet-stream 与空类型不收：前者等于「任何二进制都算音频」，
 * 后者等于「不看类型直接收」，两者都能把 HTML 错误页当音频存下来。
 */
export function isAudioResponseType(mime: string): boolean {
  return mime.startsWith('audio/') || mime === 'video/mp4' || mime === 'video/webm'
}

/**
 * 读响应体，超过上限就中断。
 *
 * 不先 arrayBuffer() 再比大小：那样超大响应会整个进内存，Workers 的
 * 内存上限不高，一次就能把实例打爆。先看 content-length 快速拒绝，
 * 再流式读取兜住没有长度头的分块响应。
 */
export async function readCapped(response: Response, maxBytes: number): Promise<ArrayBuffer | null> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const size = Number(declared)
    if (Number.isFinite(size) && size > maxBytes) return null
  }

  const body = response.body
  if (!body) {
    const buffer = await response.arrayBuffer()
    return buffer.byteLength <= maxBytes ? buffer : null
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out.buffer
}
