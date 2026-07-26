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
  ResponsiveContainer,
} from 'recharts'
import { useChartColors } from '../context/ThemeContext'
import {
  ChartLegendRow,
  ChartPanel,
  ChartTooltipShell,
  chartCursorFill,
  chartGridProps,
  chartTickStyle,
} from '../lib/chartChrome'

interface DailyEntry {
  date: string
  costByModel: Record<string, number>
  tokensByModel: Record<string, number>
}

type ViewMode = 'usd' | 'tokens'

const MAX_MODELS = 8

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
  const sorted = [...payload].reverse().filter((p) => p.value > 0)
  return (
    <ChartTooltipShell label={label}>
      <div className="max-h-56 overflow-y-auto">
        {sorted.map((p) => (
          <div key={p.dataKey} className="mb-0.5 flex justify-between gap-4">
            <span className="max-w-[120px] truncate text-fg-muted">{p.name}</span>
            <span className="shrink-0 font-mono tabular-nums text-fg">
              {mode === 'usd' ? `$${p.value.toFixed(3)}` : fmtTok(p.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between border-t border-line pt-1">
        <span className="text-fg-faint">合计</span>
        <span className="font-mono tabular-nums text-fg">
          {mode === 'usd' ? `$${total.toFixed(3)}` : fmtTok(total)}
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

interface ModelDetailedChartProps {
  daily: DailyEntry[] | null
}

export function ModelDetailedChart({ daily }: ModelDetailedChartProps) {
  const [mode, setMode] = useState<ViewMode>('usd')
  const chartColors = useChartColors()
  const palette = useMemo(
    () => [
      chartColors.chart1,
      chartColors.chart2,
      chartColors.chart3,
      chartColors.chart4,
      chartColors.chart5,
      chartColors.poolAuto,
      chartColors.poolFirst,
      chartColors.poolApi,
    ],
    [chartColors],
  )
  const othersColor = chartColors.muted
  const tick = chartTickStyle(chartColors.tick)

  const topModels = useMemo(() => {
    if (!daily || daily.length === 0) return [] as string[]
    const totals: Record<string, number> = {}
    for (const d of daily) {
      const src = mode === 'usd' ? d.costByModel : d.tokensByModel
      for (const [m, v] of Object.entries(src ?? {})) {
        totals[m] = (totals[m] ?? 0) + v
      }
    }
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_MODELS)
      .map(([m]) => m)
  }, [daily, mode])

  const hasOthers = useMemo(() => {
    if (!daily) return false
    for (const d of daily) {
      const src = mode === 'usd' ? d.costByModel : d.tokensByModel
      for (const m of Object.keys(src ?? {})) {
        if (!topModels.includes(m)) return true
      }
    }
    return false
  }, [daily, mode, topModels])

  const chartData = useMemo(() => {
    if (!daily) return []
    return daily.map((d) => {
      const src = mode === 'usd' ? d.costByModel : d.tokensByModel
      const row: Record<string, string | number> = { date: fmtDate(d.date) }
      let others = 0
      for (const [m, v] of Object.entries(src ?? {})) {
        if (topModels.includes(m)) row[m] = v
        else others += v
      }
      for (const m of topModels) {
        if (row[m] == null) row[m] = 0
      }
      if (hasOthers) row['其他'] = others
      return row
    })
  }, [daily, mode, topModels, hasOthers])

  if (!daily) {
    return <div className="h-80 animate-pulse panel bg-surface-2" />
  }

  if (daily.length === 0 || topModels.length === 0) {
    return (
      <div className="panel flex h-40 items-center justify-center p-4">
        <p className="text-sm text-fg-faint">暂无数据</p>
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
    <ChartPanel
      title={`每日各模型消耗细分（Top ${topModels.length}）`}
      actions={<ModeToggle mode={mode} setMode={setMode} />}
    >
      <ChartLegendRow
        items={allKeys.map((model, i) => ({
          color: model === '其他' ? othersColor : palette[i % palette.length],
          label: model,
        }))}
      />
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={chartData}
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
          {allKeys.map((model, i) => (
            <Bar
              key={model}
              dataKey={model}
              name={model}
              stackId="a"
              fill={model === '其他' ? othersColor : palette[i % palette.length]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  )
}
