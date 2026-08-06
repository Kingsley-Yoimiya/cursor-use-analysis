/**
 * 单日 0–23 点：上 Token、下估算 USD
 * 高度锁定在与热力同高的父容器内，两图对半分
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
  className?: string
}

function fmtUsdShort(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 100) return `$${n.toFixed(0)}`
  if (Math.abs(n) >= 10) return `$${n.toFixed(1)}`
  return `$${n.toFixed(2)}`
}

function MiniHourChart({
  title,
  data,
  dataKey,
  color,
  tick,
  grid,
  formatValue,
  unitLabel,
}: {
  title: string
  data: { hour: string; tokens: number; cost: number }[]
  dataKey: 'tokens' | 'cost'
  color: string
  tick: ReturnType<typeof chartTickStyle>
  grid: string
  formatValue: (n: number) => string
  unitLabel: string
}) {
  return (
    <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
      <h4 className="mb-0.5 shrink-0 text-[11px] font-semibold text-fg-muted tracking-wide">
        {title}
      </h4>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 2, right: 4, left: 0, bottom: 0 }}
          >
            <CartesianGrid {...chartGridProps(grid)} />
            <XAxis
              dataKey="hour"
              tick={tick}
              interval={3}
              tickLine={false}
              axisLine={{ stroke: grid }}
              height={18}
            />
            <YAxis
              tick={tick}
              tickFormatter={(v) => formatValue(Number(v))}
              width={44}
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
                      <span className="text-fg-muted font-medium">
                        {unitLabel}
                      </span>
                      <span className="chart-tooltip-value" style={{ color }}>
                        {formatValue(v)}
                      </span>
                    </div>
                  </ChartTooltipShell>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              fill={color}
              fillOpacity={0.16}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function HourlyDayChart({
  day,
  loading,
  className = '',
}: HourlyDayChartProps) {
  const colors = useChartColors()
  const tick = chartTickStyle(colors.tick)

  if (loading) {
    return (
      <div className={`h-full animate-pulse panel bg-surface-2 ${className}`} />
    )
  }

  if (!day) {
    return (
      <ChartPanel title="日内对照" className={`h-full ${className}`}>
        <p className="text-sm text-fg-muted py-8 text-center">
          请在热力图中选择一天
        </p>
      </ChartPanel>
    )
  }

  const costHours = day.costHours || Array.from({ length: 24 }, () => 0)
  const totalCost = day.totalCost ?? costHours.reduce((s, v) => s + v, 0)

  const data = day.hours.map((tokens, hour) => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    tokens,
    cost: costHours[hour] ?? 0,
  }))

  return (
    <ChartPanel
      title={`日内对照 · ${day.date}`}
      className={`h-full overflow-hidden ${className}`}
      bodyClassName="flex flex-col min-h-0 overflow-hidden gap-2"
      actions={
        <span className="text-[11px] text-fg-faint font-mono">
          {fmtTokens(day.totalTokens)} · {fmtUsdShort(totalCost)}
        </span>
      }
    >
      <MiniHourChart
        title="用量（Token）"
        data={data}
        dataKey="tokens"
        color={colors.chart1}
        tick={tick}
        grid={colors.grid}
        formatValue={fmtTokens}
        unitLabel="Token"
      />
      <MiniHourChart
        title="金额（估算 USD）"
        data={data}
        dataKey="cost"
        color={colors.chart2}
        tick={tick}
        grid={colors.grid}
        formatValue={fmtUsdShort}
        unitLabel="USD"
      />
    </ChartPanel>
  )
}
