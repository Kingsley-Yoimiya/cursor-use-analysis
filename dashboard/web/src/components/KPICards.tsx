/**
 * KPI 概览卡片组件
 * 从 /api/summary 获取数据，展示核心用量指标
 * 同步成功时可在价值 / 行数卡片上短暂展示增量动向
 */
import { useEffect, useState } from 'react'
import axios from 'axios'
import { mergeSummaryByModel, type FoldModelEntry } from '../lib/mergeDaily'
import { fmtElapsed, fmtTokens } from '../lib/formatTokens'
import type { SyncPulse } from '../lib/syncPulse'

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

function fmtPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

// ────────── 迷你 Sparkline 趋势组件 ──────────

function Sparkline({
  data,
  color = '#10b981',
  height = 32,
}: {
  data?: number[]
  color?: string
  height?: number
}) {
  if (!data || data.length < 2) return null
  const width = 110
  const max = Math.max(...data, 0.0001)
  const min = Math.min(...data)
  const range = max - min || 1

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width
    const y = height - ((val - min) / range) * (height - 6) - 3
    return { x, y }
  })

  const pathD = points.reduce(
    (acc, p, i) => (i === 0 ? `M ${p.x},${p.y}` : `${acc} L ${p.x},${p.y}`),
    '',
  )
  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`
  const gradId = `sparkline-${Math.random().toString(36).substring(2, 7)}`

  return (
    <svg className="w-24 h-8 shrink-0 overflow-visible opacity-90" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ────────── Nordic 极简单张 KPI 卡片 ──────────

interface KPICardProps {
  label: string
  value: string
  sub?: string
  valueColor?: string
  tone?: string
  delta?: string | null
  sparklineData?: number[]
  sparklineColor?: string
}

function KPICard({
  label,
  value,
  sub,
  valueColor = 'text-fg',
  tone = '#10b981',
  hero = false,
  delta = null,
  sparklineData,
  sparklineColor,
}: KPICardProps & { hero?: boolean }) {
  return (
    <div
      className="p-4 md:p-5 bg-surface border border-line rounded-xl shadow-sm hover:border-line/80 transition-all flex flex-col justify-between"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">{label}</p>
          <p
            className={`mt-1 font-mono tracking-tight font-bold ${hero ? 'text-2xl md:text-3xl' : 'text-xl md:text-2xl'} ${valueColor}`}
          >
            {value}
          </p>
        </div>
        {sparklineData && sparklineData.length > 1 && (
          <div className="pt-1">
            <Sparkline data={sparklineData} color={sparklineColor || tone} />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/50 pt-2 text-xs">
        {sub && <p className="text-[11px] text-fg-muted font-medium truncate">{sub}</p>}
        {delta ? (
          <span key={delta} className="kpi-delta shrink-0" role="status">
            {delta}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// ────────── KPI 卡片区域主组件 ──────────

const PULSE_HOLD_MS = 20_000

export function KPICards({
  refreshKey,
  foldPluginIds = [],
  syncPulse = null,
  profilesQuery,
  profilesKey,
  daily = null,
}: {
  refreshKey?: number
  foldPluginIds?: string[]
  syncPulse?: SyncPulse | null
  profilesQuery?: string
  profilesKey?: string
  daily?: any[] | null
}) {
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activePulse, setActivePulse] = useState<SyncPulse | null>(null)

  useEffect(() => {
    if (!syncPulse) return
    setActivePulse(syncPulse)
    const t = window.setTimeout(() => {
      setActivePulse((prev) => (prev?.id === syncPulse.id ? null : prev))
    }, PULSE_HOLD_MS)
    return () => window.clearTimeout(t)
  }, [syncPulse])

  useEffect(() => {
    setLoading(true)
    const load = async () => {
      const r = await axios.get<SummaryResponse>('/api/summary', {
        params: profilesQuery ? { profiles: profilesQuery } : undefined,
      })
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
  }, [refreshKey, foldPluginIds.join('|'), profilesKey, profilesQuery])

  if (loading) {
    return (
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="h-28 animate-pulse panel bg-surface-2 lg:col-span-4" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 lg:col-span-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse panel bg-surface-2" />
          ))}
        </div>
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
    (sum, m) =>
      sum +
      m.tokens.cacheRead +
      m.tokens.noCache +
      m.tokens.cacheWrite +
      m.tokens.output,
    0,
  )
  const totalCacheRead = models.reduce((sum, m) => sum + m.tokens.cacheRead, 0)
  const totalInput = models.reduce(
    (sum, m) =>
      sum + m.tokens.cacheRead + m.tokens.noCache + m.tokens.cacheWrite,
    0,
  )
  const cacheHitRate = totalInput > 0 ? totalCacheRead / totalInput : 0

  const topModel =
    models.length > 0
      ? models.reduce((a, b) => (a.estimatedUsd > b.estimatedUsd ? a : b))
      : null

  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
      })
    : null

  const elapsed = activePulse
    ? fmtElapsed(activePulse.elapsedMs)
    : ''

  const fmtUsdDelta = (n: number) => {
    const sign = n >= 0 ? '+' : ''
    return `${sign}$${Math.abs(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  let valueDelta: string | null = null
  let rowsDelta: string | null = null
  let tokenDelta: string | null = null
  if (activePulse) {
    const timePart = elapsed ? `距上次 ${elapsed}` : ''
    if (activePulse.firstSync) {
      valueDelta = [
        `已同步`,
        activePulse.totalUsd > 0 ? fmtUsd(activePulse.totalUsd) : null,
        fmtTokens(activePulse.totalTokens || totalTokens),
      ]
        .filter(Boolean)
        .join(' · ')
      rowsDelta = '首次同步'
      tokenDelta = fmtTokens(activePulse.totalTokens || totalTokens)
    } else if (
      activePulse.addedUsd <= 0 &&
      activePulse.addedTokens <= 0 &&
      activePulse.addedRows <= 0
    ) {
      valueDelta = timePart ? `${timePart} · 无新增` : '无新增用量'
      rowsDelta = '+0'
      tokenDelta = '+0'
    } else {
      const parts = [
        fmtUsdDelta(activePulse.addedUsd),
        `+${fmtTokens(activePulse.addedTokens)}`,
        timePart || null,
      ].filter(Boolean)
      if (activePulse.addonUsd > 0) {
        parts.push(`含附加 ${fmtUsdDelta(activePulse.addonUsd)}`)
      }
      valueDelta = parts.join(' · ')
      rowsDelta = `+${fmtInt(activePulse.addedRows)}`
      tokenDelta = `+${fmtTokens(activePulse.addedTokens)}`
    }
  }

  const costTrend = daily ? daily.map((d) => d.cost || 0) : []
  const tokenTrend = daily ? daily.map((d) => d.totalTokens || 0) : []
  const rowTrend = daily ? daily.map((d) => d.rows || 0) : []
  const cacheRateTrend = daily
    ? daily.map((d) =>
        d.cacheRead + d.inputNoCache > 0
          ? d.cacheRead / (d.cacheRead + d.inputNoCache)
          : 0,
      )
    : []

  const avgCostPerReq = totals.rows && totals.rows > 0 && totals.totalEstimatedUsd
    ? totals.totalEstimatedUsd / totals.rows
    : 0

  const avgCostTrend = daily
    ? daily.map((d) => (d.rows > 0 ? d.cost / d.rows : 0))
    : []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="section-title">核心 KPI 概览</h2>
        {generatedAt && (
          <span className="text-[11px] text-fg-faint">
            数据生成于 {generatedAt}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        {/* Total USD 主高亮卡片 */}
        <div className="lg:col-span-4">
          <KPICard
            hero
            label="Total Estimated Cost"
            value={
              totals.totalEstimatedUsd != null
                ? fmtUsd(totals.totalEstimatedUsd)
                : '—'
            }
            sub="估算 API 总消耗价值 (USD)"
            valueColor="text-emerald-600 dark:text-emerald-400"
            tone="#10b981"
            delta={valueDelta}
            sparklineData={costTrend}
            sparklineColor="#10b981"
          />
        </div>

        {/* 4 核心分项卡片网格 */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 lg:col-span-8">
          <KPICard
            label="Total Tokens Used"
            value={fmtTokens(totalTokens)}
            sub={`Cache Read ${fmtTokens(totalCacheRead)}`}
            valueColor="text-blue-600 dark:text-blue-400"
            tone="#3b82f6"
            delta={tokenDelta}
            sparklineData={tokenTrend}
            sparklineColor="#3b82f6"
          />
          <KPICard
            label="Request Count"
            value={totals.rows != null ? fmtInt(totals.rows) : '—'}
            sub={`未识别模型：${totals.unknownModelRows ?? 0} 行`}
            valueColor="text-fg"
            tone="#8b5cf6"
            delta={rowsDelta}
            sparklineData={rowTrend}
            sparklineColor="#8b5cf6"
          />
          <KPICard
            label="Model Breakdown"
            value={`${models.length} Models`}
            sub={topModel ? `Top: ${topModel.model}` : 'Active Models'}
            valueColor="text-fg"
            tone="#f59e0b"
          />
          <KPICard
            label="Avg Cost / Request"
            value={`$${avgCostPerReq.toFixed(4)}`}
            sub="平均单次请求成本"
            valueColor="text-fg"
            tone="#ef4444"
            sparklineData={avgCostTrend}
            sparklineColor="#ef4444"
          />
        </div>
      </div>
    </div>
  )
}
