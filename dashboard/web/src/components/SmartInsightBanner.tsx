/**
 * Nordic 极简风格 — 智能用量洞察高亮 Banner (SmartInsightBanner.tsx)
 * 实时计算 Prompt Cache 节省效益、热门模型与数据跨度概要
 */
import { useMemo } from 'react'
import type { DailyEntry } from '../App'

interface SmartInsightBannerProps {
  daily: DailyEntry[] | null
}

export function SmartInsightBanner({ daily }: SmartInsightBannerProps) {
  const insights = useMemo(() => {
    if (!daily || daily.length === 0) return null

    let totalCost = 0
    let totalTokens = 0
    let totalCacheRead = 0
    let totalInputNoCache = 0
    let totalOutput = 0
    const modelCostMap: Record<string, number> = {}

    daily.forEach((d) => {
      totalCost += d.cost || 0
      totalTokens += d.totalTokens || 0
      totalCacheRead += d.cacheRead || 0
      totalInputNoCache += d.inputNoCache || 0
      totalOutput += d.outputTokens || 0

      if (d.costByModel) {
        Object.entries(d.costByModel).forEach(([model, c]) => {
          modelCostMap[model] = (modelCostMap[model] || 0) + c
        })
      }
    })

    // 估算 Prompt Cache 节省：按 Cache Read 相比标准 Input 折扣估算
    const cacheSavingsUsd = (totalCacheRead / 1_000_000) * 1.5
    const totalInputTotal = totalCacheRead + totalInputNoCache
    const cacheHitRate = totalInputTotal > 0 ? (totalCacheRead / totalInputTotal) * 100 : 0

    // 计算最高频模型
    let topModel = ''
    let topModelCost = 0
    Object.entries(modelCostMap).forEach(([m, c]) => {
      if (c > topModelCost) {
        topModelCost = c
        topModel = m
      }
    })

    const topModelShare = totalCost > 0 ? (topModelCost / totalCost) * 100 : 0

    return {
      daysCount: daily.length,
      totalCost,
      cacheSavingsUsd,
      cacheHitRate,
      topModel: topModel || 'Claude 3.5 Sonnet',
      topModelShare,
    }
  }, [daily])

  if (!insights) return null

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 md:px-6 md:py-4 bg-surface border border-line rounded-xl shadow-sm transition-all">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/40">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-fg tracking-tight">智能用量洞察</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100/80 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-mono">
              Cache Read 命中率 {insights.cacheHitRate.toFixed(1)}%
            </span>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            近 <strong className="font-semibold text-fg font-mono">{insights.daysCount}</strong> 天内，Prompt Caching 已为您估算节省约{' '}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
              ${insights.cacheSavingsUsd.toFixed(2)}
            </span>
            ；用量最高的模型为{' '}
            <span className="font-semibold text-fg font-mono">{insights.topModel}</span> (占比 {insights.topModelShare.toFixed(0)}%)。
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 text-[11px] font-medium text-fg-faint border-t md:border-t-0 md:border-l border-line pt-2 md:pt-0 md:pl-4">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span>数据状态: <strong className="text-fg font-semibold">已更新</strong></span>
      </div>
    </div>
  )
}
