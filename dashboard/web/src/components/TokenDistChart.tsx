/**
 * 每日 Token 消耗分布堆叠柱状图
 * 颜色语义：
 *   - cacheRead (缓存命中)：chart2，最节省，高亮
 *   - inputCacheWrite (缓存写入)：chart3
 *   - inputNoCache (无缓存输入)：chart4，未命中，需关注
 *   - outputTokens (输出)：chart5
 */
import { useMemo } from 'react'
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
  totalTokens: number
  cacheRead: number
  inputCacheWrite: number
  inputNoCache: number
  outputTokens: number
  cost: number
  rows: number
}

type ColorKey = 'cacheRead' | 'inputCacheWrite' | 'inputNoCache' | 'outputTokens'

const LABELS: Record<ColorKey, string> = {
  cacheRead: 'Cache Read',
  inputCacheWrite: 'Cache Write',
  inputNoCache: 'No-Cache Input',
  outputTokens: 'Output',
}

// ────────── 自定义 Tooltip ──────────

interface TooltipPayloadItem {
  value: number
  dataKey: ColorKey
  color: string
  name: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <div className="rounded-lg border border-line bg-elevated px-3 py-2 shadow-theme text-xs min-w-[160px]">
      <p className="mb-2 font-medium text-fg-muted">{label}</p>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 mb-0.5">
          <span style={{ color: p.color }}>{LABELS[p.dataKey] ?? p.name}</span>
          <span className="font-mono text-fg">{fmtTok(p.value)}</span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-line pt-1 flex justify-between">
        <span className="text-fg-faint">合计</span>
        <span className="font-mono text-fg">{fmtTok(total)}</span>
      </div>
    </div>
  )
}

// ────────── 图例渲染 ──────────

interface LegendPayloadItem {
  color: string
  value: string
  dataKey?: string
}

function CustomLegend({ payload }: { payload?: LegendPayloadItem[] }) {
  if (!payload) return null
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-2">
      {payload.map((entry) => (
        <span key={entry.value} className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          {LABELS[entry.value as ColorKey] ?? entry.value}
        </span>
      ))}
    </div>
  )
}

function fmtDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[1]}/${parts[2]}`
}

// ────────── 主组件 ──────────

interface TokenDistChartProps {
  daily: DailyEntry[] | null
}

export function TokenDistChart({ daily }: TokenDistChartProps) {
  const chartColors = useChartColors()
  const colors = useMemo(
    () => ({
      cacheRead: chartColors.chart2,
      inputCacheWrite: chartColors.chart3,
      inputNoCache: chartColors.chart4,
      outputTokens: chartColors.chart5,
    }),
    [chartColors],
  )

  if (!daily) {
    return (
      <div className="h-64 animate-pulse rounded-xl bg-surface-2 border border-line" />
    )
  }

  const chartData = daily.map((d) => ({
    date: fmtDate(d.date),
    cacheRead: d.cacheRead,
    inputCacheWrite: d.inputCacheWrite,
    inputNoCache: d.inputNoCache,
    outputTokens: d.outputTokens,
  }))

  return (
    <div className="rounded-xl border border-line bg-surface/60 p-5 shadow-theme">
      <h3 className="text-xs font-medium uppercase tracking-widest text-fg-faint mb-4">
        每日 Token 消耗分布
      </h3>
      <ResponsiveContainer width="100%" height={280}>
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
            tickFormatter={(v: number) => fmtTok(v)}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: chartColors.cursor }} />
          <Legend content={<CustomLegend />} />
          <Bar dataKey="cacheRead" name="cacheRead" stackId="a" fill={colors.cacheRead} radius={[0, 0, 0, 0]} />
          <Bar dataKey="inputCacheWrite" name="inputCacheWrite" stackId="a" fill={colors.inputCacheWrite} />
          <Bar dataKey="inputNoCache" name="inputNoCache" stackId="a" fill={colors.inputNoCache} />
          <Bar dataKey="outputTokens" name="outputTokens" stackId="a" fill={colors.outputTokens} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
