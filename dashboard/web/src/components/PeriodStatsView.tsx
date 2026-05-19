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

interface PeriodChanges {
  costPct: number | null
  tokensPct: number | null
  rowsPct: number | null
  fastRatioDelta: number
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
  costByPool: { Auto: number; Composer: number; API: number }
  tokensByPool: { Auto: number; Composer: number; API: number }
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

const BILLING_DAY_STORAGE_KEY = 'cursor-dashboard-billing-cycle-day'

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

function shortPeriodLabel(p: PeriodEntry, mode: ViewMode): string {
  if (mode === 'calendar') {
    const [, m] = p.key.split('-')
    return `${Number(m)}月`
  }
  const start = p.startDate.slice(5).replace('-', '/')
  return start
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
  mode: ViewMode
}

function PeriodCard({ period, mode }: PeriodCardProps) {
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

      {mode === 'billing' && (
        <div className="grid grid-cols-3 gap-2 text-[11px]">
          {(['Auto', 'Composer', 'API'] as const).map((pool) => (
            <div
              key={pool}
              className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5 text-center"
            >
              <p className="text-slate-400">{pool}</p>
              <p className="font-mono font-medium">{fmtUsd(period.costByPool[pool])}</p>
            </div>
          ))}
        </div>
      )}
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

      {/* 趋势图 */}
      {chartData.length > 0 && (
        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4">
            <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-4">
              花费趋势
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} />
                <YAxis tick={{ fill: tickFill, fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{
                    background: isDark ? '#0f172a' : '#fff',
                    border: `1px solid ${gridStroke}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="cost" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 p-4">
            <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-4">
              Fast 比例 & Token 量
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="label" tick={{ fill: tickFill, fontSize: 11 }} />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: tickFill, fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: tickFill, fontSize: 11 }}
                  tickFormatter={(v) => `${v}M`}
                />
                <Tooltip
                  contentStyle={{
                    background: isDark ? '#0f172a' : '#fff',
                    border: `1px solid ${gridStroke}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
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
        </section>
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
                <th className="px-4 py-3 font-medium text-right">Fast%</th>
                <th className="px-4 py-3 font-medium text-right">请求</th>
                <th className="px-4 py-3 font-medium">Top 3 模型</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {[...activeGroup.periods].reverse().map((p) => (
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
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 周期卡片 */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...activeGroup.periods].reverse().map((p) => (
          <PeriodCard key={p.key} period={p} mode={viewMode} />
        ))}
      </section>
    </div>
  )
}
