/**
 * 单日 0–23 点 token 曲线
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useChartColors } from '../context/ThemeContext'
import {
  ChartPanel,
  ChartTooltipShell,
  chartGridProps,
  chartTickStyle,
} from '../lib/chartChrome'
import { fmtTokens } from '../lib/formatTokens'
import type { HourlyDay } from './HourlyHeatmapChart'

interface HourlyDayChartProps {
  day: HourlyDay | null
  loading?: boolean
}

export function HourlyDayChart({ day, loading }: HourlyDayChartProps) {
  const colors = useChartColors()
  const tick = chartTickStyle(colors.tick)

  if (loading) {
    return <div className="h-64 animate-pulse panel bg-surface-2" />
  }

  if (!day) {
    return (
      <ChartPanel title="日内用量曲线">
        <p className="text-sm text-fg-muted py-8 text-center">请在热力图中选择一天</p>
      </ChartPanel>
    )
  }

  const data = day.hours.map((tokens, hour) => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    tokens,
  }))

  return (
    <ChartPanel
      title={`日内用量 · ${day.date}`}
      actions={
        <span className="text-[11px] text-fg-faint font-mono">
          {fmtTokens(day.totalTokens)} · {day.rows} 行
        </span>
      }
    >
      <ResponsiveContainer width="100%" height={248}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...chartGridProps(colors.grid)} />
          <XAxis
            dataKey="hour"
            tick={tick}
            interval={2}
            tickLine={false}
            axisLine={{ stroke: colors.grid }}
          />
          <YAxis
            tick={tick}
            tickFormatter={(v) => fmtTokens(Number(v))}
            width={52}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const v = Number(payload[0]?.value ?? 0)
              return (
                <ChartTooltipShell label={String(label ?? '')}>
                  <div className="flex justify-between gap-4">
                    <span className="text-fg-muted font-medium">Token</span>
                    <span className="chart-tooltip-value" style={{ color: colors.chart1 }}>
                      {fmtTokens(v)}
                    </span>
                  </div>
                </ChartTooltipShell>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey="tokens"
            stroke={colors.chart1}
            fill={colors.chart1}
            fillOpacity={0.18}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartPanel>
  )
}
