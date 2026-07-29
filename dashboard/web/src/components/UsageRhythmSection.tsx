/**
 * Overview「使用节奏」：热力 + 点日曲线；拉取 /api/hourly
 * 大块内容可折叠
 */
import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { CollapsibleSection } from './CollapsibleSection'
import { HourlyDayChart } from './HourlyDayChart'
import { HourlyHeatmapChart, type HourlyDay } from './HourlyHeatmapChart'
import { UsageDistributionCompare } from './UsageDistributionCompare'

interface HourlyResponse {
  ok: boolean
  timezone?: string
  today?: string
  days?: HourlyDay[]
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
}

export function UsageRhythmSection({
  refreshKey,
  startDate = '',
  endDate = '',
  daily,
}: UsageRhythmSectionProps) {
  const [days, setDays] = useState<HourlyDay[] | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDays(null)
    setError(null)
    const params: Record<string, string | number> = { days: 90 }
    if (startDate) params.start = startDate
    if (endDate) params.end = endDate

    axios
      .get<HourlyResponse>('/api/hourly', { params })
      .then((r) => {
        if (cancelled) return
        if (!r.data.ok || !r.data.days) {
          setError(r.data.error ?? '小时数据加载失败')
          setDays([])
          return
        }
        setDays(r.data.days)
        setToday(r.data.today ?? null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setDays([])
      })

    return () => {
      cancelled = true
    }
  }, [refreshKey, startDate, endDate])

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
        hint={days ? `${days.length} 天` : '加载中'}
      >
        {error ? (
          <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger">
            加载小时数据失败：{error}
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            <HourlyHeatmapChart
              days={days}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              today={today}
            />
            <HourlyDayChart day={selectedDay} loading={days == null} />
          </div>
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
