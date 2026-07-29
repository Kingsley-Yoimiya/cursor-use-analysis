/**
 * 单日 0–23 点：上 Token、下估算 USD（分图对照，避免双轴叠线）
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
  height = 168,
}: {
  title: string
  data: { hour: string; tokens: number; cost: number }[]
  dataKey: 'tokens' | 'cost'
  color: string
  tick: ReturnType<typeof chartTickStyle>
  grid: string
  formatValue: (n: number) => string
  unitLabel: string
  height?: number
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold text-fg-muted tracking-wide">
          {title}
        </h4>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid {...chartGridProps(grid)} />
          <XAxis
            dataKey="hour"
            tick={tick}
            interval={2}
            tickLine={false}
            axisLine={{ stroke: grid }}
          />
          <YAxis
            tick={tick}
            tickFormatter={(v) => formatValue(Number(v))}
            width={48}
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
                    <span className="text-fg-muted font-medium">{unitLabel}</span>
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
  )
}

export function HourlyDayChart({ day, loading }: HourlyDayChartProps) {
  const colors = useChartColors()
  const tick = chartTickStyle(colors.tick)

  if (loading) {
    return <div className="h-80 animate-pulse panel bg-surface-2" />
  }

  if (!day) {
    return (
      <ChartPanel title="日内对照">
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
      actions={
        <span className="text-[11px] text-fg-faint font-mono">
          {fmtTokens(day.totalTokens)} · {fmtUsdShort(totalCost)} · {day.rows}{' '}
          行
        </span>
      }
    >
      {/* 与左侧热力大致同高；略超则可滚 */}
      <div className="max-h-[min(420px,70vh)] overflow-y-auto space-y-4 pr-0.5">
        <MiniHourChart
          title="用量（Token）"
          data={data}
          dataKey="tokens"
          color={colors.chart1}
          tick={tick}
          grid={colors.grid}
          formatValue={fmtTokens}
          unitLabel="Token"
          height={168}
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
          height={168}
        />
      </div>
      <p className="mt-2 text-[11px] text-fg-faint">
        上下分图对照：形状不一致时通常是贵模型更集中的时段。
      </p>
    </ChartPanel>
  )
}
