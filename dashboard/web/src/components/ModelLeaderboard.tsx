/**
 * 模型排行榜
 * 通过 /api/summary 获取 byModel 数据，展示排名、金额、请求数、Cache Hit Rate
 */
import { useEffect, useState } from 'react'
import axios from 'axios'

// ────────── 类型定义 ──────────

interface ModelEntry {
  model: string
  requests: number
  estimatedUsd: number
  tokens: {
    cacheWrite: number
    noCache: number
    cacheRead: number
    output: number
  }
}

interface SummaryData {
  byModel?: ModelEntry[]
}

interface SummaryResponse {
  ok: boolean
  data?: SummaryData
  error?: string
}

type SortKey = 'usd' | 'requests' | 'cacheHitRate'

// ────────── 工具函数 ──────────

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

function calcCacheHitRate(t: ModelEntry['tokens']): number {
  const denom = t.cacheRead + t.cacheWrite + t.noCache
  return denom > 0 ? t.cacheRead / denom : 0
}

// ────────── 主组件 ──────────

export function ModelLeaderboard() {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('usd')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    axios
      .get<SummaryResponse>('/api/summary')
      .then((r) => {
        if (r.data.ok && r.data.data?.byModel) {
          setModels(r.data.data.byModel)
        } else {
          setError(r.data.error ?? '接口返回异常')
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sorted = [...models].sort((a, b) => {
    let diff = 0
    if (sortKey === 'usd') diff = b.estimatedUsd - a.estimatedUsd
    else if (sortKey === 'requests') diff = b.requests - a.requests
    else if (sortKey === 'cacheHitRate') diff = calcCacheHitRate(b.tokens) - calcCacheHitRate(a.tokens)
    return sortAsc ? -diff : diff
  })

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="ml-1 text-slate-300 dark:text-slate-700">↕</span>
    return <span className="ml-1 text-emerald-500">{sortAsc ? '↑' : '↓'}</span>
  }

  const thClass = 'px-4 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500 select-none'
  const thSortClass = `${thClass} cursor-pointer hover:text-slate-600 dark:hover:text-slate-300 transition-colors`

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5">
        <div className="h-6 w-32 animate-pulse rounded bg-slate-100 dark:bg-slate-800 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-50 dark:bg-slate-800/40" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-600 dark:text-red-400">
        加载模型数据失败：{error}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm dark:shadow-lg overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
        <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
          模型排行榜
        </h3>
        <span className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">
          {sorted.length} 个模型
        </span>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              <th className={thClass}>#</th>
              <th className={thClass}>模型</th>
              <th className={thSortClass} onClick={() => handleSort('usd')}>
                总金额 (USD)<SortIcon col="usd" />
              </th>
              <th className={thSortClass} onClick={() => handleSort('requests')}>
                请求数<SortIcon col="requests" />
              </th>
              <th className={thSortClass} onClick={() => handleSort('cacheHitRate')}>
                Cache Hit Rate<SortIcon col="cacheHitRate" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {sorted.map((m, i) => {
              const hitRate = calcCacheHitRate(m.tokens)
              const hitRateColor =
                hitRate > 0.7
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : hitRate > 0.5
                  ? 'text-amber-600 dark:text-amber-400'
                  : hitRate > 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-slate-400 dark:text-slate-600'

              const rankBadge =
                i === 0
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                  : i === 1
                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  : i === 2
                  ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400'
                  : 'bg-transparent text-slate-400 dark:text-slate-600'

              return (
                <tr
                  key={m.model}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                >
                  <td className="px-4 py-3 w-10">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${rankBadge}`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-slate-700 dark:text-slate-200 break-all">
                      {m.model}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    {fmtUsd(m.estimatedUsd)}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {fmtInt(m.requests)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {/* 进度条 */}
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 min-w-[60px]">
                        <div
                          className={`h-full rounded-full ${
                            hitRate > 0.7
                              ? 'bg-emerald-500'
                              : hitRate > 0.5
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(hitRate * 100, 100)}%` }}
                        />
                      </div>
                      <span className={`font-mono text-xs font-medium whitespace-nowrap ${hitRateColor}`}>
                        {hitRate > 0 ? `${(hitRate * 100).toFixed(1)}%` : '—'}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-slate-400 dark:text-slate-600">
          暂无数据
        </div>
      )}
    </div>
  )
}
