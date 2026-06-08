import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import axios from 'axios'

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

interface SyncResponse {
  ok: boolean
  ms?: number
  hint?: string
  error?: string
  detail?: string
  steps?: { id: string; ok: boolean; ms: number }[]
  partial?: boolean
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

function showNotice(
  setBanner: Dispatch<
    SetStateAction<{ kind: 'ok' | 'err' | 'info'; text: string } | null>
  >,
  kind: 'ok' | 'err' | 'info',
  text: string,
) {
  setBanner({ kind, text })
  window.setTimeout(() => {
    setBanner((prev) => (prev?.text === text ? null : prev))
  }, kind === 'err' ? 12000 : 5000)
}

export function DataSyncBar({ onReload }: { onReload: () => void }) {
  const [status, setStatus] = useState<DataStatus | null>(null)
  const [caps, setCaps] = useState<ServerCaps | null>(null)
  const [reloading, setReloading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [banner, setBanner] = useState<{
    kind: 'ok' | 'err' | 'info'
    text: string
  } | null>(null)

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
    setBanner(null)
    try {
      onReload()
      if (caps?.reload) {
        await axios.post('/api/reload')
      }
      await fetchStatus()
      showNotice(setBanner, 'ok', '已重新加载图表数据')
    } catch (e) {
      onReload()
      showNotice(
        setBanner,
        'err',
        '重新加载失败：' + (e instanceof Error ? e.message : String(e)),
      )
    } finally {
      setReloading(false)
    }
  }

  const handleSync = async () => {
    const endpoint = caps?.sync ? '/api/sync' : caps?.refresh ? '/api/refresh' : null
    if (!endpoint) {
      showNotice(
        setBanner,
        'err',
        '后端缺少同步接口，请重启 dashboard/server（./dashboard/start-dev.sh）',
      )
      return
    }

    setSyncing(true)
    setBanner(null)
    try {
      const r = await axios.post<SyncResponse>(endpoint, null, {
        timeout: 200_000,
      })
      await fetchStatus()
      if (r.data.ok) {
        onReload()
        const ms = r.data.ms != null ? `${(r.data.ms / 1000).toFixed(1)}s` : ''
        showNotice(
          setBanner,
          'ok',
          `已从 Cursor 同步${ms ? `（${ms}）` : ''}`,
        )
      } else {
        showNotice(
          setBanner,
          'err',
          r.data.hint || r.data.error || '同步失败',
        )
      }
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.data) {
        const d = e.response.data as SyncResponse
        showNotice(setBanner, 'err', d.hint || d.error || '同步失败')
      } else {
        showNotice(
          setBanner,
          'err',
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
    <>
      <div className="flex items-center gap-2">
        <span
          className="hidden lg:inline text-[11px] text-slate-400 dark:text-slate-500 max-w-[180px] truncate"
          title={statusLine}
        >
          {statusLine}
        </span>

        <button
          type="button"
          onClick={handleReload}
          disabled={busy || !caps}
          className="flex items-center h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700
            bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300
            hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium
            disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          title="重新读取本地 CSV 并刷新图表（不访问 Cursor）"
        >
          {reloading ? '…' : '重新加载'}
        </button>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncDisabled}
          className="flex items-center h-8 px-2.5 rounded-lg border border-emerald-600/40
            bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300
            hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-medium
            disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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

      {banner && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-md px-4 py-3 rounded-lg shadow-lg border text-sm ${
            banner.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : banner.kind === 'err'
                ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
          }`}
          role="status"
        >
          {banner.text}
        </div>
      )}
    </>
  )
}
