// 语音识别入口：取回音频 URL → 解码成 16kHz 单声道 → 交给 worker 跑 Whisper。
// 模型（whisper-base 量化版，首次使用约几十 MB）从 HuggingFace 下载并缓存到
// 浏览器；直连失败时自动改走 hf-mirror.com 镜像，选择记在 localStorage，
// 之后的下载直接用镜像。识别全程在本机完成，音频不出浏览器。

export interface TranscribeStatus {
  phase: 'loading' | 'decoding'
  progress?: number
  /** 流式增量文本：最终一轮转写过程中逐段到达，拼起来是实时预览。 */
  delta?: string
}

type StatusCallback = (status: TranscribeStatus) => void

const MIRROR_KEY = 'nc-transcribe-host'

interface PendingRun {
  resolve: (text: string) => void
  reject: (error: Error) => void
  onStatus?: StatusCallback
}

type WorkerMessage =
  | { type: 'status'; phase: 'loading' | 'decoding'; progress?: number }
  | { type: 'partial'; id: number; delta: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; message: string }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, PendingRun>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./transcribeWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data
      if (msg.type === 'status') {
        for (const run of pending.values()) run.onStatus?.(msg)
        return
      }
      if (msg.type === 'partial') {
        // 不带 delta 的 status 只会复位累计文本；增量只发给对应请求。
        pending.get(msg.id)?.onStatus?.({ phase: 'decoding', delta: msg.delta })
        return
      }
      const run = pending.get(msg.id)
      if (!run) return
      pending.delete(msg.id)
      if (msg.type === 'result') run.resolve(msg.text)
      else run.reject(new Error(msg.message))
    }
    worker.onerror = (event) => {
      const error = new Error(`识别 worker 异常: ${event.message}`)
      for (const run of pending.values()) run.reject(error)
      pending.clear()
    }
  }
  return worker
}

function usingMirror(): boolean {
  try {
    return localStorage.getItem(MIRROR_KEY) === 'mirror'
  } catch {
    return false
  }
}

/** 取回音频字节：先浏览器直连（外链带 CORS 头时最快），失败再经应用读回
 * （上传的资产是 R2 公网 URL 或 nc-asset://，浏览器 fetch 不到，但应用
 * 自己能读）。两条路都失败才算取不回。 */
async function fetchAudioBuffer(url: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(url)
    if (response.ok) return await response.arrayBuffer()
  } catch {
    // 落到应用读回路径
  }
  const viaApp = await window.api.fetchAssetBytes(url)
  if (viaApp) return viaApp.data
  throw new Error('无法获取音频文件：外链需允许跨域访问（CORS）且可直接下载')
}

/** 取回音频并解码成 16kHz 单声道采样（Whisper 的输入格式）。 */
async function decodeAudio(url: string): Promise<Float32Array> {
  const buffer = await fetchAudioBuffer(url)
  // OfflineAudioContext 会把解码结果重采样到自身的采样率，一步得到 16kHz。
  const context = new OfflineAudioContext(1, 1, 16000)
  const decoded = await context.decodeAudioData(buffer)
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0)
  const length = decoded.length
  const mono = new Float32Array(length)
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel)
    for (let i = 0; i < length; i++) mono[i] += data[i]
  }
  const channels = decoded.numberOfChannels
  for (let i = 0; i < length; i++) mono[i] /= channels
  return mono
}

function runInWorker(audio: Float32Array, mirror: boolean, onStatus?: StatusCallback): Promise<string> {
  const activeWorker = getWorker()
  const id = ++seq
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject, onStatus })
    activeWorker.postMessage({ type: 'transcribe', id, audio, mirror }, [audio.buffer])
  })
}

/**
 * 识别一段音频里的语音，返回转写文本。
 * 首次调用会先下载 Whisper 模型（之后走浏览器缓存）；onStatus 用于回报
 * 模型下载进度与识别阶段。
 */
export async function transcribeAudio(url: string, onStatus?: StatusCallback): Promise<string> {
  const audio = await decodeAudio(url)
  let phase: TranscribeStatus['phase'] = 'loading'
  const trackStatus: StatusCallback = (status) => {
    phase = status.phase
    onStatus?.(status)
  }
  const mirror = usingMirror()
  try {
    return await runInWorker(audio.slice(), mirror, trackStatus)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 模型下载阶段失败且还没用过镜像：换 hf-mirror.com 再试一次。
    if (!mirror && phase === 'loading') {
      try {
        localStorage.setItem(MIRROR_KEY, 'mirror')
      } catch {
        // 没有 localStorage 也照样重试
      }
      return runInWorker(audio.slice(), true, trackStatus)
    }
    throw new Error(message)
  }
}
