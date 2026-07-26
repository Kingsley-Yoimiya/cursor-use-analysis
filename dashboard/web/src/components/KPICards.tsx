/**
 * KPI 概览卡片组件
 * 从 /api/summary 获取数据，展示核心用量指标
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
  generatedAt?: string
  totals?: {
    rows?: number
    unknownModelRows?: number
    totalEstimatedUsd?: number
  }
  byModel?: ModelEntry[]
}

interface SummaryResponse {
  ok: boolean
  data?: SummaryData
  ms?: number
  error?: string
}

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

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

// ────────── 单张 KPI 卡片 ──────────

interface KPICardProps {
  label: string
  value: string
  sub?: string
  valueColor?: string
  tone?: string
}

function KPICard({
  label,
  value,
  sub,
  valueColor = 'text-fg',
  tone = 'var(--accent)',
}: KPICardProps) {
  return (
    <div className="kpi-card" style={{ ['--kpi-tone' as string]: tone }}>
      <p className="text-xs font-medium uppercase tracking-widest text-fg-faint">{label}</p>
      <p className={`mt-2 text-2xl font-bold font-mono tracking-tight ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-fg-faint">{sub}</p>}
    </div>
  )
}

// ────────── KPI 卡片区域主组件 ──────────

export function KPICards({
  refreshKey,
  foldPluginIds = [],
}: {
  refreshKey?: number
  foldPluginIds?: string[]
}) {
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const load = async () => {
      const r = await axios.get<SummaryResponse>('/api/summary')
      if (!r.data.ok || !r.data.data) {
        setError(r.data.error ?? '接口返回异常')
        setData(null)
        return
      }
      let next = r.data.data
      if (foldPluginIds.length > 0) {
        const extras = await Promise.all(
          foldPluginIds.map((id) =>
            axios
              .get<{ ok: boolean; data?: SummaryData }>(
                `/api/plugins/${id}/cursor-summary`,
              )
              .then((x) => (x.data.ok ? x.data.data : null))
              .catch(() => null),
          ),
        )
        let byModel = (next.byModel || []) as FoldModelEntry[]
        let usd = next.totals?.totalEstimatedUsd ?? 0
        let rows = next.totals?.rows ?? 0
        let unknown = next.totals?.unknownModelRows ?? 0
        for (const ex of extras) {
          if (!ex) continue
          byModel = mergeSummaryByModel(byModel, ex.byModel as FoldModelEntry[])
          usd += ex.totals?.totalEstimatedUsd ?? 0
          rows += ex.totals?.rows ?? 0
          unknown += ex.totals?.unknownModelRows ?? 0
        }
        next = {
          ...next,
          byModel: byModel as ModelEntry[],
          totals: {
            ...next.totals,
            totalEstimatedUsd: usd,
            rows,
            unknownModelRows: unknown,
          },
        }
      }
      setData(next)
      setError(null)
    }
    load()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [refreshKey, foldPluginIds.join('|')])

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-surface-2 border border-line" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
        加载摘要失败：{error}
      </div>
    )
  }

  if (!data) return null

  const totals = data.totals ?? {}
  const models = data.byModel ?? []

  const totalTokens = models.reduce(
    (sum, m) => sum + m.tokens.cacheRead + m.tokens.noCache + m.tokens.cacheWrite + m.tokens.output,
    0,
  )
  const totalCacheRead = models.reduce((sum, m) => sum + m.tokens.cacheRead, 0)
  const totalInput = models.reduce(
    (sum, m) => sum + m.tokens.cacheRead + m.tokens.noCache + m.tokens.cacheWrite,
    0,
  )
  const cacheHitRate = totalInput > 0 ? totalCacheRead / totalInput : 0

  const topModel = models.length > 0
    ? models.reduce((a, b) => (a.estimatedUsd > b.estimatedUsd ? a : b))
    : null

  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-widest text-fg-faint">KPI 概览</h2>
        {generatedAt && (
          <span className="text-[11px] text-fg-faint">数据生成于 {generatedAt}</span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KPICard
          label="估算 API 总价值"
          value={totals.totalEstimatedUsd != null ? fmtUsd(totals.totalEstimatedUsd) : '—'}
          sub="按公开文档单价计算，不等同于发票"
          valueColor="text-accent"
          tone="var(--accent)"
        />
        <KPICard
          label="总请求行数"
          value={totals.rows != null ? fmtInt(totals.rows) : '—'}
          sub={`未识别模型：${totals.unknownModelRows ?? 0} 行`}
          valueColor="text-violet"
          tone="var(--violet)"
        />
        <KPICard
          label="总 Token 消耗"
          value={fmtTokens(totalTokens)}
          sub={`Cache Read ${fmtTokens(totalCacheRead)}`}
          valueColor="text-info"
          tone="var(--info)"
        />
        <KPICard
          label="缓存命中率"
          value={fmtPercent(cacheHitRate)}
          sub="Cache Read / Total Input"
          valueColor={cacheHitRate > 0.7 ? 'text-accent' : cacheHitRate > 0.5 ? 'text-warning' : 'text-danger'}
          tone={
            cacheHitRate > 0.7
              ? 'var(--accent)'
              : cacheHitRate > 0.5
                ? 'var(--warning)'
                : 'var(--danger)'
          }
        />
        <KPICard
          label="最高消耗模型"
          value={topModel ? topModel.model : '—'}
          sub={topModel ? `${fmtUsd(topModel.estimatedUsd)} · ${fmtInt(topModel.requests)} 次` : undefined}
          valueColor="text-warning"
          tone="var(--warning)"
        />
      </div>
    </div>
  )
}
