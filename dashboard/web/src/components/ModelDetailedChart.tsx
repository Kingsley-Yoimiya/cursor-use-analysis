/**
 * 分模型每日用量趋势图
 * 支持 USD / Tokens 切换，自动取 Top N 模型，其余归入"其他"
 */
import { useMemo, useState } from 'react'
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
import { useChartColors } from '../context/ThemeContext'

// ────────── 类型定义 ──────────

interface DailyEntry {
  date: string
  costByModel: Record<string, number>
  tokensByModel: Record<string, number>
}

type ViewMode = 'usd' | 'tokens'

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
    <div className="rounded-lg border border-line bg-elevated px-3 py-2 shadow-theme text-xs min-w-[180px] max-h-64 overflow-y-auto">
      <p className="mb-2 font-medium text-fg-muted">{label}</p>
      {sorted.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 mb-0.5">
          <span className="truncate max-w-[120px]" style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono text-fg shrink-0">
            {mode === 'usd' ? `$${p.value.toFixed(3)}` : fmtTok(p.value)}
          </span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-line pt-1 flex justify-between">
        <span className="text-fg-faint">合计</span>
        <span className="font-mono text-fg">
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
        <span key={entry.value} className="flex items-center gap-1.5 text-[11px] text-fg-muted max-w-[180px]">
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
  const chartColors = useChartColors()
  const palette = useMemo(
    () => [
      chartColors.poolAuto,
      chartColors.poolFirst,
      chartColors.poolApi,
      chartColors.chart1,
      chartColors.chart4,
      chartColors.chart3,
      chartColors.chart2,
      chartColors.chart5,
      chartColors.accent,
      chartColors.muted,
    ],
    [chartColors],
  )
  const othersColor = chartColors.muted

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
      <div className="h-80 animate-pulse rounded-xl bg-surface-2 border border-line" />
    )
  }

  if (daily.length === 0 || topModels.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface/60 p-5 flex items-center justify-center h-40">
        <p className="text-fg-faint text-sm">暂无数据</p>
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
    <div className="rounded-xl border border-line bg-surface/60 p-5 shadow-theme">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-medium uppercase tracking-widest text-fg-faint">
          每日各模型消耗细分（Top {topModels.length}）
        </h3>
        <div className="flex rounded-lg overflow-hidden border border-line text-xs">
          <button
            onClick={() => setMode('usd')}
            className={`px-3 py-1 transition-colors ${
              mode === 'usd'
                ? 'bg-accent text-accent-fg'
                : 'bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface'
            }`}
          >
            USD
          </button>
          <button
            onClick={() => setMode('tokens')}
            className={`px-3 py-1 transition-colors ${
              mode === 'tokens'
                ? 'bg-info text-white'
                : 'bg-surface-2 text-fg-muted hover:text-fg hover:bg-surface'
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
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: chartColors.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: chartColors.grid }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: chartColors.tick, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => mode === 'usd' ? `$${v.toFixed(2)}` : fmtTok(v)}
            width={60}
          />
          <Tooltip content={renderTooltip} cursor={{ fill: chartColors.cursor }} />
          <Legend content={<CustomLegend />} />

          {allKeys.map((model, i) => (
            <Bar
              key={model}
              dataKey={model}
              name={model}
              stackId="a"
              fill={model === '其他' ? othersColor : palette[i % palette.length]}
              radius={i === allKeys.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
