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
import { useIsDark } from '../context/ThemeContext'

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
  Composer: number
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

const POOLS = ['Auto', 'Composer', 'API'] as const
const POOL_COLORS: Record<(typeof POOLS)[number], string> = {
  Auto: '#f59e0b',
  Composer: '#8b5cf6',
  API: '#06b6d4',
}

const PIE_OTHER_COLOR = { light: '#94a3b8', dark: '#475569' }
const MODEL_HUES = [160, 270, 200, 38, 330, 220, 15, 280, 120, 350, 190, 45, 300, 80, 250, 170, 310, 55, 230, 100]

function modelSeriesColor(index: number, isDark: boolean): string {
  const h = MODEL_HUES[index % MODEL_HUES.length]
  return `hsl(${h}, 62%, ${isDark ? '52%' : '46%'})`
}

const BILLING_DAY_STORAGE_KEY = 'cursor-dashboard-billing-cycle-day'
/** 周期数达到此值时，趋势图改为单列全宽 */
const FULL_WIDTH_MODEL_CHART_MIN_PERIODS = 9

function compactChartShell(compact: boolean): string {
  return compact ? 'mx-auto w-full max-w-[280px] sm:max-w-xs' : 'w-full'
}

function trendGridClass(compact: boolean): string {
  return compact ? 'grid gap-6 md:grid-cols-2' : 'grid gap-6 grid-cols-1'
}

function barLayout(compact: boolean, periodCount: number) {
  return {
    height: compact ? 200 : 260,
    maxBarSize: compact
      ? Math.min(36, Math.max(20, Math.floor(280 / Math.max(periodCount, 1))))
      : Math.min(48, Math.max(24, Math.floor(720 / Math.max(periodCount, 1)))),
    categoryGap: compact ? '28%' : '12%',
    yAxisWidth: compact ? 44 : 52,
  }
}

const tooltipBoxStyle = (isDark: boolean, gridStroke: string) => ({
  background: isDark ? '#0f172a' : '#fff',
  border: `1px solid ${gridStroke}`,
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
  if (n == null) return 'text-slate-400'
  if (n > 0.05) return 'text-red-500 dark:text-red-400'
  if (n < -0.05) return 'text-emerald-600 dark:text-emerald-400'
  return 'text-slate-500 dark:text-slate-400'
}

function fmtShareDelta(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${(n * 100).toFixed(1)}pt`
}

function poolSharesFallback(
  byPool: PoolValues,
  total: number,
): PoolValues {
  return {
    Auto: total > 0 ? byPool.Auto / total : 0,
    Composer: total > 0 ? byPool.Composer / total : 0,
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
) {
  const otherColor = isDark ? PIE_OTHER_COLOR.dark : PIE_OTHER_COLOR.light
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
    modelColorMap.set(key, modelSeriesColor(i, isDark))
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
  isDark,
  gridStroke,
  metric,
  bars,
}: {
  active?: boolean
  label?: string
  isDark: boolean
  gridStroke: string
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
      className="rounded-lg px-3 py-2 shadow-xl text-xs min-w-[140px] max-w-[220px]"
      style={{
        background: isDark ? '#0f172a' : '#fff',
        border: `1px solid ${gridStroke}`,
      }}
    >
      <p className="mb-1.5 font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {items.map((m) => (
        <div key={m.key} className="flex justify-between gap-3 mb-0.5">
          <span className="truncate" style={{ color: m.color }} title={m.key}>
            {m.key}
          </span>
          <span className="font-mono shrink-0 text-slate-700 dark:text-slate-300">
            {fmtVal(m.value)}
          </span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-slate-200 dark:border-slate-700 pt-1 flex justify-between">
        <span className="text-slate-400">合计</span>
        <span className="font-mono font-medium text-slate-800 dark:text-slate-100">
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
  isDark: boolean
}

function ModelStackedBarChart({
  bars,
  layerCount,
  metric,
  stackId,
  barsLayout,
  gridStroke,
  tickFill,
  isDark,
}: ModelStackedBarChartProps) {
  return (
    <BarChart data={bars} barCategoryGap={barsLayout.categoryGap}>
      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
      <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} />
      <YAxis
        tick={{ fill: tickFill, fontSize: 11 }}
        tickFormatter={(v) => (metric === 'cost' ? `$${v}` : `${v}M`)}
        width={barsLayout.yAxisWidth}
      />
      <Tooltip
        content={
          <ModelStackTooltip
            isDark={isDark}
            gridStroke={gridStroke}
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
            layerIdx === layerCount - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
          }
          isAnimationActive={false}
        >
          {bars.map((entry, index) => (
            <Cell
              key={`${layerIdx}-${index}`}
              fill={entry.__layerMeta[layerIdx]?.color ?? 'transparent'}
            />
          ))}
        </Bar>
      ))}
    </BarChart>
  )
}

// ────────── 子组件 ──────────

function ChangeBadge({ value, suffix = '' }: { value: number | null | undefined; suffix?: string }) {
  if (value == null) return <span className="text-slate-400 dark:text-slate-600 text-xs">—</span>
  return (
    <span className={`text-xs font-mono ${changeColor(value)}`}>
      {fmtChange(value)}{suffix}
    </span>
  )
}

interface PeriodCardProps {
  period: PeriodEntry
}

function PoolBreakdown({ period }: { period: PeriodEntry }) {
  const costShare = getCostShare(period)
  const tokenShare = getTokenShare(period)
  const poolChanges = period.changes?.poolChanges

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-400">池子分布 Auto / Composer / API</p>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        {POOLS.map((pool) => (
          <div
            key={pool}
            className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-2"
            style={{ borderLeftWidth: 3, borderLeftColor: POOL_COLORS[pool] }}
          >
            <p className="font-medium text-slate-600 dark:text-slate-300">{pool}</p>
            <p className="font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
              {fmtUsd(period.costByPool[pool])}
            </p>
            <p className="font-mono text-sky-600 dark:text-sky-400 text-[10px]">
              {fmtTokens(period.tokensByPool[pool])}
            </p>
            <p className="text-slate-400 mt-1">
              花费 {fmtPct(costShare[pool])} · Token {fmtPct(tokenShare[pool])}
            </p>
            {poolChanges?.[pool] && (
              <p className="text-[10px] mt-1 space-x-1">
                <span className={changeColor(poolChanges[pool].costPct)}>
                  {fmtChange(poolChanges[pool].costPct)}
                </span>
                <span className="text-slate-400">·</span>
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

function PeriodCard({ period }: PeriodCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-5 shadow-sm space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {period.label}
          </h3>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
            {period.startDate} → {period.endDate}
          </p>
        </div>
        {period.changes && (
          <div className="text-right space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">环比</p>
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
          <p className="text-[10px] uppercase tracking-wider text-slate-400">花费</p>
          <p className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
            {fmtUsd(period.totalCost)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">Token</p>
          <p className="text-lg font-bold font-mono text-sky-600 dark:text-sky-400">
            {fmtTokens(period.totalTokens)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">Fast 占比</p>
          <p className="text-lg font-bold font-mono text-violet-600 dark:text-violet-400">
            {fmtPct(period.fastRatio)}
          </p>
          {period.changes && (
            <ChangeBadge value={period.changes.fastRatioDelta} suffix=" pt" />
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400">请求数</p>
          <p className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400">
            {period.totalRows.toLocaleString()}
          </p>
        </div>
      </div>

      <PoolBreakdown period={period} />

      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Top 3 模型（按花费）</p>
        {period.topModels.length === 0 ? (
          <p className="text-xs text-slate-400">无数据</p>
        ) : (
          <ol className="space-y-1.5">
            {period.topModels.map((m, i) => (
              <li
                key={m.model}
                className="flex items-center justify-between gap-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold">
                    {i + 1}
                  </span>
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {m.model}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-slate-500 dark:text-slate-400">
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

export function PeriodStatsView({ refreshKey }: { refreshKey?: number }) {
  const isDark = useIsDark()
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
        params: { billingCycleDay },
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
  }, [billingCycleDay, refreshKey])

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

  const modelStackedBarData = useMemo(() => {
    if (!activeGroup) return { bars: [], layerCount: 0, uniqueModelCount: 0 }
    return buildModelStackedBarData(
      activeGroup.periods,
      viewMode,
      topModelCount,
      isDark,
      'cost',
    )
  }, [activeGroup, viewMode, topModelCount, isDark])

  const modelTokenStackedBarData = useMemo(() => {
    if (!activeGroup) return { bars: [], layerCount: 0, uniqueModelCount: 0 }
    return buildModelStackedBarData(
      activeGroup.periods,
      viewMode,
      topModelCount,
      isDark,
      'tokens',
    )
  }, [activeGroup, viewMode, topModelCount, isDark])

  const poolChartData = useMemo(() => {
    if (!activeGroup) return []
    return activeGroup.periods.map((p) => {
      const costShare = getCostShare(p)
      const tokenShare = getTokenShare(p)
      return {
        label: shortPeriodLabel(p, viewMode),
        costAuto: p.costByPool.Auto,
        costComposer: p.costByPool.Composer,
        costAPI: p.costByPool.API,
        tokensAuto: p.tokensByPool.Auto / 1_000_000,
        tokensComposer: p.tokensByPool.Composer / 1_000_000,
        tokensAPI: p.tokensByPool.API / 1_000_000,
        shareAutoCost: costShare.Auto * 100,
        shareComposerCost: costShare.Composer * 100,
        shareAPICost: costShare.API * 100,
        shareAutoToken: tokenShare.Auto * 100,
        shareComposerToken: tokenShare.Composer * 100,
        shareAPIToken: tokenShare.API * 100,
      }
    })
  }, [activeGroup, viewMode])

  const gridStroke = isDark ? '#334155' : '#e2e8f0'
  const tickFill = isDark ? '#64748b' : '#94a3b8'

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/60" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/60" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-600 dark:text-red-400">
        加载周期统计失败：{error}
      </div>
    )
  }

  if (!data || !activeGroup) return null

  const dayMin = data.billingCycleDayRange?.min ?? 1
  const dayMax = data.billingCycleDayRange?.max ?? 28
  const periodCount = chartData.length
  const compactTrendLayout = periodCount < FULL_WIDTH_MODEL_CHART_MIN_PERIODS
  const bars = barLayout(compactTrendLayout, periodCount)

  return (
    <div className="space-y-6">
      {/* 控制栏 */}
      <section className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/40 px-4 py-3">
        <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('billing')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'billing'
                ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            账单周期
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'calendar'
                ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            自然月
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
            className="w-16 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-700 dark:text-slate-200
                       focus:outline-none focus:border-violet-500"
          />
          日
        </label>

        <button
          type="button"
          onClick={() => setBillingCycleDay(data.defaultBillingCycleDay ?? 23)}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-2"
        >
          恢复默认 ({data.defaultBillingCycleDay ?? 23})
        </button>

        <span className="ml-auto text-xs text-slate-400 dark:text-slate-600 font-mono">
          {activeGroup.periods.length} 个周期 · {data.ms ?? 0}ms
        </span>
      </section>

      {/* 花费趋势 + Token 趋势 */}
      {chartData.length > 0 && poolChartData.length > 0 && (
        <>
          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400">
              花费趋势
            </h3>
            <div className={trendGridClass(compactTrendLayout)}>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <h4 className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    按模型堆叠（Top {topModelCount}）
                  </h4>
                  <div className="flex gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5">
                    {([3, 5] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTopModelCount(n)}
                        className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors ${
                          topModelCount === n
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                      >
                        Top {n}
                      </button>
                    ))}
                  </div>
                </div>
                {modelStackedBarData.bars.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-16">无数据</p>
                ) : (
                  <div className={compactChartShell(compactTrendLayout)}>
                    <ResponsiveContainer width="100%" height={bars.height}>
                      <ModelStackedBarChart
                        bars={modelStackedBarData.bars}
                        layerCount={modelStackedBarData.layerCount}
                        metric="cost"
                        stackId="models"
                        barsLayout={bars}
                        gridStroke={gridStroke}
                        tickFill={tickFill}
                        isDark={isDark}
                      />
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4">
                <h4 className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-4">
                  按模型堆叠（Token Top {topModelCount}）
                </h4>
                {modelTokenStackedBarData.bars.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-16">无数据</p>
                ) : (
                  <div className={compactChartShell(compactTrendLayout)}>
                    <ResponsiveContainer width="100%" height={bars.height}>
                      <ModelStackedBarChart
                        bars={modelTokenStackedBarData.bars}
                        layerCount={modelTokenStackedBarData.layerCount}
                        metric="tokens"
                        stackId="models-token"
                        barsLayout={bars}
                        gridStroke={gridStroke}
                        tickFill={tickFill}
                        isDark={isDark}
                      />
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400">
              Token 趋势
            </h3>
            <div className={trendGridClass(compactTrendLayout)}>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4">
                <h4 className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-4">
                  总量 & Fast 比例
                </h4>
                <div className={compactChartShell(compactTrendLayout)}>
                  <ResponsiveContainer width="100%" height={bars.height}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} />
                      <YAxis
                        yAxisId="left"
                        tick={{ fill: tickFill, fontSize: 11 }}
                        tickFormatter={(v) => `${v}%`}
                        width={bars.yAxisWidth}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fill: tickFill, fontSize: 11 }}
                        tickFormatter={(v) => `${v}M`}
                        width={bars.yAxisWidth}
                      />
                      <Tooltip contentStyle={tooltipBoxStyle(isDark, gridStroke)} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="fastRatio"
                        name="Fast %"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="tokens"
                        name="Token (M)"
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4">
                <h4 className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-4">
                  Auto / Composer / API 池（Token）
                </h4>
                <div className={compactChartShell(compactTrendLayout)}>
                  <ResponsiveContainer width="100%" height={bars.height}>
                    <BarChart data={poolChartData} barCategoryGap={bars.categoryGap}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} />
                      <YAxis
                        tick={{ fill: tickFill, fontSize: 11 }}
                        tickFormatter={(v) => `${v}M`}
                        width={bars.yAxisWidth}
                      />
                      <Tooltip contentStyle={tooltipBoxStyle(isDark, gridStroke)} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar
                        dataKey="tokensAuto"
                        name="Auto"
                        stackId="pool-tokens"
                        fill={POOL_COLORS.Auto}
                        maxBarSize={bars.maxBarSize}
                      />
                      <Bar
                        dataKey="tokensComposer"
                        name="Composer"
                        stackId="pool-tokens"
                        fill={POOL_COLORS.Composer}
                        maxBarSize={bars.maxBarSize}
                      />
                      <Bar
                        dataKey="tokensAPI"
                        name="API"
                        stackId="pool-tokens"
                        fill={POOL_COLORS.API}
                        maxBarSize={bars.maxBarSize}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* 汇总表 */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/80 text-left text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-3 font-medium">周期</th>
                <th className="px-4 py-3 font-medium text-right">花费</th>
                <th className="px-4 py-3 font-medium text-right">环比</th>
                <th className="px-4 py-3 font-medium text-right">Token</th>
                <th className="px-4 py-3 font-medium text-right">Auto%</th>
                <th className="px-4 py-3 font-medium text-right">Composer%</th>
                <th className="px-4 py-3 font-medium text-right">API%</th>
                <th className="px-4 py-3 font-medium text-right">Fast%</th>
                <th className="px-4 py-3 font-medium text-right">请求</th>
                <th className="px-4 py-3 font-medium">Top 3 模型</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {[...activeGroup.periods].reverse().map((p) => {
                const costShare = getCostShare(p)
                const poolChanges = p.changes?.poolChanges
                return (
                <tr
                  key={p.key}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-700 dark:text-slate-200">{p.label}</p>
                    <p className="text-[10px] text-slate-400 font-mono">{p.startDate} ~ {p.endDate}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                    {fmtUsd(p.totalCost)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChangeBadge value={p.changes?.costPct} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fmtTokens(p.totalTokens)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono" style={{ color: POOL_COLORS.Auto }}>{fmtPct(costShare.Auto)}</span>
                    {poolChanges?.Auto && (
                      <p className={`text-[10px] font-mono ${changeColor(poolChanges.Auto.costShareDelta)}`}>
                        {fmtShareDelta(poolChanges.Auto.costShareDelta)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono" style={{ color: POOL_COLORS.Composer }}>{fmtPct(costShare.Composer)}</span>
                    {poolChanges?.Composer && (
                      <p className={`text-[10px] font-mono ${changeColor(poolChanges.Composer.costShareDelta)}`}>
                        {fmtShareDelta(poolChanges.Composer.costShareDelta)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono" style={{ color: POOL_COLORS.API }}>{fmtPct(costShare.API)}</span>
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
                          className="inline-block rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-600 dark:text-slate-300"
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

      {/* 周期卡片 */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...activeGroup.periods].reverse().map((p) => (
          <PeriodCard key={p.key} period={p} />
        ))}
      </section>
    </div>
  )
}
