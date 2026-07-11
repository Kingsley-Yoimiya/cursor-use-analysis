/**
 * 每日消耗细分柱状图（按池类型：Auto / First-party / API）
 * 支持 USD 与 Tokens 两种视图切换
 */
import { useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useIsDark } from '../context/ThemeContext'

// ────────── 类型定义 ──────────

interface PoolValues {
  Auto: number
  FirstParty: number
  API: number
}

interface DailyEntry {
  date: string
  totalTokens: number
  costByPool: PoolValues
  tokensByPool: PoolValues
}

type ViewMode = 'usd' | 'tokens'

// ────────── 颜色配置 ──────────

const POOL_COLORS: Record<keyof PoolValues, string> = {
  Auto: '#f59e0b',
  FirstParty: '#8b5cf6',
  API: '#06b6d4',
}

const POOLS = ['Auto', 'FirstParty', 'API'] as const

const POOL_LABELS: Record<(typeof POOLS)[number], string> = {
  Auto: 'Auto',
  FirstParty: 'First-party',
  API: 'API',
}

// ────────── 工具函数 ──────────

function fmtDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[1]}/${parts[2]}`
}

function fmtTok(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

// ────────── 自定义 Tooltip ──────────

interface TooltipPayloadItem {
  value: number
  dataKey: string
  color: string
  name: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: readonly TooltipPayloadItem[]
  label?: string
  mode: ViewMode
}

function CustomTooltip({ active, payload, label, mode }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-xl text-xs min-w-[160px]">
      <p className="mb-2 font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 mb-0.5">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono text-slate-700 dark:text-slate-300">
            {mode === 'usd' ? `$${p.value.toFixed(4)}` : fmtTok(p.value)}
          </span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-slate-200 dark:border-slate-800 pt-1 flex justify-between">
        <span className="text-slate-400 dark:text-slate-500">合计</span>
        <span className="font-mono text-slate-800 dark:text-slate-200">
          {mode === 'usd' ? `$${total.toFixed(4)}` : fmtTok(total)}
        </span>
      </div>
    </div>
  )
}

// ────────── 自定义图例 ──────────

interface LegendPayloadItem {
  color: string
  value: string
}

function CustomLegend({ payload }: { payload?: LegendPayloadItem[] }) {
  if (!payload) return null
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-2">
      {payload.map((entry) => (
        <span key={entry.value} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          {entry.value}
        </span>
      ))}
    </div>
  )
}

// ────────── 主组件 ──────────

interface ModelUsageChartProps {
  daily: DailyEntry[] | null
}

export function ModelUsageChart({ daily }: ModelUsageChartProps) {
  const [mode, setMode] = useState<ViewMode>('usd')
  const isDark = useIsDark()
  const gridColor = isDark ? '#1e293b' : '#e2e8f0'
  const tickColor = isDark ? '#64748b' : '#94a3b8'

  if (!daily) {
    return (
      <div className="h-72 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800" />
    )
  }

  const chartData = daily.map((d) => ({
    date: fmtDate(d.date),
    Auto: mode === 'usd' ? (d.costByPool?.Auto ?? 0) : (d.tokensByPool?.Auto ?? 0),
    FirstParty: mode === 'usd' ? (d.costByPool?.FirstParty ?? 0) : (d.tokensByPool?.FirstParty ?? 0),
    API: mode === 'usd' ? (d.costByPool?.API ?? 0) : (d.tokensByPool?.API ?? 0),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTooltip = (props: any) => (
    <CustomTooltip
      active={props.active}
      payload={props.payload}
      label={props.label}
      mode={mode}
    />
  )

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-sm dark:shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
          每日消耗细分（Auto / First-party / API）
        </h3>
        <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 text-xs">
          <button
            onClick={() => setMode('usd')}
            className={`px-3 py-1 transition-colors ${
              mode === 'usd'
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            USD
          </button>
          <button
            onClick={() => setMode('tokens')}
            className={`px-3 py-1 transition-colors ${
              mode === 'tokens'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            Tokens
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: tickColor, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: tickColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) =>
              mode === 'usd' ? `$${v.toFixed(2)}` : fmtTok(v)
            }
            width={60}
          />
          <Tooltip content={renderTooltip} cursor={{ fill: isDark ? '#1e293b55' : '#e2e8f055' }} />
          <Legend content={<CustomLegend />} />

          {POOLS.map((pool, i) => (
            <Bar
              key={pool}
              dataKey={pool}
              name={POOL_LABELS[pool]}
              stackId="a"
              fill={POOL_COLORS[pool]}
              radius={i === POOLS.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
