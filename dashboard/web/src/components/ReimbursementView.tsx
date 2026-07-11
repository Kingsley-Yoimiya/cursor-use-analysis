/**
 * 报销导出视图：按账单周期分月展示，支持批量生成 PNG 截图
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { DailyEntry } from '../App'
import {
  exportElementToPng,
  exportManyElementsToPng,
  sanitizeFilenamePart,
} from '../utils/exportCardToPng'

// ────────── 类型 ──────────

interface ModelStat {
  model: string
  requests: number
  tokens: number
  cost: number
}

interface PoolValues {
  Auto: number
  FirstParty: number
  API: number
}

interface PeriodEntry {
  key: string
  label: string
  startDate: string
  endDate: string
  /** 周期内最后一日用量（次月刷新日前一天） */
  dataEndDate?: string
  totalTokens: number
  totalCost: number
  totalRows: number
  costByPool: PoolValues
  costShareByPool?: PoolValues
  topModels: ModelStat[]
  modelFrequency: ModelStat[]
}

interface PeriodGroup {
  periods: PeriodEntry[]
}

interface PeriodStatsResponse {
  ok: boolean
  billingCycleDay?: number
  defaultBillingCycleDay?: number
  billingCycleDayRange?: { min: number; max: number }
  billingCycles?: PeriodGroup
  error?: string
}

interface ReimbursementProfile {
  employeeName: string
  employeeEmail: string
  department: string
  purpose: string
  currency: string
}

interface ProfileResponse {
  ok: boolean
  profile?: ReimbursementProfile
  defaultBillingCycleDay?: number
  billingCycleDayRange?: { min: number; max: number }
  generatedAt?: string | null
  disclaimer?: string
  error?: string
}

const BILLING_DAY_STORAGE_KEY = 'cursor-dashboard-billing-cycle-day'
const PROFILE_STORAGE_KEY = 'cursor-dashboard-reimbursement-profile'

const POOLS = ['Auto', 'FirstParty', 'API'] as const
const POOL_COLORS: Record<(typeof POOLS)[number], string> = {
  Auto: '#d97706',
  FirstParty: '#7c3aed',
  API: '#0891b2',
}
const POOL_LABELS: Record<(typeof POOLS)[number], string> = {
  Auto: 'Auto',
  FirstParty: 'First-party',
  API: 'API',
}

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
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function poolSharesFallback(byPool: PoolValues, total: number): PoolValues {
  return {
    Auto: total > 0 ? byPool.Auto / total : 0,
    FirstParty: total > 0 ? byPool.FirstParty / total : 0,
    API: total > 0 ? byPool.API / total : 0,
  }
}

function fmtShortDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[1]}/${parts[2]}`
}

function periodTitle(period: PeriodEntry): string {
  return `账单周期 · ${period.label}`
}

function buildUsageCsvExportUrl(
  billingCycleDay: number,
  periodKey?: string,
): string {
  const params = new URLSearchParams({
    billingCycleDay: String(billingCycleDay),
  })
  if (periodKey) params.set('periodKey', periodKey)
  return `/api/export/usage-with-cost.csv?${params.toString()}`
}

// ────────── 单月报销卡片（固定浅色，便于截图） ──────────

interface MonthCardProps {
  period: PeriodEntry
  dailyInPeriod: DailyEntry[]
  profile: ReimbursementProfile
  generatedAt: string | null
  disclaimer: string
}

function ReimbursementMonthCard({
  period,
  dailyInPeriod,
  profile,
  generatedAt,
  disclaimer,
}: MonthCardProps) {
  const costShare =
    period.costShareByPool ??
    poolSharesFallback(period.costByPool, period.totalCost)

  const topModels = useMemo(() => {
    const source =
      period.modelFrequency.length > 0
        ? period.modelFrequency
        : period.topModels
    return [...source].sort((a, b) => b.cost - a.cost).slice(0, 5)
  }, [period])

  const dailyChartData = useMemo(
    () =>
      dailyInPeriod.map((d) => ({
        date: fmtShortDate(d.date),
        cost: d.cost,
        rows: d.rows,
      })),
    [dailyInPeriod],
  )

  const activeDays = dailyInPeriod.filter((d) => d.cost > 0).length

  return (
    <article
      id={`reimburse-card-${period.key}`}
      className="reimburse-export-card mx-auto w-full max-w-[920px] overflow-visible rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm"
      style={{ colorScheme: 'light', overflow: 'visible' }}
    >
      {/* 标题区 */}
      <header className="border-b border-slate-200 pb-4 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">
              Cursor AI 开发工具 · 用量报销单
            </p>
            <h2 className="text-lg font-bold text-slate-900 mt-1">
              {periodTitle(period)}
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-1">
              {period.startDate} → {period.endDate}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              周期合计（估算）
            </p>
            <p className="text-2xl font-bold font-mono text-emerald-700">
              {fmtUsd(period.totalCost)}
            </p>
          </div>
        </div>
      </header>

      {/* 报销人信息（导出不含部门；纵向排列避免截图裁切） */}
      <section className="grid grid-cols-1 gap-2 mb-4 text-xs">
        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-slate-400 mb-0.5">报销人</p>
          <p className="font-medium text-slate-800 break-words">
            {profile.employeeName || '（未填写）'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 min-w-0">
          <p className="text-slate-400 mb-0.5">邮箱</p>
          <p className="font-medium text-slate-800 break-all leading-relaxed">
            {profile.employeeEmail || '—'}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 min-w-0">
          <p className="text-slate-400 mb-0.5">用途说明</p>
          <p className="font-medium text-slate-800 break-words leading-relaxed whitespace-normal">
            {profile.purpose || '—'}
          </p>
        </div>
      </section>

      {/* 核心指标 */}
      <section className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg border border-slate-100 px-3 py-2">
          <p className="text-[10px] text-slate-400 uppercase">API 请求次数</p>
          <p className="text-base font-bold font-mono text-amber-700">
            {period.totalRows.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 px-3 py-2">
          <p className="text-[10px] text-slate-400 uppercase">Token 总量</p>
          <p className="text-base font-bold font-mono text-sky-700">
            {fmtTokens(period.totalTokens)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 px-3 py-2">
          <p className="text-[10px] text-slate-400 uppercase">有花费天数</p>
          <p className="text-base font-bold font-mono text-violet-700">
            {activeDays} / {dailyInPeriod.length}
          </p>
        </div>
      </section>

      {/* 池子分布 */}
      <section className="mb-4">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">
          花费分类（Auto / First-party / API）
        </p>
        <div className="grid grid-cols-3 gap-2">
          {POOLS.map((pool) => (
            <div
              key={pool}
              className="rounded-lg border px-3 py-2"
              style={{ borderLeftWidth: 3, borderLeftColor: POOL_COLORS[pool] }}
            >
              <p className="text-xs font-semibold text-slate-700">{POOL_LABELS[pool]}</p>
              <p className="font-mono text-sm text-emerald-700 font-bold mt-0.5">
                {fmtUsd(period.costByPool[pool])}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                占比 {fmtPct(costShare[pool])}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Top 模型 */}
      <section className="mb-4">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">
          花费 Top 模型
        </p>
        {topModels.length === 0 ? (
          <p className="text-xs text-slate-400">本周期无模型数据</p>
        ) : (
          <table className="w-full text-xs border border-slate-100 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-left">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">模型</th>
                <th className="px-3 py-2 font-medium text-right">花费</th>
                <th className="px-3 py-2 font-medium text-right">占比</th>
                <th className="px-3 py-2 font-medium text-right">请求</th>
              </tr>
            </thead>
            <tbody>
              {topModels.map((m, i) => (
                <tr key={m.model} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{m.model}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-700">
                    {fmtUsd(m.cost)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">
                    {period.totalCost > 0
                      ? fmtPct(m.cost / period.totalCost)
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500">
                    {m.requests.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 每日花费 */}
      <section className="mb-4">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">
          每日 API 等效花费（USD）
        </p>
        {dailyChartData.length === 0 ? (
          <p className="text-xs text-slate-400 py-8 text-center">本周期无每日数据</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748b', fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickFormatter={(v: number) => `$${v.toFixed(1)}`}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelFormatter={(label) => `日期 ${label}`}
              />
              <Bar dataKey="cost" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <footer className="border-t border-slate-100 pt-3 text-[10px] text-slate-400 leading-relaxed">
        <p>{disclaimer}</p>
        {generatedAt && (
          <p className="mt-1 font-mono">数据生成时间：{generatedAt}</p>
        )}
      </footer>
    </article>
  )
}

// ────────── 主组件 ──────────

export function ReimbursementView({
  refreshKey,
  daily,
}: {
  refreshKey?: number
  daily: DailyEntry[] | null
}) {
  const [profile, setProfile] = useState<ReimbursementProfile>({
    employeeName: '',
    employeeEmail: '',
    department: '',
    purpose: 'Cursor AI 开发工具订阅用量',
    currency: 'USD',
  })
  const [periodData, setPeriodData] = useState<PeriodStatsResponse | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [disclaimer, setDisclaimer] = useState(
    '以下金额为按公开 API 单价估算的等效价值，不等同于实际发票，仅供内部报销参考。',
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<string | null>(null)
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
    const savedProfile = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (savedProfile) {
      try {
        const parsed = JSON.parse(savedProfile) as ReimbursementProfile
        setProfile((p) => ({ ...p, ...parsed }))
      } catch {
        /* ignore */
      }
    }

    setLoading(true)
    Promise.all([
      axios.get<ProfileResponse>('/api/reimbursement-profile'),
      axios.get<PeriodStatsResponse>('/api/period-stats', {
        params: { billingCycleDay },
      }),
    ])
      .then(([profileRes, periodRes]) => {
        if (profileRes.data.ok && profileRes.data.profile) {
          setProfile((prev) => {
            const merged = { ...prev, ...profileRes.data.profile! }
            const saved = localStorage.getItem(PROFILE_STORAGE_KEY)
            if (saved) {
              try {
                return { ...merged, ...JSON.parse(saved) }
              } catch {
                return merged
              }
            }
            return merged
          })
          setGeneratedAt(profileRes.data.generatedAt ?? null)
          if (profileRes.data.disclaimer) setDisclaimer(profileRes.data.disclaimer)
        }
        if (periodRes.data.ok) {
          setPeriodData(periodRes.data)
          setError(null)
        } else {
          setError(periodRes.data.error ?? '周期数据加载失败')
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoading(false))
  }, [billingCycleDay, refreshKey])

  const saveProfile = async () => {
    setSavingProfile(true)
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
    try {
      await axios.put('/api/reimbursement-profile', profile)
    } catch {
      /* 本地已保存，服务端失败不阻断 */
    } finally {
      setSavingProfile(false)
    }
  }

  const periods = useMemo(() => {
    if (!periodData?.billingCycles?.periods) return []
    return [...periodData.billingCycles.periods].reverse()
  }, [periodData])

  const dailyByPeriod = useMemo(() => {
    const map = new Map<string, DailyEntry[]>()
    if (!daily) return map
    for (const period of periods) {
      const lastDay = period.dataEndDate ?? period.endDate
      const slice = daily.filter(
        (d) => d.date >= period.startDate && d.date <= lastDay,
      )
      map.set(period.key, slice)
    }
    return map
  }, [daily, periods])

  const exportOne = useCallback(
    async (periodKey: string) => {
      const el = document.getElementById(`reimburse-card-${periodKey}`)
      if (!el) return
      const period = periods.find((p) => p.key === periodKey)
      const namePart = sanitizeFilenamePart(
        profile.employeeName || 'cursor',
      )
      const periodPart = sanitizeFilenamePart(period?.startDate ?? periodKey)
      await exportElementToPng(el as HTMLElement, {
        filename: `cursor-reimburse-${namePart}-${periodPart}.png`,
      })
    },
    [periods, profile.employeeName],
  )

  const exportAll = useCallback(async () => {
    setExporting(true)
    setExportProgress(null)
    const namePart = sanitizeFilenamePart(profile.employeeName || 'cursor')
    const items = periods
      .map((p) => {
        const el = document.getElementById(`reimburse-card-${p.key}`)
        if (!el) return null
        return {
          element: el as HTMLElement,
          filename: `cursor-reimburse-${namePart}-${sanitizeFilenamePart(p.startDate)}.png`,
        }
      })
      .filter(Boolean) as { element: HTMLElement; filename: string }[]

    try {
      await exportManyElementsToPng(items, (cur, total) => {
        setExportProgress(`${cur} / ${total}`)
      })
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }, [periods, profile.employeeName])

  const dayMin = periodData?.billingCycleDayRange?.min ?? 1
  const dayMax = periodData?.billingCycleDayRange?.max ?? 28

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/60" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="h-96 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/60"
          />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-600 dark:text-red-400">
        加载报销数据失败：{error}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/80 dark:bg-amber-950/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-200/90 leading-relaxed">
        <p className="font-medium mb-1">报销导出说明</p>
        <ul className="list-disc list-inside space-y-0.5 text-amber-700/90 dark:text-amber-200/80">
          <li>「每月」按账单刷新日划分（如 5.23～6.23，6.23 当日 00:00 进入下一周期），非自然月。</li>
          <li>每张卡片含：周期合计、分类占比、Top 模型、每日花费柱状图，便于财务核对。</li>
          <li>请先填写报销人信息并保存；导出 PNG 为白底截图，可直接附在报销单后。</li>
          <li>可下载原始用量 CSV，在官网字段基础上追加「Estimated USD」等估算费用列。</li>
        </ul>
      </div>

      {/* 报销人 + 控制 */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/40 px-4 py-4 space-y-4">
        <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400">
          报销人信息
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            姓名 *
            <input
              value={profile.employeeName}
              onChange={(e) =>
                setProfile((p) => ({ ...p, employeeName: e.target.value }))
              }
              placeholder="张三"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            邮箱
            <input
              value={profile.employeeEmail}
              onChange={(e) =>
                setProfile((p) => ({ ...p, employeeEmail: e.target.value }))
              }
              placeholder="zhang@company.com"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            用途说明
            <input
              value={profile.purpose}
              onChange={(e) =>
                setProfile((p) => ({ ...p, purpose: e.target.value }))
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200/80 dark:border-slate-700/80">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            账单刷新日
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
              className="w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
            />
            日
          </label>

          <button
            type="button"
            onClick={() =>
              setBillingCycleDay(periodData?.defaultBillingCycleDay ?? 23)
            }
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            恢复默认 ({periodData?.defaultBillingCycleDay ?? 23})
          </button>

          <button
            type="button"
            onClick={saveProfile}
            disabled={savingProfile}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {savingProfile ? '保存中…' : '保存报销人信息'}
          </button>

          <a
            href={buildUsageCsvExportUrl(billingCycleDay)}
            download
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
          >
            下载全部原始 CSV（含费用）
          </a>

          <button
            type="button"
            onClick={exportAll}
            disabled={exporting || periods.length === 0 || !profile.employeeName.trim()}
            className="ml-auto px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!profile.employeeName.trim() ? '请先填写姓名' : undefined}
          >
            {exporting
              ? `批量导出中… ${exportProgress ?? ''}`
              : `批量导出全部 PNG（${periods.length} 张）`}
          </button>
        </div>
      </section>

      {/* 周期概览表 */}
      {periods.length > 0 && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/80 text-left text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3 font-medium">账单周期</th>
                  <th className="px-4 py-3 font-medium text-right">合计</th>
                  <th className="px-4 py-3 font-medium text-right">请求</th>
                  <th className="px-4 py-3 font-medium">Top 模型</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {periods.map((p) => (
                  <tr
                    key={p.key}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-700 dark:text-slate-200">
                        {p.label}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {fmtUsd(p.totalCost)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {p.totalRows.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.topModels.slice(0, 3).map((m) => (
                          <span
                            key={m.model}
                            className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px]"
                          >
                            {m.model}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <a
                        href={buildUsageCsvExportUrl(billingCycleDay, p.key)}
                        download
                        className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
                      >
                        CSV
                      </a>
                      <button
                        type="button"
                        onClick={() => exportOne(p.key)}
                        className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
                      >
                        PNG
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 分月卡片（预览 + 导出源） */}
      <section className="space-y-8">
        <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400">
          分月报销单预览（共 {periods.length} 个账单周期）
        </h3>
        {!daily ? (
          <p className="text-sm text-slate-400">每日数据加载中，图表将在就绪后显示…</p>
        ) : (
          periods.map((period) => (
            <div key={period.key} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-slate-500 font-mono">{period.key}</p>
                <button
                  type="button"
                  onClick={() => exportOne(period.key)}
                  className="text-xs text-violet-600 dark:text-violet-400 hover:underline"
                >
                  仅导出本周期
                </button>
              </div>
              <ReimbursementMonthCard
                period={period}
                dailyInPeriod={dailyByPeriod.get(period.key) ?? []}
                profile={profile}
                generatedAt={generatedAt}
                disclaimer={disclaimer}
              />
            </div>
          ))
        )}
      </section>
    </div>
  )
}
