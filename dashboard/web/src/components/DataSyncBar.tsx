import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import type { SyncPulse } from '../lib/syncPulse'

interface FileMeta {
  exists: boolean
  mtimeIso?: string
  sizeBytes?: number
}

interface DataStatus {
  ok: boolean
  files?: {
    usageCsv?: FileMeta
    estimateJson?: FileMeta
    authJson?: FileMeta
  }
  session?: { expIso?: string; expired?: boolean } | null
  proxyConfigured?: boolean
  lastSync?: {
    ok?: boolean
    updatedAt?: string
    ms?: number
    hint?: string
    error?: string
  } | null
}

interface SyncDelta {
  sinceIso?: string | null
  elapsedMs?: number | null
  addedRows?: number
  addedTokens?: number
  addedUsd?: number
  totalTokens?: number
  totalRows?: number
  totalUsd?: number
  firstSync?: boolean
  addons?: {
    addedRows?: number
    addedTokens?: number
    addedUsd?: number
  }
}

interface SyncResponse {
  ok: boolean
  ms?: number
  hint?: string
  error?: string
  detail?: string
  steps?: { id: string; ok: boolean; ms: number }[]
  partial?: boolean
  delta?: SyncDelta
}

interface ServerCaps {
  dataStatus: boolean
  reload: boolean
  sync: boolean
  refresh: boolean
}

function formatRelativeTime(iso?: string) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return '刚刚'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

function formatBytes(n?: number) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

async function readServerCaps(): Promise<ServerCaps | null> {
  try {
    const r = await axios.get<{ features?: string[] }>('/api/health', {
      timeout: 5000,
    })
    const f = r.data.features ?? []
    return {
      dataStatus: f.includes('data-status'),
      reload: f.includes('reload'),
      sync: f.includes('sync'),
      refresh: f.includes('refresh'),
    }
  } catch {
    return null
  }
}

function deltaToPulse(delta: SyncDelta | undefined, syncMs?: number): SyncPulse {
  return {
    id: Date.now(),
    addedRows: delta?.addedRows ?? 0,
    addedTokens: delta?.addedTokens ?? 0,
    addedUsd: delta?.addedUsd ?? 0,
    totalTokens: delta?.totalTokens ?? 0,
    totalUsd: delta?.totalUsd ?? 0,
    elapsedMs: delta?.elapsedMs ?? null,
    firstSync: Boolean(delta?.firstSync || !delta?.sinceIso),
    addonUsd: delta?.addons?.addedUsd ?? 0,
    addonTokens: delta?.addons?.addedTokens ?? 0,
    syncMs,
  }
}

export function DataSyncBar({
  onReload,
  onSyncSuccess,
}: {
  onReload: () => void
  onSyncSuccess?: (pulse: SyncPulse) => void
}) {
  const [status, setStatus] = useState<DataStatus | null>(null)
  const [caps, setCaps] = useState<ServerCaps | null>(null)
  const [reloading, setReloading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [inlineErr, setInlineErr] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    const nextCaps = await readServerCaps()
    setCaps(nextCaps)
    if (!nextCaps) {
      setStatus(null)
      return
    }
    if (!nextCaps.dataStatus) {
      setStatus(null)
      return
    }
    try {
      const r = await axios.get<DataStatus>('/api/data-status')
      if (r.data.ok) setStatus(r.data)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const handleReload = async () => {
    setReloading(true)
    setInlineErr(null)
    try {
      onReload()
      if (caps?.reload) {
        await axios.post('/api/reload')
      }
      await fetchStatus()
    } catch (e) {
      onReload()
      setInlineErr(
        '重新加载失败：' + (e instanceof Error ? e.message : String(e)),
      )
    } finally {
      setReloading(false)
    }
  }

  const handleSync = async () => {
    const endpoint = caps?.sync
      ? '/api/sync'
      : caps?.refresh
        ? '/api/refresh'
        : null
    if (!endpoint) {
      setInlineErr(
        '后端缺少同步接口，请重启 dashboard/server（./dashboard/start-dev.sh）',
      )
      return
    }

    setSyncing(true)
    setInlineErr(null)
    try {
      const r = await axios.post<SyncResponse>(endpoint, null, {
        timeout: 200_000,
      })
      await fetchStatus()
      if (r.data.ok) {
        onSyncSuccess?.(deltaToPulse(r.data.delta, r.data.ms))
        onReload()
      } else {
        setInlineErr(r.data.hint || r.data.error || '同步失败')
      }
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.data) {
        const d = e.response.data as SyncResponse
        setInlineErr(d.hint || d.error || '同步失败')
      } else {
        setInlineErr(
          '同步失败：' + (e instanceof Error ? e.message : String(e)),
        )
      }
      await fetchStatus()
    } finally {
      setSyncing(false)
    }
  }

  const csv = status?.files?.usageCsv
  const auth = status?.files?.authJson
  const session = status?.session
  const busy = reloading || syncing
  const legacyServer = caps != null && !caps.dataStatus

  const statusLine = (() => {
    if (legacyServer) return '后端需重启以显示文件状态'
    if (!caps) return '未连接后端'
    if (!csv?.exists) return '尚无本地 CSV（可先同步或 npm run export）'
    const rel = formatRelativeTime(csv.mtimeIso)
    const size = formatBytes(csv.sizeBytes)
    return `CSV ${rel ?? ''}${size ? ` · ${size}` : ''}`.trim()
  })()

  const syncDisabled =
    busy ||
    !caps ||
    (!caps.sync && !caps.refresh) ||
    (caps.dataStatus && (!auth?.exists || session?.expired === true))

  return (
    <div className="flex flex-col items-end gap-1 max-w-[min(100%,22rem)]">
      <div className="flex items-center gap-2">
        <span
          className="hidden lg:inline text-[11px] text-fg-faint max-w-[180px] truncate"
          title={statusLine}
        >
          {statusLine}
        </span>

        <button
          type="button"
          onClick={handleReload}
          disabled={busy || !caps}
          className="btn-ghost"
          title="重新读取本地 CSV 并刷新图表（不访问 Cursor）"
        >
          {reloading ? '…' : '重新加载'}
        </button>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncDisabled}
          className="btn-primary"
          title={
            !caps?.sync && !caps?.refresh
              ? '请重启 dashboard/server'
              : caps?.dataStatus && !auth?.exists
                ? '需先 npm run login'
                : caps?.dataStatus && session?.expired
                  ? '登录已过期，请重新 login'
                  : '从 Cursor 拉取 CSV 并重算（需代理）'
          }
        >
          {syncing ? '同步中…' : '从 Cursor 同步'}
        </button>
      </div>
      {inlineErr && (
        <p
          className="text-[11px] text-danger text-right leading-snug max-w-full"
          role="alert"
          title={inlineErr}
        >
          {inlineErr}
        </p>
      )}
    </div>
  )
}
