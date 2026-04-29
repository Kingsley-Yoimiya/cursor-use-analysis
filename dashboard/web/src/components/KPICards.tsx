/**
 * KPI 概览卡片组件
 * 从 /api/summary 获取数据，展示核心用量指标
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
  accentColor?: string
}

function KPICard({ label, value, sub, valueColor = 'text-slate-800 dark:text-slate-100', accentColor = 'border-l-slate-300 dark:border-l-slate-700' }: KPICardProps) {
  return (
    <div
      className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-5 shadow-sm dark:shadow-lg
        relative overflow-hidden border-l-4 ${accentColor} transition-all hover:bg-slate-50 dark:hover:bg-slate-900/90`}
    >
      <p className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold font-mono tracking-tight ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400 dark:text-slate-600">{sub}</p>}
    </div>
  )
}

// ────────── KPI 卡片区域主组件 ──────────

export function KPICards() {
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    axios
      .get<SummaryResponse>('/api/summary')
      .then((r) => {
        if (r.data.ok && r.data.data) {
          setData(r.data.data)
        } else {
          setError(r.data.error ?? '接口返回异常')
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-600 dark:text-red-400">
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
        <h2 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">KPI 概览</h2>
        {generatedAt && (
          <span className="text-[11px] text-slate-400 dark:text-slate-600">数据生成于 {generatedAt}</span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KPICard
          label="估算 API 总价值"
          value={totals.totalEstimatedUsd != null ? fmtUsd(totals.totalEstimatedUsd) : '—'}
          sub="按公开文档单价计算，不等同于发票"
          valueColor="text-emerald-600 dark:text-emerald-400"
          accentColor="border-l-emerald-500"
        />
        <KPICard
          label="总请求行数"
          value={totals.rows != null ? fmtInt(totals.rows) : '—'}
          sub={`未识别模型：${totals.unknownModelRows ?? 0} 行`}
          valueColor="text-violet-600 dark:text-violet-400"
          accentColor="border-l-violet-500"
        />
        <KPICard
          label="总 Token 消耗"
          value={fmtTokens(totalTokens)}
          sub={`Cache Read ${fmtTokens(totalCacheRead)}`}
          valueColor="text-sky-600 dark:text-sky-400"
          accentColor="border-l-sky-500"
        />
        <KPICard
          label="缓存命中率"
          value={fmtPercent(cacheHitRate)}
          sub="Cache Read / Total Input"
          valueColor={cacheHitRate > 0.7 ? 'text-emerald-600 dark:text-emerald-400' : cacheHitRate > 0.5 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}
          accentColor={cacheHitRate > 0.7 ? 'border-l-emerald-500' : cacheHitRate > 0.5 ? 'border-l-amber-500' : 'border-l-red-500'}
        />
        <KPICard
          label="最高消耗模型"
          value={topModel ? topModel.model : '—'}
          sub={topModel ? `${fmtUsd(topModel.estimatedUsd)} · ${fmtInt(topModel.requests)} 次` : undefined}
          valueColor="text-amber-600 dark:text-amber-400"
          accentColor="border-l-amber-500"
        />
      </div>
    </div>
  )
}
