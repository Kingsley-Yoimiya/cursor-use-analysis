/**
 * 分模型每日用量趋势图
 * 支持 USD / Tokens 切换，自动取 Top N 模型，其余归入"其他"
 */
import { useState, useMemo } from 'react'
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

interface DailyEntry {
  date: string
  costByModel: Record<string, number>
  tokensByModel: Record<string, number>
}

type ViewMode = 'usd' | 'tokens'

// ────────── 颜色调色盘 ──────────

const PALETTE = [
  '#f59e0b', // amber-400
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#10b981', // emerald-500
  '#f43f5e', // rose-500
  '#84cc16', // lime-500
  '#fb923c', // orange-400
  '#60a5fa', // blue-400
  '#e879f9', // fuchsia-400
  '#34d399', // emerald-400
]
const OTHERS_COLOR = '#64748b' // slate-500

const MAX_MODELS = 8

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
  const sorted = [...payload].reverse().filter((p) => p.value > 0)
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-xl text-xs min-w-[180px] max-h-64 overflow-y-auto">
      <p className="mb-2 font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {sorted.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 mb-0.5">
          <span className="truncate max-w-[120px]" style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono text-slate-700 dark:text-slate-300 shrink-0">
            {mode === 'usd' ? `$${p.value.toFixed(3)}` : fmtTok(p.value)}
          </span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-slate-200 dark:border-slate-800 pt-1 flex justify-between">
        <span className="text-slate-400 dark:text-slate-500">合计</span>
        <span className="font-mono text-slate-800 dark:text-slate-200">
          {mode === 'usd' ? `$${total.toFixed(3)}` : fmtTok(total)}
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
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-3 px-2">
      {payload.map((entry) => (
        <span key={entry.value} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 max-w-[180px]">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="truncate">{entry.value}</span>
        </span>
      ))}
    </div>
  )
}

// ────────── 主组件 ──────────

interface ModelDetailedChartProps {
  daily: DailyEntry[] | null
}

export function ModelDetailedChart({ daily }: ModelDetailedChartProps) {
  const [mode, setMode] = useState<ViewMode>('usd')
  const isDark = useIsDark()
  const gridColor = isDark ? '#1e293b' : '#e2e8f0'
  const tickColor = isDark ? '#64748b' : '#94a3b8'

  // 计算各模型总量，取 Top N
  const topModels = useMemo(() => {
    if (!daily) return []
    const totals: Record<string, number> = {}
    daily.forEach((d) => {
      const byModel = mode === 'usd' ? (d.costByModel ?? {}) : (d.tokensByModel ?? {})
      Object.entries(byModel).forEach(([m, v]) => {
        totals[m] = (totals[m] ?? 0) + v
      })
    })
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_MODELS)
      .map(([m]) => m)
  }, [daily, mode])

  const hasOthers = useMemo(() => {
    if (!daily) return false
    const allModels = new Set<string>()
    daily.forEach((d) => {
      Object.keys(mode === 'usd' ? (d.costByModel ?? {}) : (d.tokensByModel ?? {})).forEach((m) => allModels.add(m))
    })
    return allModels.size > MAX_MODELS
  }, [daily, mode])

  const chartData = useMemo(() => {
    if (!daily) return []
    return daily.map((d) => {
      const byModel = mode === 'usd' ? (d.costByModel ?? {}) : (d.tokensByModel ?? {})
      const entry: Record<string, number | string> = { date: fmtDate(d.date) }
      let othersTotal = 0
      Object.entries(byModel).forEach(([m, v]) => {
        if (topModels.includes(m)) {
          entry[m] = (entry[m] as number ?? 0) + v
        } else {
          othersTotal += v
        }
      })
      topModels.forEach((m) => {
        if (entry[m] === undefined) entry[m] = 0
      })
      if (hasOthers) entry['其他'] = othersTotal
      return entry
    })
  }, [daily, mode, topModels, hasOthers])

  if (!daily) {
    return (
      <div className="h-80 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800" />
    )
  }

  if (daily.length === 0 || topModels.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 flex items-center justify-center h-40">
        <p className="text-slate-400 dark:text-slate-500 text-sm">暂无数据</p>
      </div>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTooltip = (props: any) => (
    <CustomTooltip
      active={props.active}
      payload={props.payload}
      label={props.label}
      mode={mode}
    />
  )

  const allKeys = [...topModels, ...(hasOthers ? ['其他'] : [])]

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-sm dark:shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
          每日各模型消耗细分（Top {topModels.length}）
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

      <ResponsiveContainer width="100%" height={320}>
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
            tickFormatter={(v: number) => mode === 'usd' ? `$${v.toFixed(2)}` : fmtTok(v)}
            width={60}
          />
          <Tooltip content={renderTooltip} cursor={{ fill: isDark ? '#1e293b55' : '#e2e8f055' }} />
          <Legend content={<CustomLegend />} />

          {allKeys.map((model, i) => (
            <Bar
              key={model}
              dataKey={model}
              name={model}
              stackId="a"
              fill={model === '其他' ? OTHERS_COLOR : PALETTE[i % PALETTE.length]}
              radius={i === allKeys.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
