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

self.onmessage = async (event: MessageEvent<TranscribeRequest>): Promise<void> => {
  const msg = event.data
  if (!msg || msg.type !== 'transcribe') return
  try {
    post({ type: 'status', phase: 'loading', progress: 0 })
    await ensurePipeline(!!msg.mirror)
    post({ type: 'status', phase: 'decoding' })
    const output = asr ? await asr(msg.audio, { chunk_length_s: 30, stride_length_s: 5 }) : null
    const text = typeof output === 'string' ? output : (output?.text ?? '')
    post({ type: 'result', id: msg.id, text: text.trim() })
  } catch (error) {
    post({
      type: 'error',
      id: msg.id,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
