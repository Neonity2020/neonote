import type { AiApi } from '~/lib/shared'

const ERROR = 'Web 版暂未接入 AI 助手'

/**
 * AiApi 的 Web 占位实现：面板可以打开、能收尾，但所有能力都明确返回不可用。
 * 之后接上服务端 AI 时只需替换这个对象。
 */
export const aiApi: AiApi = {
  send: async () => ({ ok: false, error: ERROR }),
  abort: async () => {},
  getStatus: async () => ({ ready: false, error: ERROR }),
  listModels: async () => [],
  reset: async () => {},
  onEvent: () => () => {},
  onNotesChanged: () => () => {},
}
