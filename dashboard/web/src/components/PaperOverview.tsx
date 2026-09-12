import { useMemo } from 'react'
import type { DailyLike } from '../lib/paperThesis'
import { UsageTrendChart } from './UsageTrendChart'
import { TokenDistChart } from './TokenDistChart'
import { ModelUsageChart } from './ModelUsageChart'
import { ModelLeaderboard } from './ModelLeaderboard'
import { UsageRhythmSection } from './UsageRhythmSection'
import { PaperFigure } from './PaperFigure'
import {
  buildHeroThesis,
  factLine,
  fmtUsdFull,
  mastheadClaims,
  modelThesis,
  poolThesis,
  rangePhrase,
  summarizeRange,
} from '../lib/paperThesis'

interface PaperOverviewProps {
  daily: DailyLike[] | null
  filteredDaily: DailyLike[] | null
  dailyError: string | null
  dateRange: { min: string; max: string } | null
  startDate: string
  endDate: string
  setStartDate: (v: string) => void
  setEndDate: (v: string) => void
  activePreset: '7' | '30' | '90' | 'all' | null
  applyLastDays: (days: number) => void
  clearDateFilter: () => void
  refreshKey: number
  mergeSourceIds: string[]
  profilesQuery?: string
  profilesKey?: string
  selectedSummary: string | null
  selectedCount: number
  mergeEnabled: boolean
  addonCount: number
}

export function PaperOverview({
  daily,
  filteredDaily,
  dailyError,
  dateRange,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  activePreset,
  applyLastDays,
  clearDateFilter,
  refreshKey,
  mergeSourceIds,
  profilesQuery,
  profilesKey,
  selectedSummary,
  selectedCount,
  mergeEnabled,
  addonCount,
}: PaperOverviewProps) {
  const stats = useMemo(
    () => (filteredDaily && filteredDaily.length ? summarizeRange(filteredDaily) : null),
    [filteredDaily],
  )
  const phrase = rangePhrase(activePreset, startDate, endDate)

  return (
    <div className="paper-overview">
      <section className="paper-masthead">
        <div className="paper-masthead-copy">
          <h2 className="paper-thesis">
            {stats ? buildHeroThesis(phrase, stats) : `${phrase}的用量`}
          </h2>
          <p className="paper-kicker">
            公开文档单价 × usage.csv 按日聚合。等效美元不是 Cursor 发票。
          </p>
          {selectedCount > 1 && selectedSummary && (
            <p className="paper-lede">多身份合计：{selectedSummary}</p>
          )}
          {mergeEnabled && addonCount > 0 && (
            <p className="paper-lede">已并入本地附加源（报销页仍只用主账号）。</p>
          )}
          {stats ? (
            <>
              <p className="paper-facts">{factLine(stats)}</p>
              <p className="paper-lede">{mastheadClaims(stats)}</p>
            </>
          ) : (
            <p className="paper-lede">正在读每日序列。</p>
          )}
        </div>
        <div className="paper-masthead-num">
          {stats && <p className="paper-hero-value">{fmtUsdFull(stats.cost)}</p>}
          <DateStrip
            dateRange={dateRange}
            startDate={startDate}
            endDate={endDate}
            setStartDate={setStartDate}
            setEndDate={setEndDate}
            activePreset={activePreset}
            applyLastDays={applyLastDays}
            clearDateFilter={clearDateFilter}
          />
        </div>
      </section>

      {dailyError ? (
        <div className="panel border-danger-border bg-danger-soft p-4 text-danger">
          加载每日数据失败：{dailyError}（请确认已启动 dashboard/server）
        </div>
      ) : (
        <div className="paper-grid">
          <UsageRhythmSection
            refreshKey={refreshKey}
            startDate={startDate}
            endDate={endDate}
            daily={daily}
            foldPluginIds={mergeSourceIds}
            profilesQuery={profilesQuery}
            profilesKey={profilesKey}
          />

          <PaperFigure
            thesis="花费按天起伏，不是匀速"
            kicker="每日公开单价等效 USD"
            lede="纵轴是当天全部请求按公开费率加总。滑块与邻图共用时间窗。"
          >
            <UsageTrendChart daily={filteredDaily} />
          </PaperFigure>

          <PaperFigure
            thesis="Token 从哪来"
            kicker="Cache Read / Write / 普通输入 / 输出"
            lede="堆叠柱是四类 token 日合计，不是用户手动发送次数。"
          >
            <TokenDistChart daily={filteredDaily} />
          </PaperFigure>

          <PaperFigure
            thesis={stats ? poolThesis(stats) : '费用落在哪个池'}
            kicker="Auto / First-party / API"
            lede="池由 billingPool 与模型费率表划分。API 池不等于 Kind=User API Key。"
          >
            <ModelUsageChart daily={filteredDaily} />
          </PaperFigure>

          <PaperFigure
            thesis={stats ? modelThesis(stats) : '哪个模型最贵'}
            kicker="按模型汇总 equivalent USD"
            lede="排行来自 estimate 的 byModel。"
            className="paper-figure-scroll"
          >
            <ModelLeaderboard
              refreshKey={refreshKey}
              foldPluginIds={mergeSourceIds}
              profilesQuery={profilesQuery}
              profilesKey={profilesKey}
            />
          </PaperFigure>
        </div>
      )}
    </div>
  )
}

function DateStrip({
  dateRange,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  activePreset,
  applyLastDays,
  clearDateFilter,
}: {
  dateRange: { min: string; max: string } | null
  startDate: string
  endDate: string
  setStartDate: (v: string) => void
  setEndDate: (v: string) => void
  activePreset: '7' | '30' | '90' | 'all' | null
  applyLastDays: (days: number) => void
  clearDateFilter: () => void
}) {
  return (
    <div className="paper-date-strip">
      <div className="inline-flex gap-1">
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
      <div className="flex flex-wrap items-center gap-2 text-fg-muted">
        <input
          type="date"
          value={startDate}
          min={dateRange?.min}
          max={dateRange?.max}
          onChange={(e) => setStartDate(e.target.value)}
          className="bg-transparent focus:outline-none cursor-pointer"
        />
        <span>至</span>
        <input
          type="date"
          value={endDate}
          min={dateRange?.min}
          max={dateRange?.max}
          onChange={(e) => setEndDate(e.target.value)}
          className="bg-transparent focus:outline-none cursor-pointer"
        />
        {(startDate || endDate) && (
          <button type="button" onClick={clearDateFilter} className="text-fg-muted">
            清除
          </button>
        )}
      </div>
    </div>
  )
}
