/**
 * 每日 API 等效价值趋势图（面积图）
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

interface DailyResponse {
  ok: boolean
  daily?: DailyEntry[]
  ms?: number
  error?: string
}

// ────────── 自定义 Tooltip ──────────

interface TooltipPayloadItem {
  value: number
  dataKey: string
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const cost = payload[0]?.value ?? 0
  return (
    <div className="rounded-lg border border-line bg-elevated px-3 py-2 shadow-theme text-xs">
      <p className="mb-1 font-medium text-fg-muted">{label}</p>
      <p className="font-mono text-accent">
        ${cost.toFixed(4)}
      </p>
    </div>
  )
}

function fmtDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[1]}/${parts[2]}`
}

// ────────── 主组件 ──────────

interface UsageTrendChartProps {
  daily: DailyEntry[] | null
}

export function UsageTrendChart({ daily }: UsageTrendChartProps) {
  const chartColors = useChartColors()
  const accentColor = chartColors.chart1

  if (!daily) {
    return (
      <div className="h-64 animate-pulse rounded-xl bg-surface-2 border border-line" />
    )
  }

  const chartData = daily.map((d) => ({
    date: fmtDate(d.date),
    cost: d.cost,
  }))

  return (
    <div className="rounded-xl border border-line bg-surface/60 p-5 shadow-theme">
      <h3 className="text-xs font-medium uppercase tracking-widest text-fg-faint mb-4">
        每日 API 等效价值（USD）
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={accentColor} stopOpacity={0.35} />
              <stop offset="95%" stopColor={accentColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
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
            tickFormatter={(v: number) => `$${v.toFixed(1)}`}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="cost"
            stroke={accentColor}
            strokeWidth={2}
            fill="url(#costGradient)"
            dot={false}
            activeDot={{ r: 4, fill: accentColor, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ────────── 带数据获取的独立导出 ──────────

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
      <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
        加载每日趋势失败：{error}
      </div>
    )
  }

  return <UsageTrendChart daily={daily} />
}
