/**
 * 后台同步引擎:唯一的网络同步执行者。
 *
 * 周期 = 把 dirty 行分批 push 到云端(服务端逐行 LWW),成功后立刻 pull 回
 * 权威状态校准本地(输掉的本地行在此被覆盖)。触发:本地写(500ms 去抖)、
 * 网络恢复、页面重新可见、30s 定时。所有失败只落到状态上,不丢数据——
 * 改动一直在 IndexedDB 里,下一个触发点继续推。
 */
import { create } from 'zustand'
import { pushChanges, pullChanges } from '~/server/sync'
import * as local from './local-db'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'unauth' | 'error'

interface SyncState {
  status: SyncStatus
  /** 还没推上去的本地变更行数。 */
  pending: number
  lastSyncedAt: number | null
  lastError: string | null
}

export const useSync = create<SyncState>(() => ({
  status: 'idle',
  pending: 0,
  lastSyncedAt: null,
  lastError: null,
}))

function setStatus(patch: Partial<SyncState>): void {
  useSync.setState(patch)
}

/** 单个 push 批次的行数上限。 */
const PUSH_BATCH = 200
/** 本地写之后到发起同步的去抖窗口。 */
const PUSH_DEBOUNCE = 500
/** 无操作时的兜底轮询间隔。 */
const POLL_INTERVAL = 30_000

let started = false
let running = false
/** 周期执行中又来了新触发:跑完当前轮再来一轮。 */
let wake = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null

export function startSync(): void {
  if (started) return
  started = true
  local.subscribeLocal(scheduleFromLocalWrite)
  window.addEventListener('online', () => void cycle())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void cycle()
  })
  window.setInterval(() => void cycle(), POLL_INTERVAL)
  void cycle()
}

/** 手动触发一次(等 AI 刷新之类的场景)。 */
export async function syncNow(): Promise<void> {
  await cycle()
}

function scheduleFromLocalWrite(): void {
  // 会话过期后编辑仍会发生:不要每 500ms 打一次注定 401 的请求,
  // 交给 30s 轮询/上线事件/可见性事件去重新探测登录态。
  if (useSync.getState().status === 'unauth') return
  if (debounceTimer !== null) return
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void cycle()
  }, PUSH_DEBOUNCE)
}

async function cycle(): Promise<void> {
  if (running) {
    wake = true
    return
  }
  running = true
  try {
    do {
      wake = false
      await onePass()
    } while (wake)
  } finally {
    running = false
  }
}

async function onePass(): Promise<void> {
  const pendingBefore = local.pendingCount()
  if (pendingBefore > 0) setStatus({ status: 'syncing', pending: pendingBefore })
  try {
    // ---- push:分批清空 dirty ----
    for (;;) {
      const batch = local.takeDirty(PUSH_BATCH)
      if (!batch) break
      const res = await pushChanges({ data: batch })
      local.clearDirty(batch)
      local.observeServerTime(res.serverTime)
    }

    // ---- pull:权威状态回灌(改名扇出、其他设备、AI 改写都在这里进来) ----
    const pulled = await pullChanges({ data: { since: local.getLastPull() } })
    local.mergeRemote(pulled)
    local.saveClockMeta()

    const pending = local.pendingCount()
    setStatus({
      status: pending > 0 ? 'syncing' : 'synced',
      pending,
      lastSyncedAt: Date.now(),
      lastError: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 编辑期间会话过期:改动安全躺在本地,重登后下一个触发点补推。
    if (/\bunauthorized\b|\b401\b/i.test(message)) {
      setStatus({ status: 'unauth', pending: local.pendingCount(), lastError: '登录已过期' })
      return
    }
    const offline = err instanceof TypeError || /fetch|network|failed to fetch/i.test(message)
    setStatus({
      status: offline ? 'offline' : 'error',
      pending: local.pendingCount(),
      lastError: offline ? null : message,
    })
  }
}
