// Whisper 语音识别 worker：transformers.js 管线在这里懒加载，模型按需下载
// 并缓存到浏览器 Cache Storage，主线程只送入 16kHz 单声道采样。
//
// 消息协议：
//   主线程 → worker: { type: 'transcribe', id, audio: Float32Array, mirror?: boolean }
//   worker → 主线程: { type: 'status', phase: 'loading' | 'decoding', progress?: number }
//                    | { type: 'result', id, text }
//                    | { type: 'error', id, message }

interface TranscribeRequest {
  type: 'transcribe'
  id: number
  audio: Float32Array
  mirror?: boolean
}

const MIRROR_HOST = 'https://hf-mirror.com'

interface AsrPipeline {
  (audio: Float32Array, options: Record<string, unknown>): Promise<{ text?: string } | string>
}

let asr: AsrPipeline | null = null
let loading: Promise<void> | null = null
// 每个模型文件的下载进度，汇总成总进度回报给主线程。
const fileProgress = new Map<string, { loaded: number; total: number }>()

const post = (data: unknown): void => {
  ;(self as unknown as { postMessage(message: unknown): void }).postMessage(data)
}

function reportLoading(): void {
  let loaded = 0
  let total = 0
  for (const p of fileProgress.values()) {
    loaded += p.loaded
    total += p.total
  }
  post({ type: 'status', phase: 'loading', progress: total > 0 ? Math.round((loaded / total) * 100) : 0 })
}

async function ensurePipeline(mirror: boolean): Promise<void> {
  if (asr) return
  if (!loading) {
    loading = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers')
      // 直接走远程模型，避免先对不存在的本地 /models/ 目录发一堆 404。
      env.allowLocalModels = false
      if (mirror) env.remoteHost = MIRROR_HOST
      asr = (await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', {
        dtype: 'q8',
        progress_callback: (info: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (info.status === 'progress' && info.file && info.total) {
            fileProgress.set(info.file, { loaded: info.loaded ?? 0, total: info.total })
            reportLoading()
          }
        }
      })) as AsrPipeline
    })()
  }
  try {
    await loading
  } catch (error) {
    // 加载失败时重置，让下一次调用（可能已切换镜像）重新尝试。
    loading = null
    throw error
  }
}

// transformers.js 的多语言 Whisper 不传 language 会强制按英文解码（源码里
// "No language specified - defaulting to English"），中文音频会被"翻译"成英文。
// 这里用前 30 秒探针判定语言：先按中文跑，输出含汉字且重复度正常就按中文转写，
// 否则按英文。重复度（去重字符占比）用来排掉强制错语言时的高重复幻觉——
// 比如英文音频被强制中文解码会输出「你成為你成為你…」这类字符多样性极低的文本。
const PROBE_SAMPLES = 16000 * 30
const MIN_UNIQUE_RATIO = 0.2

function textOf(output: { text?: string } | string | null): string {
  const text = typeof output === 'string' ? output : (output?.text ?? '')
  return text.trim()
}

function containsHan(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text)
}

/** 去重字符占比：幻觉重复文本远低于 0.2，正常转写明显更高。 */
function uniqueRatio(text: string): number {
  if (!text) return 0
  return new Set(text).size / text.length
}

async function transcribeWith(asr: NonNullable<AsrPipeline>, audio: Float32Array, language: 'chinese' | 'english'): Promise<string> {
  const output = await asr(audio, {
    language,
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5
  })
  return textOf(output)
}

self.onmessage = async (event: MessageEvent<TranscribeRequest>): Promise<void> => {
  const msg = event.data
  if (!msg || msg.type !== 'transcribe') return
  try {
    post({ type: 'status', phase: 'loading', progress: 0 })
    await ensurePipeline(!!msg.mirror)
    post({ type: 'status', phase: 'decoding' })
    if (!asr) throw new Error('识别管线未就绪')
    // 探针只跑前 30 秒；短音频探针就是全量，中文时直接复用结果。
    const probeAudio = msg.audio.length > PROBE_SAMPLES ? msg.audio.subarray(0, PROBE_SAMPLES) : msg.audio
    const zhProbe = await transcribeWith(asr, probeAudio, 'chinese')
    const isChinese = containsHan(zhProbe) && uniqueRatio(zhProbe) >= MIN_UNIQUE_RATIO
    let text: string
    if (isChinese) {
      text = msg.audio.length > PROBE_SAMPLES ? await transcribeWith(asr, msg.audio, 'chinese') : zhProbe
    } else {
      text = msg.audio.length > PROBE_SAMPLES ? await transcribeWith(asr, msg.audio, 'english') : await transcribeWith(asr, probeAudio, 'english')
    }
    post({ type: 'result', id: msg.id, text })
  } catch (error) {
    post({
      type: 'error',
      id: msg.id,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
