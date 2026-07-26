/**
 * 每日 API 等效价值趋势图（克制面积线 + 可拖动时间窗口）
 */
import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Brush,
} from 'recharts'
import { useChartColors } from '../context/ThemeContext'
import {
  ChartPanel,
  ChartTooltipShell,
  OVERVIEW_SYNC_ID,
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

interface DailyResponse {
  ok: boolean
  daily?: DailyEntry[]
  ms?: number
  error?: string
}

interface TooltipPayloadItem {
  value: number
  dataKey: string
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
  accent: string
}

function CustomTooltip({ active, payload, label, accent }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const cost = payload[0]?.value ?? 0
  return (
    <ChartTooltipShell label={label}>
      <div className="flex justify-between gap-4">
        <span className="text-fg-muted font-medium">USD</span>
        <span className="chart-tooltip-value" style={{ color: accent }}>
          ${cost.toFixed(4)}
        </span>
      </div>
    </ChartTooltipShell>
  )
}

function fmtDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[1]}/${parts[2]}`
}

interface UsageTrendChartProps {
  daily: DailyEntry[] | null
}

export function UsageTrendChart({ daily }: UsageTrendChartProps) {
  const chartColors = useChartColors()
  const accentColor = chartColors.chart1
  const tick = chartTickStyle(chartColors.tick)

  if (!daily) {
    return <div className="h-64 animate-pulse panel bg-surface-2" />
  }

  const chartData = daily.map((d) => ({
    date: fmtDate(d.date),
    cost: d.cost,
  }))

  const showBrush = chartData.length > 14
  const chartHeight = showBrush ? 288 : 248

  return (
    <ChartPanel title="每日 API 等效价值（USD）">
      {showBrush && (
        <p className="mb-2 text-[11px] text-fg-muted">
          拖动底部滑块缩放 / 平移时间窗口（与下方图表同步）
        </p>
      )}
      <ResponsiveContainer width="100%" height={chartHeight}>
        <AreaChart
          data={chartData}
          syncId={OVERVIEW_SYNC_ID}
          margin={{ top: 8, right: 4, left: 0, bottom: showBrush ? 4 : 0 }}
        >
          <defs>
            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accentColor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
            </linearGradient>
          </defs>
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
            tickFormatter={(v: number) => `$${v.toFixed(1)}`}
            width={44}
          />
          <Tooltip
            content={<CustomTooltip accent={accentColor} />}
            cursor={{ stroke: chartColors.tick, strokeWidth: 1, strokeOpacity: 0.35 }}
          />
          <Area
            type="monotone"
            dataKey="cost"
            stroke={accentColor}
            strokeWidth={2}
            fill="url(#costGradient)"
            dot={false}
            activeDot={{
              r: 3,
              fill: accentColor,
              stroke: chartColors.surface,
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
          {showBrush && (
            <Brush
              dataKey="date"
              height={28}
              travellerWidth={8}
              stroke={accentColor}
              fill={chartColors.cursor}
              tickFormatter={(v: string) => v}
              alwaysShowText
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartPanel>
  )
}

export function UsageTrendChartWithFetch() {
  const [daily, setDaily] = useState<DailyEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    axios
      .get<DailyResponse>('/api/daily')
      .then((r) => {
        if (r.data.ok && r.data.daily) setDaily(r.data.daily)
        else setError(r.data.error ?? '接口返回异常')
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) {
    return (
      <div className="panel border-danger-border bg-danger-soft p-4 text-sm text-danger">
        加载每日趋势失败：{error}
      </div>
    )
  }

  return <UsageTrendChart daily={daily} />
}
