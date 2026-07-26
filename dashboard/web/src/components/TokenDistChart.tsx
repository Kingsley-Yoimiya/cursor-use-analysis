/**
 * 每日 Token 消耗分布堆叠柱状图（编辑器 chrome）
 */
import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useChartColors } from '../context/ThemeContext'
import {
  ChartLegendRow,
  ChartPanel,
  ChartTooltipShell,
  OVERVIEW_SYNC_ID,
  chartCursorFill,
  chartGridProps,
  chartTickStyle,
} from '../lib/chartChrome'

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

const SERIES: { key: ColorKey; label: string }[] = [
  { key: 'cacheRead', label: 'Cache Read' },
  { key: 'inputCacheWrite', label: 'Cache Write' },
  { key: 'inputNoCache', label: 'No-Cache Input' },
  { key: 'outputTokens', label: 'Output' },
]

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
    <ChartTooltipShell label={label}>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} className="mb-0.5 flex justify-between gap-4">
          <span className="text-fg-muted">
            {SERIES.find((s) => s.key === p.dataKey)?.label ?? p.name}
          </span>
          <span className="chart-tooltip-value text-fg">{fmtTok(p.value)}</span>
        </div>
      ))}
      <div className="mt-1.5 flex justify-between border-t border-line pt-1">
        <span className="font-medium text-fg-muted">合计</span>
        <span className="chart-tooltip-value text-fg">{fmtTok(total)}</span>
      </div>
    </ChartTooltipShell>
  )
}

function fmtDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[1]}/${parts[2]}`
}

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
  const tick = chartTickStyle(chartColors.tick)

  if (!daily) {
    return <div className="h-64 animate-pulse panel bg-surface-2" />
  }

  const chartData = daily.map((d) => ({
    date: fmtDate(d.date),
    cacheRead: d.cacheRead,
    inputCacheWrite: d.inputCacheWrite,
    inputNoCache: d.inputNoCache,
    outputTokens: d.outputTokens,
  }))

  return (
    <ChartPanel title="每日 Token 消耗分布">
      <ChartLegendRow
        items={SERIES.map((s) => ({
          color: colors[s.key],
          label: s.label,
        }))}
      />
      <ResponsiveContainer width="100%" height={248}>
        <BarChart
          data={chartData}
          syncId={OVERVIEW_SYNC_ID}
          margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          barCategoryGap="28%"
        >
          <CartesianGrid {...chartGridProps(chartColors.grid)} />
          <XAxis
            dataKey="date"
            tick={tick}
            tickLine={false}
            axisLine={{ stroke: chartColors.grid, strokeOpacity: 0.7 }}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            tick={tick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmtTok(v)}
            width={40}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={chartCursorFill(chartColors.cursor)}
            isAnimationActive={false}
          />
          {SERIES.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.key}
              stackId="a"
              fill={colors[s.key]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  )
}
