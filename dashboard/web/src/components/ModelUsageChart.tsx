/**
 * 每日消耗细分柱状图（按池类型：Auto / First-party / API）
 */
import { useMemo, useState } from 'react'
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

const POOLS = ['Auto', 'FirstParty', 'API'] as const

const POOL_LABELS: Record<(typeof POOLS)[number], string> = {
  Auto: 'Auto',
  FirstParty: 'First-party',
  API: 'API',
}

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
    <ChartTooltipShell label={label}>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} className="mb-0.5 flex justify-between gap-4">
          <span className="text-fg-muted">{p.name}</span>
          <span className="chart-tooltip-value text-fg">
            {mode === 'usd' ? `$${p.value.toFixed(4)}` : fmtTok(p.value)}
          </span>
        </div>
      ))}
      <div className="mt-1.5 flex justify-between border-t border-line pt-1">
        <span className="font-medium text-fg-muted">合计</span>
        <span className="chart-tooltip-value text-fg">
          {mode === 'usd' ? `$${total.toFixed(4)}` : fmtTok(total)}
        </span>
      </div>
    </ChartTooltipShell>
  )
}

function ModeToggle({
  mode,
  setMode,
}: {
  mode: ViewMode
  setMode: (m: ViewMode) => void
}) {
  return (
    <div className="toolbar-cluster text-[10px]">
      <button
        type="button"
        onClick={() => setMode('usd')}
        className={`ui-press h-6 px-2 ${
          mode === 'usd' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
        }`}
        style={{ borderRadius: 'var(--radius-sm)' }}
      >
        USD
      </button>
      <button
        type="button"
        onClick={() => setMode('tokens')}
        className={`ui-press h-6 px-2 ${
          mode === 'tokens' ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:text-fg'
        }`}
        style={{ borderRadius: 'var(--radius-sm)' }}
      >
        Tokens
      </button>
    </div>
  )
}

interface ModelUsageChartProps {
  daily: DailyEntry[] | null
}

export function ModelUsageChart({ daily }: ModelUsageChartProps) {
  const [mode, setMode] = useState<ViewMode>('usd')
  const chartColors = useChartColors()
  const poolColors = useMemo(
    (): Record<keyof PoolValues, string> => ({
      Auto: chartColors.poolAuto,
      FirstParty: chartColors.poolFirst,
      API: chartColors.poolApi,
    }),
    [chartColors],
  )
  const tick = chartTickStyle(chartColors.tick)

  if (!daily) {
    return <div className="h-72 animate-pulse panel bg-surface-2" />
  }

  const chartData = daily.map((d) => ({
    date: fmtDate(d.date),
    Auto: mode === 'usd' ? (d.costByPool?.Auto ?? 0) : (d.tokensByPool?.Auto ?? 0),
    FirstParty:
      mode === 'usd'
        ? (d.costByPool?.FirstParty ?? 0)
        : (d.tokensByPool?.FirstParty ?? 0),
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
    <ChartPanel
      title="每日消耗细分（Auto / First-party / API）"
      actions={<ModeToggle mode={mode} setMode={setMode} />}
    >
      <ChartLegendRow
        items={POOLS.map((pool) => ({
          color: poolColors[pool],
          label: POOL_LABELS[pool],
        }))}
      />
      <ResponsiveContainer width="100%" height={280}>
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
            tickFormatter={(v: number) =>
              mode === 'usd' ? `$${v.toFixed(2)}` : fmtTok(v)
            }
            width={52}
          />
          <Tooltip
            content={renderTooltip}
            cursor={chartCursorFill(chartColors.cursor)}
            isAnimationActive={false}
          />
          {POOLS.map((pool) => (
            <Bar
              key={pool}
              dataKey={pool}
              name={POOL_LABELS[pool]}
              stackId="a"
              fill={poolColors[pool]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  )
}
