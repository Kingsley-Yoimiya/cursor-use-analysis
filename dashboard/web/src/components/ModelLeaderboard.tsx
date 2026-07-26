/**
 * 模型排行榜
 * 通过 /api/summary 获取 byModel 数据，展示排名、金额、请求数、Cache Hit Rate
 */
import { useEffect, useState } from 'react'
import axios from 'axios'
import { mergeSummaryByModel, type FoldModelEntry } from '../lib/mergeDaily'

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

export function ModelLeaderboard({
  refreshKey,
  foldPluginIds = [],
}: {
  refreshKey?: number
  foldPluginIds?: string[]
}) {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('usd')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    setLoading(true)
    const load = async () => {
      const r = await axios.get<SummaryResponse>('/api/summary')
      if (!r.data.ok || !r.data.data?.byModel) {
        setError(r.data.error ?? '接口返回异常')
        setModels([])
        return
      }
      let byModel = r.data.data.byModel as FoldModelEntry[]
      if (foldPluginIds.length > 0) {
        const extras = await Promise.all(
          foldPluginIds.map((id) =>
            axios
              .get<{ ok: boolean; data?: { byModel?: FoldModelEntry[] } }>(
                `/api/plugins/${id}/cursor-summary`,
              )
              .then((x) => (x.data.ok ? x.data.data?.byModel : null))
              .catch(() => null),
          ),
        )
        for (const ex of extras) {
          if (ex) byModel = mergeSummaryByModel(byModel, ex)
        }
      }
      setModels(byModel as ModelEntry[])
      setError(null)
    }
    load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [refreshKey, foldPluginIds.join('|')])

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
    if (sortKey !== col) return <span className="ml-1 text-fg-faint">↕</span>
    return <span className="ml-1 text-accent">{sortAsc ? '↑' : '↓'}</span>
  }

  const thClass = 'px-4 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-fg-faint select-none'
  const thSortClass = `${thClass} cursor-pointer hover:text-fg transition-colors`

  if (loading) {
    return (
      <div className="rounded-xl border border-line bg-surface/60 p-5">
        <div className="h-6 w-32 animate-pulse rounded bg-surface-2 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
        加载模型数据失败：{error}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-surface/60 shadow-theme overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-line-subtle">
        <h3 className="text-xs font-medium uppercase tracking-widest text-fg-faint">
          模型排行榜
        </h3>
        <span className="text-[11px] text-fg-faint font-mono">
          {sorted.length} 个模型
        </span>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2">
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
          <tbody className="divide-y divide-line-subtle">
            {sorted.map((m, i) => {
              const hitRate = calcCacheHitRate(m.tokens)
              const hitRateColor =
                hitRate > 0.7
                  ? 'text-accent'
                  : hitRate > 0.5
                  ? 'text-warning'
                  : hitRate > 0
                  ? 'text-danger'
                  : 'text-fg-faint'

              const rankBadge =
                i === 0
                  ? 'bg-warning-soft text-warning'
                  : i === 1
                  ? 'bg-surface-2 text-fg-muted'
                  : i === 2
                  ? 'bg-accent-soft text-accent-muted'
                  : 'bg-transparent text-fg-faint'

              return (
                <tr
                  key={m.model}
                  className="hover:bg-surface-2 transition-colors"
                >
                  <td className="px-4 py-3 w-10">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${rankBadge}`}>
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-fg break-all">
                      {m.model}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm font-semibold text-accent whitespace-nowrap">
                    {fmtUsd(m.estimatedUsd)}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-fg whitespace-nowrap">
                    {fmtInt(m.requests)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {/* 进度条 */}
                      <div className="flex-1 h-1.5 rounded-full bg-surface-2 min-w-[60px]">
                        <div
                          className={`h-full rounded-full ${
                            hitRate > 0.7
                              ? 'bg-accent'
                              : hitRate > 0.5
                              ? 'bg-warning'
                              : 'bg-danger'
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
        <div className="px-5 py-8 text-center text-sm text-fg-faint">
          暂无数据
        </div>
      )}
    </div>
  )
}
