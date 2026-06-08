/**
 * Cursor 用量面板 — 主视图
 * 阶段四：明暗主题切换 + 标签页（概览 / 模型详情）+ 分模型数据
 */
import { useEffect, useState, useMemo } from 'react'
import axios from 'axios'
import { KPICards } from './components/KPICards'
import { UsageTrendChart } from './components/UsageTrendChart'
import { TokenDistChart } from './components/TokenDistChart'
import { ModelUsageChart } from './components/ModelUsageChart'
import { ModelDetailedChart } from './components/ModelDetailedChart'
import { ModelLeaderboard } from './components/ModelLeaderboard'
import { PeriodStatsView } from './components/PeriodStatsView'
import { ReimbursementView } from './components/ReimbursementView'
import { ThemeContext } from './context/ThemeContext'
import { DataSyncBar } from './components/DataSyncBar'

// ────────── 类型定义 ──────────

interface PoolValues {
  Auto: number
  Composer: number
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

type Tab = 'overview' | 'model-details' | 'period-stats' | 'reimbursement'

// ────────── 主应用组件 ──────────

function App() {
  // ── 主题 (dark = 默认) ──
  const [isDark, setIsDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('cursor-dashboard-theme')
    return saved ? saved === 'dark' : true
  })

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    localStorage.setItem('cursor-dashboard-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  // ── 标签页 ──
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // ── 每日数据 ──
  const [daily, setDaily] = useState<DailyEntry[] | null>(null)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')

  // ── 刷新数据（由 DataSyncBar 触发 bumpRefresh）──
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => {
    setDailyError(null)
    setRefreshKey((k) => k + 1)
  }

  useEffect(() => {
    axios
      .get<DailyResponse>('/api/daily')
      .then((r) => {
        if (r.data.ok && r.data.daily) setDaily(r.data.daily)
        else setDailyError(r.data.error ?? '接口返回异常')
      })
      .catch((e) => setDailyError(e instanceof Error ? e.message : String(e)))
  }, [refreshKey])

  const filteredDaily = useMemo<DailyEntry[] | null>(() => {
    if (!daily) return null
    if (!startDate && !endDate) return daily
    return daily.filter((d) => {
      if (startDate && d.date < startDate) return false
      if (endDate && d.date > endDate) return false
      return true
    })
  }, [daily, startDate, endDate])

  const dateRange = useMemo(() => {
    if (!daily || daily.length === 0) return null
    return { min: daily[0].date, max: daily[daily.length - 1].date }
  }, [daily])

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: '概览 Overview' },
    { id: 'period-stats', label: '周期统计 Period Stats' },
    { id: 'reimbursement', label: '报销导出 Reimburse' },
    { id: 'model-details', label: '模型详情 Model Details' },
  ]

  return (
    <ThemeContext.Provider value={isDark}>
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-200 transition-colors duration-200">

        {/* 顶部导航栏 */}
        <header className="sticky top-0 z-10 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/90 backdrop-blur-sm px-6 py-3 md:px-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-block h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_#10b98155]" />
              <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white md:text-lg">
                Cursor 用量面板
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 dark:text-slate-600 font-mono hidden sm:block">
                YTD 2026
              </span>
              
              <DataSyncBar onReload={bumpRefresh} />
              {/* 明/暗主题切换按钮 */}
              <button
                onClick={() => setIsDark(!isDark)}
                className="flex items-center justify-center w-8 h-8 rounded-lg
                  border border-slate-200 dark:border-slate-700
                  bg-slate-100 dark:bg-slate-800
                  text-slate-600 dark:text-slate-400
                  hover:bg-slate-200 dark:hover:bg-slate-700
                  transition-all duration-200"
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
        </header>

        {/* 主内容区 */}
        <main className="mx-auto max-w-screen-2xl px-4 py-6 md:px-8 md:py-8 space-y-6">

          {/* Tab 导航 */}
          <nav className="flex gap-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* ── 概览 Tab ── */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <section>
                <KPICards refreshKey={refreshKey} />
              </section>

              {/* 日期范围筛选器 */}
              <section className="flex items-center flex-wrap gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/40 dark:bg-slate-900/40 px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500 shrink-0">
                  日期筛选
                </span>
                <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  开始
                  <input
                    type="date"
                    value={startDate}
                    min={dateRange?.min}
                    max={dateRange?.max}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200
                               focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
                  />
                </label>
                <span className="text-slate-300 dark:text-slate-700 text-xs">—</span>
                <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  结束
                  <input
                    type="date"
                    value={endDate}
                    min={dateRange?.min}
                    max={dateRange?.max}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200
                               focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
                  />
                </label>
                {(startDate || endDate) && (
                  <button
                    onClick={() => { setStartDate(''); setEndDate('') }}
                    className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline underline-offset-2 ml-1 transition-colors"
                  >
                    重置
                  </button>
                )}
                <span className="ml-auto text-xs text-slate-400 dark:text-slate-600 font-mono">
                  {filteredDaily != null
                    ? `${filteredDaily.length} 天`
                    : daily
                    ? `${daily.length} 天`
                    : '加载中…'}
                </span>
              </section>

              {/* 趋势图表区域 */}
              {dailyError ? (
                <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-600 dark:text-red-400">
                  加载每日数据失败：{dailyError}（请确认已启动 dashboard/server）
                </div>
              ) : (
                <section className="space-y-6">
                  <h2 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
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
              <h2 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
                分月报销记录（按账单刷新日）
              </h2>
              <ReimbursementView refreshKey={refreshKey} daily={daily} />
            </div>
          )}

          {/* ── 周期统计 Tab ── */}
          {activeTab === 'period-stats' && (
            <div className="space-y-6">
              <h2 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
                月度 / 账单周期统计
              </h2>
              <PeriodStatsView refreshKey={refreshKey} />
            </div>
          )}

          {/* ── 模型详情 Tab ── */}
          {activeTab === 'model-details' && (
            <div className="space-y-6">
              <h2 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
                模型详情分析
              </h2>
              {dailyError ? (
                <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-600 dark:text-red-400">
                  加载每日数据失败：{dailyError}（请确认已启动 dashboard/server）
                </div>
              ) : (
                <ModelDetailedChart daily={filteredDaily} />
              )}
              <ModelLeaderboard refreshKey={refreshKey} />
            </div>
          )}

          {/* 页脚 */}
          <footer className="border-t border-slate-200 dark:border-slate-800/60 pt-6 pb-2">
            <p className="text-center text-[11px] text-slate-400 dark:text-slate-700">
              数据仅供参考 · estimatedUsd 按公开文档单价计算，不等同于实际账单
            </p>
          </footer>
        </main>
      </div>
    </ThemeContext.Provider>
  )
}

export default App
