/**
 * 周期统计视图：按日历月 / 账单周期汇总用量、花费、Fast 比例与 Top 模型
 */
import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
} from 'recharts'
import { useChartColors, useTheme } from '../context/ThemeContext'
import {
  paperColorHatchDefs,
  paperHatchDefs,
  chartGridProps,
  paperBarProps,
  paperColorFill,
} from '../lib/chartChrome'
import { PaperFigure } from './PaperFigure'
import { fmtUsdCompact } from '../lib/paperThesis'

// ────────── 类型 ──────────

interface ModelStat {
  model: string
  requests: number
  tokens: number
  cost: number
  requestShare?: number
}

interface PoolValues {
  Auto: number
  FirstParty: number
  API: number
}

interface PoolChangeStat {
  costPct: number | null
  tokensPct: number | null
  costShareDelta: number
  tokenShareDelta: number
}

interface PeriodChanges {
  costPct: number | null
  tokensPct: number | null
  rowsPct: number | null
  fastRatioDelta: number
  poolChanges?: Record<keyof PoolValues, PoolChangeStat>
}

interface PeriodEntry {
  key: string
  label: string
  startDate: string
  endDate: string
  totalTokens: number
  totalCost: number
  totalRows: number
  fastTokens: number
  fastRows: number
  fastRatio: number
  fastRowRatio: number
  costByPool: PoolValues
  tokensByPool: PoolValues
  costShareByPool: PoolValues
  tokenShareByPool: PoolValues
  topModels: ModelStat[]
  modelFrequency: ModelStat[]
  changes: PeriodChanges | null
}

interface PeriodGroup {
  kind: 'calendar' | 'billing'
  billingCycleDay: number | null
  periods: PeriodEntry[]
}

interface PeriodStatsResponse {
  ok: boolean
  billingCycleDay?: number
  defaultBillingCycleDay?: number
  billingCycleDayRange?: { min: number; max: number }
  calendarMonths?: PeriodGroup
  billingCycles?: PeriodGroup
  ms?: number
  error?: string
}

type ViewMode = 'calendar' | 'billing'

const POOLS = ['Auto', 'FirstParty', 'API'] as const
const POOL_LABELS: Record<(typeof POOLS)[number], string> = {
  Auto: 'Auto',
  FirstParty: 'First-party',
  API: 'API',
}

const MODEL_HUES = [160, 270, 200, 38, 330, 220, 15, 280, 120, 350, 190, 45, 300, 80, 250, 170, 310, 55, 230, 100]

function modelSeriesColor(
  index: number,
  isDark: boolean,
  paperPalette?: string[],
): string {
  if (paperPalette && paperPalette.length > 0) {
    return paperPalette[index % paperPalette.length]
  }
  const h = MODEL_HUES[index % MODEL_HUES.length]
  return `hsl(${h}, 62%, ${isDark ? '52%' : '46%'})`
}

const BILLING_DAY_STORAGE_KEY = 'cursor-dashboard-billing-cycle-day'
/** 周期数达到此值时，趋势图改为单列全宽 */
const FULL_WIDTH_MODEL_CHART_MIN_PERIODS = 9

function compactChartShell(compact: boolean, paper: boolean): string {
  if (paper) return 'w-full'
  return compact ? 'mx-auto w-full max-w-[280px] sm:max-w-xs' : 'w-full'
}

function trendGridClass(compact: boolean, paper: boolean): string {
  if (paper) return 'paper-grid'
  return compact ? 'grid gap-6 md:grid-cols-2' : 'grid gap-6 grid-cols-1'
}

function barLayout(compact: boolean, periodCount: number, paper: boolean) {
  if (paper) {
    return {
      height: 220,
      maxBarSize: Math.min(42, Math.max(18, Math.floor(520 / Math.max(periodCount, 1)))),
      categoryGap: '16%',
      yAxisWidth: 48,
    }
  }
  return {
    height: compact ? 200 : 260,
    maxBarSize: compact
      ? Math.min(36, Math.max(20, Math.floor(280 / Math.max(periodCount, 1))))
      : Math.min(48, Math.max(24, Math.floor(720 / Math.max(periodCount, 1)))),
    categoryGap: compact ? '28%' : '12%',
    yAxisWidth: compact ? 44 : 52,
  }
}

const tooltipBoxStyle = (surface: string, border: string) => ({
  background: surface,
  border: `1px solid ${border}`,
  borderRadius: 8,
  fontSize: 12,
})

// ────────── 格式化 ──────────

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function fmtChange(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}%`
}

function changeColor(n: number | null | undefined): string {
  if (n == null) return 'text-fg-faint'
  if (n > 0.05) return 'text-danger'
  if (n < -0.05) return 'text-accent'
  return 'text-fg-muted'
}

function fmtShareDelta(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}pt`
}

function latestPeriodThesis(periods: PeriodEntry[], mode: ViewMode): string {
  const latest = periods[periods.length - 1]
  const unit = mode === 'billing' ? '最近一个账单周期' : '最近一个自然月'
  if (!latest) return mode === 'billing' ? '按账单周期看花费' : '按自然月看花费'
  const money = fmtUsdCompact(latest.totalCost)
  const pct = latest.changes?.costPct
  if (pct == null) return `${unit}公开单价等效约 ${money}`
  const abs = Math.abs(pct * 100)
  if (abs < 3) return `${unit}约 ${money}，环比大致持平`
  return `${unit}约 ${money}，环比${pct > 0 ? '升' : '降'} ${abs.toFixed(0)}%`
}

function poolSharesFallback(
  byPool: PoolValues,
  total: number,
): PoolValues {
  return {
    Auto: total > 0 ? byPool.Auto / total : 0,
    FirstParty: total > 0 ? byPool.FirstParty / total : 0,
    API: total > 0 ? byPool.API / total : 0,
  }
}

function getCostShare(p: PeriodEntry): PoolValues {
  return p.costShareByPool ?? poolSharesFallback(p.costByPool, p.totalCost)
}

function getTokenShare(p: PeriodEntry): PoolValues {
  return p.tokenShareByPool ?? poolSharesFallback(p.tokensByPool, p.totalTokens)
}

function shortPeriodLabel(p: PeriodEntry, mode: ViewMode): string {
  if (mode === 'calendar') {
    const [, m] = p.key.split('-')
    return `${Number(m)}月`
  }
  const start = p.startDate.slice(5).replace('-', '/')
  return start
}

interface ModelStackLayerMeta {
  key: string
  color: string
  value: number
}

interface ModelStackBarRow {
  label: string
  __layerMeta: ModelStackLayerMeta[]
  [key: string]: string | number | ModelStackLayerMeta[] | undefined
}

function buildModelStackedBarData(
  periods: PeriodEntry[],
  mode: ViewMode,
  topN: number,
  isDark: boolean,
  metric: 'cost' | 'tokens',
  otherColor: string,
  paperPalette?: string[],
) {
  const allModels = new Set<string>()
  const modelTotals = new Map<string, number>()
  const modelColorMap = new Map<string, string>()

  const rawBars = periods.map((p) => {
    const source =
      p.modelFrequency.length > 0 ? p.modelFrequency : p.topModels
    const top = [...source]
      .sort((a, b) =>
        metric === 'cost' ? b.cost - a.cost : b.tokens - a.tokens,
      )
      .slice(0, topN)
    const topSumRaw = top.reduce(
      (s, m) => s + (metric === 'cost' ? m.cost : m.tokens),
      0,
    )
    const periodTotalRaw =
      metric === 'cost' ? p.totalCost : p.totalTokens
    const toDisplay = (n: number) =>
      metric === 'cost' ? n : n / 1_000_000

    const entries: { key: string; value: number }[] = []
    for (const m of top) {
      const raw = metric === 'cost' ? m.cost : m.tokens
      const value = toDisplay(raw)
      if (value > 0) entries.push({ key: m.model, value })
      allModels.add(m.model)
      modelTotals.set(m.model, (modelTotals.get(m.model) ?? 0) + raw)
    }
    const otherVal = Math.max(0, toDisplay(periodTotalRaw - topSumRaw))
    if (otherVal > 0) entries.push({ key: '其他', value: otherVal })

    return { label: shortPeriodLabel(p, mode), entries }
  })

  const sortedModels = [...allModels].sort(
    (a, b) => (modelTotals.get(b) ?? 0) - (modelTotals.get(a) ?? 0),
  )
  sortedModels.forEach((key, i) => {
    modelColorMap.set(key, modelSeriesColor(i, isDark, paperPalette))
  })
  modelColorMap.set('其他', otherColor)

  const layerCount = topN + 1
  const bars: ModelStackBarRow[] = rawBars.map(({ label, entries }) => {
    const sorted = [...entries].sort((a, b) => b.value - a.value)
    const layerMeta: ModelStackLayerMeta[] = sorted.map(({ key, value }) => ({
      key,
      value,
      color: modelColorMap.get(key) ?? otherColor,
    }))

    const row: ModelStackBarRow = { label, __layerMeta: layerMeta }
    for (let i = 0; i < layerCount; i++) {
      row[`__layer${i}`] = layerMeta[i]?.value ?? 0
    }
    return row
  })

  return { bars, layerCount, uniqueModelCount: sortedModels.length }
}

function ModelStackTooltip({
  active,
  label,
  surface,
  border,
  metric,
  bars,
}: {
  active?: boolean
  label?: string
  surface: string
  border: string
  metric: 'cost' | 'tokens'
  bars: ModelStackBarRow[]
}) {
  if (!active || !label) return null

  const row = bars.find((b) => b.label === label)
  if (!row?.__layerMeta?.length) return null

  const minVal = metric === 'cost' ? 0.01 : 0.0001
  const items = row.__layerMeta.filter((m) => m.value > minVal)

  if (items.length === 0) return null

  const total = items.reduce((s, m) => s + m.value, 0)
  const fmtVal = (v: number) =>
    metric === 'cost' ? fmtUsd(v) : `${v.toFixed(2)}M (${fmtTokens(v * 1_000_000)})`

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs min-w-[140px] max-w-[220px]"
      style={{
        background: surface,
        border: `1px solid ${border}`,
      }}
    >
      <p className="mb-1.5 font-medium text-fg-muted">{label}</p>
      {items.map((m) => (
        <div key={m.key} className="flex justify-between gap-3 mb-0.5">
          <span className="truncate" style={{ color: m.color }} title={m.key}>
            {m.key}
          </span>
          <span className="font-mono shrink-0 text-fg">
            {fmtVal(m.value)}
          </span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-line pt-1 flex justify-between">
        <span className="text-fg-faint">合计</span>
        <span className="font-mono font-medium text-fg">
          {fmtVal(total)}
        </span>
      </div>
    </div>
  )
}

interface ModelStackedBarChartProps {
  bars: ModelStackBarRow[]
  layerCount: number
  metric: 'cost' | 'tokens'
  stackId: string
  barsLayout: ReturnType<typeof barLayout>
  gridStroke: string
  tickFill: string
  surface: string
  border: string
  paper: boolean
}

function ModelStackedBarChart({
  bars,
  layerCount,
  metric,
  stackId,
  barsLayout,
  gridStroke,
  tickFill,
  surface,
  border,
  paper,
}: ModelStackedBarChartProps) {
  const layerColors = bars.flatMap((b) =>
    (b.__layerMeta ?? []).map((m) => m?.color).filter(Boolean),
  ) as string[]
  return (
    <BarChart data={bars} barCategoryGap={barsLayout.categoryGap}>
      {paperColorHatchDefs(stackId, layerColors, paper, surface)}
      <CartesianGrid {...chartGridProps(gridStroke)} />
      <XAxis
        dataKey="label"
        tick={{ fill: tickFill, fontSize: paper ? 13 : 11 }}
        tickLine={false}
        axisLine={paper ? { stroke: '#404040' } : undefined}
      />
      <YAxis
        tick={{ fill: tickFill, fontSize: paper ? 13 : 11 }}
        tickFormatter={(v) => (metric === 'cost' ? `$${v}` : `${v}M`)}
        width={barsLayout.yAxisWidth}
        tickLine={false}
        axisLine={paper ? { stroke: '#404040' } : false}
      />
      <Tooltip
        content={
          <ModelStackTooltip
            surface={surface}
            border={border}
            metric={metric}
            bars={bars}
          />
        }
      />
      {Array.from({ length: layerCount }, (_, layerIdx) => (
        <Bar
          key={layerIdx}
          dataKey={`__layer${layerIdx}`}
          stackId={stackId}
          maxBarSize={barsLayout.maxBarSize}
          radius={
            paper ? [0, 0, 0, 0] : layerIdx === layerCount - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
          }
          isAnimationActive={false}
        >
          {bars.map((entry, index) => {
            const color = entry.__layerMeta[layerIdx]?.color ?? 'transparent'
            return (
              <Cell
                key={`${layerIdx}-${index}`}
                fill={paperColorFill(stackId, color, paper)}
                stroke={paper && color !== 'transparent' ? color : undefined}
                strokeWidth={paper ? 1 : 0}
              />
            )
          })}
        </Bar>
      ))}
    </BarChart>
  )
}

// ────────── 子组件 ──────────

function ChangeBadge({ value, suffix = '' }: { value: number | null | undefined; suffix?: string }) {
  if (value == null) return <span className="text-fg-faint text-xs">—</span>
  return (
    <span className={`text-xs font-mono ${changeColor(value)}`}>
      {fmtChange(value)}{suffix}
    </span>
  )
}

interface PeriodCardProps {
  period: PeriodEntry
}

function PoolBreakdown({ period, poolColors }: { period: PeriodEntry; poolColors: Record<(typeof POOLS)[number], string> }) {
  const costShare = getCostShare(period)
  const tokenShare = getTokenShare(period)
  const poolChanges = period.changes?.poolChanges

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-fg-faint">池子分布 Auto / First-party / API</p>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        {POOLS.map((pool) => (
          <div
            key={pool}
            className="rounded-lg border border-line-subtle px-2 py-2"
            style={{ borderLeftWidth: 3, borderLeftColor: poolColors[pool] }}
          >
            <p className="font-medium text-fg">{POOL_LABELS[pool]}</p>
            <p className="font-mono text-accent mt-0.5">
              {fmtUsd(period.costByPool[pool])}
            </p>
            <p className="font-mono text-info text-[10px]">
              {fmtTokens(period.tokensByPool[pool])}
            </p>
            <p className="text-fg-faint mt-1">
              花费 {fmtPct(costShare[pool])} · Token {fmtPct(tokenShare[pool])}
            </p>
            {poolChanges?.[pool] && (
              <p className="text-[10px] mt-1 space-x-1">
                <span className={changeColor(poolChanges[pool].costPct)}>
                  {fmtChange(poolChanges[pool].costPct)}
                </span>
                <span className="text-fg-faint">·</span>
                <span className={changeColor(poolChanges[pool].costShareDelta)}>
                  {fmtShareDelta(poolChanges[pool].costShareDelta)}
                </span>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PeriodCard({ period, poolColors }: PeriodCardProps & { poolColors: Record<(typeof POOLS)[number], string> }) {
  return (
    <article className="panel p-4 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">
            {period.label}
          </h3>
          <p className="text-[11px] text-fg-faint font-mono mt-0.5">
            {period.startDate} → {period.endDate}
          </p>
        </div>
        {period.changes && (
          <div className="text-right space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-fg-faint">环比</p>
            <p className="text-xs">
              花费 <ChangeBadge value={period.changes.costPct} />
            </p>
            <p className="text-xs">
              Token <ChangeBadge value={period.changes.tokensPct} />
            </p>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-fg-faint">花费</p>
          <p className="text-lg font-bold font-mono text-accent">
            {fmtUsd(period.totalCost)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-fg-faint">Token</p>
          <p className="text-lg font-bold font-mono text-info">
            {fmtTokens(period.totalTokens)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-fg-faint">Fast 占比</p>
          <p className="text-lg font-bold font-mono text-violet">
            {fmtPct(period.fastRatio)}
          </p>
          {period.changes && (
            <ChangeBadge value={period.changes.fastRatioDelta} suffix=" pt" />
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-fg-faint">请求数</p>
          <p className="text-lg font-bold font-mono text-warning">
            {period.totalRows.toLocaleString()}
          </p>
        </div>
      </div>

      <PoolBreakdown period={period} poolColors={poolColors} />

      <div>
        <p className="text-[10px] uppercase tracking-wider text-fg-faint mb-2">Top 3 模型（按花费）</p>
        {period.topModels.length === 0 ? (
          <p className="text-xs text-fg-faint">无数据</p>
        ) : (
          <ol className="space-y-1.5">
            {period.topModels.map((m, i) => (
              <li
                key={m.model}
                className="flex items-center justify-between gap-2 text-xs rounded-lg bg-surface-2 px-3 py-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-line flex items-center justify-center text-[10px] font-bold text-fg-muted">
                    {i + 1}
                  </span>
                  <span className="truncate font-medium text-fg">
                    {m.model}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-fg-muted">
                  {fmtUsd(m.cost)} · {fmtTokens(m.tokens)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </article>
  )
}

// ────────── 主组件 ──────────

export function PeriodStatsView({
  refreshKey,
  profilesQuery,
  profilesKey,
  identitySummary,
}: {
  refreshKey?: number
  profilesQuery?: string
  profilesKey?: string
  identitySummary?: string | null
}) {
  const { isDark, isPaper } = useTheme()
  const chartColors = useChartColors()
  const poolColors = useMemo(
    (): Record<(typeof POOLS)[number], string> => ({
      Auto: chartColors.poolAuto,
      FirstParty: chartColors.poolFirst,
      API: chartColors.poolApi,
    }),
    [chartColors],
  )
  const [data, setData] = useState<PeriodStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('billing')
  const [topModelCount, setTopModelCount] = useState<3 | 5>(5)
  const [billingCycleDay, setBillingCycleDay] = useState<number>(() => {
    const saved = localStorage.getItem(BILLING_DAY_STORAGE_KEY)
    if (saved) {
      const n = Number(saved)
      if (Number.isFinite(n) && n >= 1 && n <= 28) return n
    }
    return 23
  })

  useEffect(() => {
    localStorage.setItem(BILLING_DAY_STORAGE_KEY, String(billingCycleDay))
  }, [billingCycleDay])

  useEffect(() => {
    setLoading(true)
    axios
      .get<PeriodStatsResponse>('/api/period-stats', {
        params: {
          billingCycleDay,
          ...(profilesQuery ? { profiles: profilesQuery } : {}),
        },
      })
      .then((r) => {
        if (r.data.ok) {
          setData(r.data)
          setError(null)
        } else {
          setError(r.data.error ?? '接口返回异常')
        }
      })
      .catch((e) => {
        if (axios.isAxiosError(e) && e.response?.status === 404) {
          const body = e.response.data as { error?: string } | string
          const msg =
            typeof body === 'object' && body?.error
              ? body.error
              : '后端未提供 /api/period-stats（多为 server 未重启）。请重启 dashboard/server 后刷新页面。'
          setError(msg)
          return
        }
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoading(false))
  }, [billingCycleDay, refreshKey, profilesKey, profilesQuery])

  const activeGroup = useMemo(() => {
    if (!data) return null
    return viewMode === 'calendar' ? data.calendarMonths : data.billingCycles
  }, [data, viewMode])

  const chartData = useMemo(() => {
    if (!activeGroup) return []
    return activeGroup.periods.map((p) => ({
      label: shortPeriodLabel(p, viewMode),
      cost: p.totalCost,
      tokens: p.totalTokens / 1_000_000,
      fastRatio: p.fastRatio * 100,
      rows: p.totalRows,
    }))
  }, [activeGroup, viewMode])

  const paperModelPalette = useMemo(
    () =>
      chartColors.paper
        ? [
            chartColors.chart1,
            chartColors.chart2,
            chartColors.chart3,
            chartColors.chart4,
          ]
        : undefined,
    [chartColors],
  )

  const modelStackedBarData = useMemo(() => {
    if (!activeGroup) return { bars: [], layerCount: 0, uniqueModelCount: 0 }
    return buildModelStackedBarData(
      activeGroup.periods,
      viewMode,
      topModelCount,
      isDark,
      'cost',
      chartColors.muted,
      paperModelPalette,
    )
  }, [activeGroup, viewMode, topModelCount, isDark, chartColors.muted, paperModelPalette])

  const modelTokenStackedBarData = useMemo(() => {
    if (!activeGroup) return { bars: [], layerCount: 0, uniqueModelCount: 0 }
    return buildModelStackedBarData(
      activeGroup.periods,
      viewMode,
      topModelCount,
      isDark,
      'tokens',
      chartColors.muted,
      paperModelPalette,
    )
  }, [activeGroup, viewMode, topModelCount, isDark, chartColors.muted, paperModelPalette])

  const poolChartData = useMemo(() => {
    if (!activeGroup) return []
    return activeGroup.periods.map((p) => {
      const costShare = getCostShare(p)
      const tokenShare = getTokenShare(p)
      return {
        label: shortPeriodLabel(p, viewMode),
        costAuto: p.costByPool.Auto,
        costFirstParty: p.costByPool.FirstParty,
        costAPI: p.costByPool.API,
        tokensAuto: p.tokensByPool.Auto / 1_000_000,
        tokensFirstParty: p.tokensByPool.FirstParty / 1_000_000,
        tokensAPI: p.tokensByPool.API / 1_000_000,
        shareAutoCost: costShare.Auto * 100,
        shareFirstPartyCost: costShare.FirstParty * 100,
        shareAPICost: costShare.API * 100,
        shareAutoToken: tokenShare.Auto * 100,
        shareFirstPartyToken: tokenShare.FirstParty * 100,
        shareAPIToken: tokenShare.API * 100,
      }
    })
  }, [activeGroup, viewMode])

  const gridStroke = chartColors.grid
  const tickFill = chartColors.tick

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded-xl bg-surface-2 border border-line" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-surface-2 border border-line" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
        加载周期统计失败：{error}
      </div>
    )
  }

  if (!data || !activeGroup) return null

  const dayMin = data.billingCycleDayRange?.min ?? 1
  const dayMax = data.billingCycleDayRange?.max ?? 28
  const periodCount = chartData.length
  const compactTrendLayout = periodCount < FULL_WIDTH_MODEL_CHART_MIN_PERIODS
  const bars = barLayout(compactTrendLayout, periodCount, isPaper)
  const latest = activeGroup.periods[activeGroup.periods.length - 1]
  const topToggle = (
    <div className="flex gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
      {([3, 5] as const).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => setTopModelCount(n)}
          className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${
            topModelCount === n
              ? 'bg-accent-soft text-accent'
              : 'text-fg-muted hover:text-fg hover:bg-surface'
          }`}
        >
          Top {n}
        </button>
      ))}
    </div>
  )

  const costModelChart = (
    <div className={isPaper ? undefined : 'panel p-4'}>
      {!isPaper && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h4 className="text-[11px] font-medium text-fg-muted">
            按模型堆叠（Top {topModelCount}）
          </h4>
          {topToggle}
        </div>
      )}
      {isPaper && <div className="flex justify-end mb-2">{topToggle}</div>}
      {modelStackedBarData.bars.length === 0 ? (
        <p className="text-xs text-fg-faint text-center py-16">无数据</p>
      ) : (
        <div className={compactChartShell(compactTrendLayout, isPaper)}>
          <ResponsiveContainer width="100%" height={bars.height}>
            <ModelStackedBarChart
              bars={modelStackedBarData.bars}
              layerCount={modelStackedBarData.layerCount}
              metric="cost"
              stackId="models"
              barsLayout={bars}
              gridStroke={gridStroke}
              tickFill={tickFill}
              surface={chartColors.surface}
              border={chartColors.border}
              paper={chartColors.paper}
            />
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )

  const tokenModelChart = (
    <div className={isPaper ? undefined : 'panel p-4'}>
      {!isPaper && (
        <h4 className="text-[11px] font-medium text-fg-muted mb-4">
          按模型堆叠（Token Top {topModelCount}）
        </h4>
      )}
      {modelTokenStackedBarData.bars.length === 0 ? (
        <p className="text-xs text-fg-faint text-center py-16">无数据</p>
      ) : (
        <div className={compactChartShell(compactTrendLayout, isPaper)}>
          <ResponsiveContainer width="100%" height={bars.height}>
            <ModelStackedBarChart
              bars={modelTokenStackedBarData.bars}
              layerCount={modelTokenStackedBarData.layerCount}
              metric="tokens"
              stackId="models-token"
              barsLayout={bars}
              gridStroke={gridStroke}
              tickFill={tickFill}
              surface={chartColors.surface}
              border={chartColors.border}
              paper={chartColors.paper}
            />
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )

  const fastLineChart = (
    <div className={isPaper ? undefined : 'panel p-4'}>
      {!isPaper && (
        <h4 className="text-[11px] font-medium text-fg-muted mb-4">
          总量 & Fast 比例
        </h4>
      )}
      <div className={compactChartShell(compactTrendLayout, isPaper)}>
        <ResponsiveContainer width="100%" height={bars.height}>
          <LineChart data={chartData}>
            <CartesianGrid {...chartGridProps(gridStroke)} />
            <XAxis
              dataKey="label"
              tick={{ fill: tickFill, fontSize: isPaper ? 13 : 11 }}
              tickLine={false}
              axisLine={isPaper ? { stroke: '#404040' } : undefined}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: tickFill, fontSize: isPaper ? 13 : 11 }}
              tickFormatter={(v) => `${v}%`}
              width={bars.yAxisWidth}
              tickLine={false}
              axisLine={isPaper ? { stroke: '#404040' } : false}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: tickFill, fontSize: isPaper ? 13 : 11 }}
              tickFormatter={(v) => `${v}M`}
              width={bars.yAxisWidth}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip contentStyle={tooltipBoxStyle(chartColors.surface, chartColors.border)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="fastRatio"
              name="Fast %"
              stroke={chartColors.poolFirst}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="tokens"
              name="Token (M)"
              stroke={chartColors.poolApi}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )

  const poolBarChart = (
    <div className={isPaper ? undefined : 'panel p-4'}>
      {!isPaper && (
        <h4 className="text-[11px] font-medium text-fg-muted mb-4">
          Auto / First-party / API 池（Token）
        </h4>
      )}
      <div className={compactChartShell(compactTrendLayout, isPaper)}>
        <ResponsiveContainer width="100%" height={bars.height}>
          <BarChart data={poolChartData} barCategoryGap={bars.categoryGap}>
            {paperHatchDefs(
              'period-pool',
              [poolColors.Auto, poolColors.FirstParty, poolColors.API],
              chartColors.paper,
              chartColors.surface,
            )}
            <CartesianGrid {...chartGridProps(gridStroke)} />
            <XAxis
              dataKey="label"
              tick={{ fill: tickFill, fontSize: isPaper ? 13 : 11 }}
              tickLine={false}
              axisLine={isPaper ? { stroke: '#404040' } : undefined}
            />
            <YAxis
              tick={{ fill: tickFill, fontSize: isPaper ? 13 : 11 }}
              tickFormatter={(v) => `${v}M`}
              width={bars.yAxisWidth}
              tickLine={false}
              axisLine={isPaper ? { stroke: '#404040' } : false}
            />
            <Tooltip contentStyle={tooltipBoxStyle(chartColors.surface, chartColors.border)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar
              dataKey="tokensAuto"
              name="Auto"
              stackId="pool-tokens"
              maxBarSize={bars.maxBarSize}
              {...paperBarProps('period-pool', poolColors.Auto, 0, chartColors.paper)}
            />
            <Bar
              dataKey="tokensFirstParty"
              name="First-party"
              stackId="pool-tokens"
              maxBarSize={bars.maxBarSize}
              {...paperBarProps('period-pool', poolColors.FirstParty, 1, chartColors.paper)}
            />
            <Bar
              dataKey="tokensAPI"
              name="API"
              stackId="pool-tokens"
              maxBarSize={bars.maxBarSize}
              radius={chartColors.paper ? [0, 0, 0, 0] : [4, 4, 0, 0]}
              {...paperBarProps('period-pool', poolColors.API, 2, chartColors.paper)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )

  const controls = (
    <>
      <div className="flex gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
        <button
          type="button"
          onClick={() => setViewMode('billing')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            viewMode === 'billing'
              ? 'bg-surface text-violet'
              : 'text-fg-muted hover:text-fg hover:bg-surface'
          }`}
        >
          账单周期
        </button>
        <button
          type="button"
          onClick={() => setViewMode('calendar')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            viewMode === 'calendar'
              ? 'bg-surface text-violet'
              : 'text-fg-muted hover:text-fg hover:bg-surface'
          }`}
        >
          自然月
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-fg-muted">
        账单起始日
        <input
          type="number"
          min={dayMin}
          max={dayMax}
          value={billingCycleDay}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) {
              setBillingCycleDay(Math.min(dayMax, Math.max(dayMin, Math.round(n))))
            }
          }}
          className="w-16 bg-surface-2 border border-line rounded-lg px-2 py-1 text-xs text-fg
                     focus:outline-none focus:border-violet"
        />
        日
      </label>

      <button
        type="button"
        onClick={() => setBillingCycleDay(data.defaultBillingCycleDay ?? 23)}
        className="text-xs text-fg-faint hover:text-fg underline underline-offset-2"
      >
        恢复默认 ({data.defaultBillingCycleDay ?? 23})
      </button>
    </>
  )

  return (
    <div className={isPaper ? 'paper-overview' : 'space-y-6'}>
      {isPaper ? (
        <section className="paper-masthead">
          <div className="paper-masthead-copy">
            <h2 className="paper-thesis">
              {latestPeriodThesis(activeGroup.periods, viewMode)}
            </h2>
            <p className="paper-kicker">
              {viewMode === 'billing'
                ? `账单周期按起始日 ${billingCycleDay} 切段，不是日历月。`
                : '自然月按日期字符串的年-月聚合。'}
            </p>
            {identitySummary && (
              <p className="paper-lede">多身份合计：{identitySummary}</p>
            )}
            {latest && (
              <p className="paper-facts">
                {latest.label} · {fmtUsd(latest.totalCost)} · {fmtTokens(latest.totalTokens)} token ·{' '}
                {activeGroup.periods.length} 个周期
              </p>
            )}
          </div>
          <div className="paper-masthead-num">
            {latest && <p className="paper-hero-value">{fmtUsd(latest.totalCost)}</p>}
            <div className="paper-date-strip">{controls}</div>
          </div>
        </section>
      ) : (
        <section className="flex flex-wrap items-center gap-4 panel bg-surface-2 px-4 py-3">
          {controls}
          <span className="ml-auto text-xs text-fg-faint font-mono">
            {activeGroup.periods.length} 个周期 · {data.ms ?? 0}ms
          </span>
        </section>
      )}

      {chartData.length > 0 && poolChartData.length > 0 && (
        isPaper ? (
          <div className="paper-grid">
            <PaperFigure
              thesis="花费从哪些模型来"
              kicker={`按模型堆叠 equivalent USD · Top ${topModelCount}`}
              lede="每个柱是该周期全部请求按公开费率加总，再按模型切开。"
            >
              {costModelChart}
            </PaperFigure>
            <PaperFigure
              thesis="Token 从哪些模型来"
              kicker={`按模型堆叠 token · Top ${topModelCount}`}
              lede="口径与左图相同周期，纵轴是 token 百万。"
            >
              {tokenModelChart}
            </PaperFigure>
            <PaperFigure
              thesis="Fast 占比和总量一起走"
              kicker="Fast % · Token (M)"
              lede="左轴 Fast 行占比，右轴该周期 token 百万。不是 Cursor 发票。"
            >
              {fastLineChart}
            </PaperFigure>
            <PaperFigure
              thesis="三个池的 token 怎么分"
              kicker="Auto / First-party / API"
              lede="池由 billingPool 与模型费率表划分。"
            >
              {poolBarChart}
            </PaperFigure>
          </div>
        ) : (
        <>
          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-widest text-fg-faint">
              花费趋势
            </h3>
            <div className={trendGridClass(compactTrendLayout, false)}>
              {costModelChart}
              {tokenModelChart}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-widest text-fg-faint">
              Token 趋势
            </h3>
            <div className={trendGridClass(compactTrendLayout, false)}>
              {fastLineChart}
              {poolBarChart}
            </div>
          </section>
        </>
        )
      )}

      <section className={`panel overflow-hidden ${isPaper ? 'paper-period-table' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-2 text-left text-fg-faint uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">周期</th>
                <th className="px-4 py-3 font-medium text-right">花费</th>
                <th className="px-4 py-3 font-medium text-right">环比</th>
                <th className="px-4 py-3 font-medium text-right">Token</th>
                <th className="px-4 py-3 font-medium text-right">Auto%</th>
                <th className="px-4 py-3 font-medium text-right">First-party%</th>
                <th className="px-4 py-3 font-medium text-right">API%</th>
                <th className="px-4 py-3 font-medium text-right">Fast%</th>
                <th className="px-4 py-3 font-medium text-right">请求</th>
                <th className="px-4 py-3 font-medium">Top 3 模型</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {[...activeGroup.periods].reverse().map((p) => {
                const costShare = getCostShare(p)
                const poolChanges = p.changes?.poolChanges
                return (
                <tr
                  key={p.key}
                  className="hover:bg-surface-2 transition-colors"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-fg">{p.label}</p>
                    {!(isPaper && p.label.replace('→', '~').includes(p.startDate)) && (
                      <p className="text-[10px] text-fg-faint font-mono">{p.startDate} ~ {p.endDate}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-accent">
                    {fmtUsd(p.totalCost)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChangeBadge value={p.changes?.costPct} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fmtTokens(p.totalTokens)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono" style={{ color: poolColors.Auto }}>{fmtPct(costShare.Auto)}</span>
                    {poolChanges?.Auto && (
                      <p className={`text-[10px] font-mono ${changeColor(poolChanges.Auto.costShareDelta)}`}>
                        {fmtShareDelta(poolChanges.Auto.costShareDelta)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono" style={{ color: poolColors.FirstParty }}>{fmtPct(costShare.FirstParty)}</span>
                    {poolChanges?.FirstParty && (
                      <p className={`text-[10px] font-mono ${changeColor(poolChanges.FirstParty.costShareDelta)}`}>
                        {fmtShareDelta(poolChanges.FirstParty.costShareDelta)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono" style={{ color: poolColors.API }}>{fmtPct(costShare.API)}</span>
                    {poolChanges?.API && (
                      <p className={`text-[10px] font-mono ${changeColor(poolChanges.API.costShareDelta)}`}>
                        {fmtShareDelta(poolChanges.API.costShareDelta)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fmtPct(p.fastRatio)}</td>
                  <td className="px-4 py-3 text-right font-mono">{p.totalRows.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.topModels.map((m) => (
                        <span
                          key={m.model}
                          className={
                            isPaper
                              ? 'paper-model-chip font-mono text-fg'
                              : 'inline-block rounded-md bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted'
                          }
                          title={`${fmtUsd(m.cost)} · ${fmtTokens(m.tokens)}`}
                        >
                          {m.model}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      </section>

      {!isPaper && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...activeGroup.periods].reverse().map((p) => (
            <PeriodCard key={p.key} period={p} poolColors={poolColors} />
          ))}
        </section>
      )}
    </div>
  )
}
