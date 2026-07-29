/**
 * Overview「使用节奏」：热力 + 点日曲线；拉取 /api/hourly
 * 「合并附加用量」打开时叠入插件 cursor-hourly
 */
import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { CollapsibleSection } from './CollapsibleSection'
import { HourlyDayChart } from './HourlyDayChart'
import { HourlyHeatmapChart, type HourlyDay } from './HourlyHeatmapChart'
import { UsageDistributionCompare } from './UsageDistributionCompare'
import {
  mergeHourlyDays,
  type HourlyDayEntry,
} from '../lib/mergeDaily'

interface HourlyResponse {
  ok: boolean
  timezone?: string
  today?: string
  days?: HourlyDay[]
  error?: string
}

interface PluginHourlyResponse {
  ok: boolean
  days?: HourlyDayEntry[]
  error?: string
}

interface DailyLite {
  date: string
  totalTokens: number
}

interface UsageRhythmSectionProps {
  refreshKey: number
  startDate?: string
  endDate?: string
  /** 日序列（可与概览筛选一致），供 7/30/90 分布 */
  daily: DailyLite[] | null
  /** 与 KPI/日趋势相同：合并开关打开时的插件 id */
  foldPluginIds?: string[]
}

function filterHourlyByRange(
  days: HourlyDayEntry[],
  startDate: string,
  endDate: string,
): HourlyDayEntry[] {
  if (!startDate && !endDate) return days
  return days.filter((d) => {
    if (startDate && d.date < startDate) return false
    if (endDate && d.date > endDate) return false
    return true
  })
}

export function UsageRhythmSection({
  refreshKey,
  startDate = '',
  endDate = '',
  daily,
  foldPluginIds = [],
}: UsageRhythmSectionProps) {
  const [days, setDays] = useState<HourlyDay[] | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [mergedAddon, setMergedAddon] = useState(false)

  const foldKey = foldPluginIds.join('|')

  useEffect(() => {
    let cancelled = false
    setDays(null)
    setError(null)
    setMergedAddon(false)

    const params: Record<string, string | number> = { days: 180 }
    // 主 API 先拉宽窗，再与附加源合并后按筛选裁切（避免插件日被 start/end 截掉）

    const load = async () => {
      const main = await axios.get<HourlyResponse>('/api/hourly', { params })
      if (!main.data.ok || !main.data.days) {
        throw new Error(main.data.error ?? '小时数据加载失败')
      }

      let merged: HourlyDayEntry[] = main.data.days.map((d) => ({
        ...d,
        hours: [...(d.hours || [])],
      }))
      let didMerge = false

      if (foldPluginIds.length > 0) {
        const extras = await Promise.all(
          foldPluginIds.map((id) =>
            axios
              .get<PluginHourlyResponse>(`/api/plugins/${id}/cursor-hourly`)
              .then((r) => (r.data.ok ? r.data.days || [] : []))
              .catch(() => [] as HourlyDayEntry[]),
          ),
        )
        for (const extra of extras) {
          if (!extra.length) continue
          merged = mergeHourlyDays(merged, extra) || merged
          didMerge = true
        }
      }

      merged = filterHourlyByRange(merged, startDate, endDate)
      // 热力最多约 90 行
      if (merged.length > 90) merged = merged.slice(-90)

      if (cancelled) return
      setDays(merged)
      setToday(main.data.today ?? null)
      setMergedAddon(didMerge)
    }

    load().catch((e) => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : String(e))
      setDays([])
    })

    return () => {
      cancelled = true
    }
  }, [refreshKey, startDate, endDate, foldKey])

  // 默认选今天或最近有数据日
  useEffect(() => {
    if (!days?.length) {
      setSelectedDate(null)
      return
    }
    setSelectedDate((prev) => {
      if (prev && days.some((d) => d.date === prev)) return prev
      if (today && days.some((d) => d.date === today)) return today
      return days[days.length - 1].date
    })
  }, [days, today])

  const selectedDay = useMemo(() => {
    if (!days || !selectedDate) return null
    return days.find((d) => d.date === selectedDate) ?? null
  }, [days, selectedDate])

  return (
    <div className="space-y-6">
      <CollapsibleSection
        title="使用节奏 · 日内用量"
        storageKey="overview-collapse-hourly"
        defaultOpen
        hint={
          days
            ? `${days.length} 天${mergedAddon ? ' · 含附加' : ''}`
            : '加载中'
        }
      >
        {error ? (
          <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
            加载小时数据失败：{error}
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
            <HourlyHeatmapChart
              days={days}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              today={today}
            />
            <HourlyDayChart day={selectedDay} loading={days == null} />
          </div>
        )}
        {mergedAddon && (
          <p className="text-[11px] text-accent">
            热力已合并附加代理用量（随「合并附加用量」开关；关闭后仅主 Cursor）。
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="历史分布对比"
        storageKey="overview-collapse-dist"
        defaultOpen
        hint="7 / 30 / 90 天"
      >
        <UsageDistributionCompare
          daily={daily}
          hourlyDays={days}
          today={today}
        />
      </CollapsibleSection>
    </div>
  )
}
