/**
 * Cursor 用量面板 — 主视图
 * 阶段四：明暗主题切换 + 标签页（概览 / 模型详情）+ 分模型数据
 */
import { useEffect, useState, useMemo, useRef, useLayoutEffect, useCallback } from 'react'
import axios from 'axios'
import { KPICards } from './components/KPICards'
import { UsageTrendChart } from './components/UsageTrendChart'
import { TokenDistChart } from './components/TokenDistChart'
import { ModelUsageChart } from './components/ModelUsageChart'
import { ModelDetailedChart } from './components/ModelDetailedChart'
import { ModelLeaderboard } from './components/ModelLeaderboard'
import { PeriodStatsView } from './components/PeriodStatsView'
import { ReimbursementView } from './components/ReimbursementView'
import { GenericSourceView } from './components/GenericSourceView'
import {
  MergeAddonToggle,
  readMergeEnabled,
  writeMergeEnabled,
  type AddonSourceInfo,
} from './components/MergeAddonToggle'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import { ThemePalettePicker } from './components/ThemePalettePicker'
import { DataSyncBar } from './components/DataSyncBar'
import { UsageRhythmSection } from './components/UsageRhythmSection'
import { mergeDailyEntries, type DailyEntry as MergeDailyEntry } from './lib/mergeDaily'
import type { SyncPulse } from './lib/syncPulse'

// ────────── 类型定义 ──────────

interface PoolValues {
  Auto: number
  FirstParty: number
  API: number
}

export interface DailyEntry {
  date: string
  totalTokens: number
  cacheRead: number
  inputCacheWrite: number
  inputNoCache: number
  outputTokens: number
  cost: number
  costByPool: PoolValues
  tokensByPool: PoolValues
  costByModel: Record<string, number>
  tokensByModel: Record<string, number>
  rows: number
}

interface DailyResponse {
  ok: boolean
  daily?: DailyEntry[]
  ms?: number
  error?: string
}

type CoreTab = 'overview' | 'model-details' | 'period-stats' | 'reimbursement'
type Tab = CoreTab | `plugin:${string}`

interface PluginTabInfo {
  id: string
  label: string
  order: number
}

interface HealthResponse {
  ok?: boolean
  plugins?: Array<
    AddonSourceInfo & {
      tabs?: PluginTabInfo[]
    }
  >
}

interface PluginCursorDailyResponse {
  ok: boolean
  data?: MergeDailyEntry[]
  error?: string
}

// ────────── 主应用组件 ──────────

function AppShell() {
  const { isDark, toggleMode } = useTheme()

  // ── 标签页 ──
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [pluginTabs, setPluginTabs] = useState<PluginTabInfo[]>([])
  const [addonSources, setAddonSources] = useState<AddonSourceInfo[]>([])
  const [mergeEnabled, setMergeEnabled] = useState<boolean>(() => readMergeEnabled())

  // ── 每日数据（daily 始终为纯 Cursor，供报销使用）──
  const [daily, setDaily] = useState<DailyEntry[] | null>(null)
  const [pluginDailyExtra, setPluginDailyExtra] = useState<DailyEntry[] | null>(null)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const didInitRange = useRef(false)

  // ── 刷新数据（由 DataSyncBar 触发 bumpRefresh）──
  const [refreshKey, setRefreshKey] = useState(0)
  const [syncPulse, setSyncPulse] = useState<SyncPulse | null>(null)
  const bumpRefresh = () => {
    setDailyError(null)
    setRefreshKey((k) => k + 1)
  }

  const setMerge = (on: boolean) => {
    writeMergeEnabled(on)
    setMergeEnabled(on)
  }

  useEffect(() => {
    axios
      .get<HealthResponse>('/api/health')
      .then((r) => {
        const tabsFromPlugins: PluginTabInfo[] = []
        const mergeable: AddonSourceInfo[] = []
        for (const p of r.data.plugins ?? []) {
          const contrib = p.tabs?.length
            ? p.tabs
            : [{ id: p.id, label: p.name || p.id, order: 100 }]
          for (const t of contrib) {
            tabsFromPlugins.push({
              id: t.id || p.id,
              label: t.label || p.name || p.id,
              order: Number(t.order ?? 100),
            })
          }
          if (p.mergeIntoOverview?.enabled) {
            mergeable.push({
              id: p.id,
              name: p.name,
              mergeIntoOverview: p.mergeIntoOverview,
            })
          }
        }
        tabsFromPlugins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        setPluginTabs(tabsFromPlugins)
        setAddonSources(mergeable)
      })
      .catch(() => {
        setPluginTabs([])
        setAddonSources([])
      })
  }, [refreshKey])

  useEffect(() => {
    axios
      .get<DailyResponse>('/api/daily')
      .then((r) => {
        if (r.data.ok && r.data.daily) setDaily(r.data.daily)
        else setDailyError(r.data.error ?? '接口返回异常')
      })
      .catch((e) => setDailyError(e instanceof Error ? e.message : String(e)))
  }, [refreshKey])

  useEffect(() => {
    if (!mergeEnabled || addonSources.length === 0) {
      setPluginDailyExtra(null)
      return
    }
    let cancelled = false
    Promise.all(
      addonSources.map((p) =>
        axios
          .get<PluginCursorDailyResponse>(`/api/plugins/${p.id}/cursor-daily`)
          .then((r) => (r.data.ok && Array.isArray(r.data.data) ? r.data.data : []))
          .catch(() => [] as MergeDailyEntry[]),
      ),
    ).then((chunks) => {
      if (cancelled) return
      const merged = chunks.reduce<MergeDailyEntry[] | null>(
        (acc, cur) => mergeDailyEntries(acc, cur),
        null,
      )
      setPluginDailyExtra(merged)
    })
    return () => {
      cancelled = true
    }
  }, [mergeEnabled, addonSources, refreshKey])

  /** 概览 / 模型详情用：可选叠加本地附加源 */
  const displayDaily = useMemo(
    () =>
      mergeEnabled
        ? mergeDailyEntries(daily, pluginDailyExtra)
        : daily,
    [daily, pluginDailyExtra, mergeEnabled],
  )

  const filteredDaily = useMemo<DailyEntry[] | null>(() => {
    if (!displayDaily) return null
    if (!startDate && !endDate) return displayDaily
    return displayDaily.filter((d) => {
      if (startDate && d.date < startDate) return false
      if (endDate && d.date > endDate) return false
      return true
    })
  }, [displayDaily, startDate, endDate])

  const dateRange = useMemo(() => {
    const src = displayDaily ?? daily
    if (!src || src.length === 0) return null
    return { min: src[0].date, max: src[src.length - 1].date }
  }, [displayDaily, daily])

  const shiftIsoDate = useCallback((iso: string, deltaDays: number) => {
    const d = new Date(`${iso}T00:00:00`)
    d.setDate(d.getDate() + deltaDays)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }, [])

  const applyLastDays = useCallback(
    (days: number) => {
      if (!dateRange) return
      const start = shiftIsoDate(dateRange.max, -(days - 1))
      setStartDate(start < dateRange.min ? dateRange.min : start)
      setEndDate(dateRange.max)
    },
    [dateRange, shiftIsoDate],
  )

  const clearDateFilter = useCallback(() => {
    setStartDate('')
    setEndDate('')
  }, [])

  // 数据跨度超过 90 天时，默认聚焦最近三个月
  useEffect(() => {
    if (didInitRange.current || !dateRange) return
    didInitRange.current = true
    const spanStart = new Date(`${dateRange.min}T00:00:00`)
    const spanEnd = new Date(`${dateRange.max}T00:00:00`)
    const spanDays =
      Math.round((spanEnd.getTime() - spanStart.getTime()) / 86_400_000) + 1
    if (spanDays > 90) applyLastDays(90)
  }, [dateRange, applyLastDays])

  const activePreset = useMemo(() => {
    if (!dateRange) return null as null | '7' | '30' | '90' | 'all'
    if (!startDate && !endDate) return 'all'
    if (endDate !== dateRange.max) return null
    const expected7 = shiftIsoDate(dateRange.max, -6)
    const expected30 = shiftIsoDate(dateRange.max, -29)
    const expected90 = shiftIsoDate(dateRange.max, -89)
    const clamp = (s: string) => (s < dateRange.min ? dateRange.min : s)
    if (startDate === clamp(expected7)) return '7'
    if (startDate === clamp(expected30)) return '30'
    if (startDate === clamp(expected90)) return '90'
    return null
  }, [dateRange, startDate, endDate, shiftIsoDate])

  const mergeSourceIds = mergeEnabled ? addonSources.map((p) => p.id) : []

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: '概览 Overview' },
    { id: 'period-stats', label: '周期统计 Period Stats' },
    { id: 'reimbursement', label: '报销导出 Reimburse' },
    { id: 'model-details', label: '模型详情 Model Details' },
    ...pluginTabs.map((t) => ({
      id: `plugin:${t.id}` as Tab,
      label: t.label,
    })),
  ]

  const tabRailRef = useRef<HTMLElement>(null)
  const tabBtnRefs = useRef<Map<Tab, HTMLButtonElement>>(new Map())
  const [tabIndicator, setTabIndicator] = useState({ left: 4, width: 0 })

  useLayoutEffect(() => {
    const rail = tabRailRef.current
    const btn = tabBtnRefs.current.get(activeTab)
    if (!rail || !btn) return
    const update = () => {
      setTabIndicator({
        left: btn.offsetLeft,
        width: btn.offsetWidth,
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(rail)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [activeTab, tabs.length])

  return (
    <div className="min-h-screen bg-canvas text-fg transition-colors duration-200">

      {/* 顶部导航栏 */}
      <header className="app-header sticky top-0 z-10 px-6 py-3 md:px-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
            <h1 className="text-base font-bold tracking-tight text-fg md:text-lg truncate">
              Cursor 用量面板
            </h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-xs text-fg-faint font-mono hidden md:block">
              YTD 2026
            </span>

            <MergeAddonToggle
              sources={addonSources}
              enabled={mergeEnabled}
              onChange={setMerge}
              compact
            />
            <DataSyncBar
              onReload={bumpRefresh}
              onSyncSuccess={setSyncPulse}
            />

            <div className="toolbar-cluster">
              <ThemePalettePicker />
              <button
                type="button"
                onClick={toggleMode}
                className="btn-icon !border-0 !bg-transparent hover:!bg-surface"
                title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
                aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
              >
                {isDark ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="mx-auto max-w-screen-2xl px-4 py-6 md:px-8 md:py-8 space-y-6">

        {/* Tab 导航 */}
        <nav ref={tabRailRef} className="tab-rail">
          <span
            className="tab-rail-indicator"
            style={{ left: tabIndicator.left, width: tabIndicator.width }}
            aria-hidden
          />
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              ref={(el) => {
                if (el) tabBtnRefs.current.set(tab.id, el)
                else tabBtnRefs.current.delete(tab.id)
              }}
              onClick={() => setActiveTab(tab.id)}
              className={`tab-rail-btn ${
                activeTab === tab.id
                  ? 'font-semibold text-fg'
                  : 'text-fg-muted hover:text-fg'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* ── 概览 Tab ── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {mergeEnabled && addonSources.length > 0 && (
              <p className="text-[11px] text-accent">
                已合并本地附加用量到概览（按公开单价估算）；报销 Tab 仍为主数据源。
              </p>
            )}
            <section>
              <KPICards
                refreshKey={refreshKey}
                foldPluginIds={mergeSourceIds}
                syncPulse={syncPulse}
              />
            </section>

            {/* 日期范围筛选器 */}
            <section className="flex items-center flex-wrap gap-3 panel bg-surface-2 px-3 py-2">
              <span className="section-label shrink-0">
                日期筛选
              </span>
              <div className="toolbar-cluster">
                {(
                  [
                    { id: '7' as const, label: '7 天', days: 7 },
                    { id: '30' as const, label: '30 天', days: 30 },
                    { id: '90' as const, label: '90 天', days: 90 },
                    { id: 'all' as const, label: '全部', days: null },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`range-preset ${activePreset === p.id ? 'is-active' : ''}`}
                    onClick={() =>
                      p.days == null ? clearDateFilter() : applyLastDays(p.days)
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                开始
                <input
                  type="date"
                  value={startDate}
                  min={dateRange?.min}
                  max={dateRange?.max}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-elevated border border-line rounded-lg px-2.5 py-1.5 text-xs font-semibold text-fg
                             focus:outline-none focus:border-accent transition-colors cursor-pointer"
                />
              </label>
              <span className="text-fg-faint text-xs">—</span>
              <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                结束
                <input
                  type="date"
                  value={endDate}
                  min={dateRange?.min}
                  max={dateRange?.max}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-elevated border border-line rounded-lg px-2.5 py-1.5 text-xs font-semibold text-fg
                             focus:outline-none focus:border-accent transition-colors cursor-pointer"
                />
              </label>
              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={clearDateFilter}
                  className="text-xs font-semibold text-fg-muted hover:text-fg underline underline-offset-2 ml-1 transition-colors"
                >
                  重置
                </button>
              )}
              <span className="ml-auto text-xs font-semibold text-fg-muted font-mono">
                {filteredDaily != null
                  ? `${filteredDaily.length} 天${mergeEnabled ? ' · 含附加源' : ''}`
                  : daily
                  ? `${daily.length} 天`
                  : '加载中…'}
              </span>
            </section>

            {/* 使用节奏：热力 + 分布对比 */}
            {!dailyError && (
              <UsageRhythmSection
                refreshKey={refreshKey}
                startDate={startDate}
                endDate={endDate}
                daily={displayDaily}
              />
            )}

            {/* 趋势图表区域 */}
            {dailyError ? (
              <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
                加载每日数据失败：{dailyError}（请确认已启动 dashboard/server）
              </div>
            ) : (
              <section className="space-y-6">
                <h2 className="section-title">
                  趋势分析
                </h2>
                <div className="grid gap-6 xl:grid-cols-2">
                  <UsageTrendChart daily={filteredDaily} />
                  <TokenDistChart daily={filteredDaily} />
                </div>
                <ModelUsageChart daily={filteredDaily} />
              </section>
            )}
          </div>
        )}

        {/* ── 报销导出 Tab ── */}
        {activeTab === 'reimbursement' && (
          <div className="space-y-6">
            <h2 className="section-title">
              分月报销记录（按账单刷新日）
            </h2>
            <ReimbursementView refreshKey={refreshKey} daily={daily} />
          </div>
        )}

        {/* ── 周期统计 Tab ── */}
        {activeTab === 'period-stats' && (
          <div className="space-y-6">
            <h2 className="section-title">
              月度 / 账单周期统计
            </h2>
            <PeriodStatsView refreshKey={refreshKey} />
          </div>
        )}

        {/* ── 模型详情 Tab ── */}
        {activeTab === 'model-details' && (
          <div className="space-y-6">
            <h2 className="section-title">
              模型详情分析
            </h2>
            {mergeEnabled && addonSources.length > 0 && (
              <p className="text-[11px] text-accent">
                已叠加本地附加源模型映射（报销不受影响）。
              </p>
            )}
            {dailyError ? (
              <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
                加载每日数据失败：{dailyError}（请确认已启动 dashboard/server）
              </div>
            ) : (
              <ModelDetailedChart daily={filteredDaily} />
            )}
            <ModelLeaderboard
              refreshKey={refreshKey}
              foldPluginIds={mergeSourceIds}
            />
          </div>
        )}

        {/* ── 本地附加源 Tab ── */}
        {activeTab.startsWith('plugin:') && (
          <GenericSourceView
            pluginId={activeTab.slice('plugin:'.length)}
            refreshKey={refreshKey}
            mergeEnabled={mergeEnabled}
            onMergeChange={setMerge}
            addonSources={addonSources}
          />
        )}

        {/* 页脚 */}
        <footer className="border-t border-line/60 pt-6 pb-2">
          <p className="text-center text-[11px] text-fg-faint">
            数据仅供参考 · estimatedUsd 按公开文档单价计算，不等同于实际账单
            {pluginTabs.length > 0
              ? ' · 附加数据源与主用量默认分列，合并需显式打开开关'
              : ''}
          </p>
        </footer>
      </main>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  )
}

export default App
