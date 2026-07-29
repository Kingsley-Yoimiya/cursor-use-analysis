/**
 * 近 7 / 30 / 90 天日用量分布对比 + 汇总卡 + 次要小时画像
 */
import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useChartColors } from '../context/ThemeContext'
import {
  ChartLegendRow,
  ChartPanel,
  ChartTooltipShell,
  chartGridProps,
  chartTickStyle,
} from '../lib/chartChrome'
import { fmtTokens } from '../lib/formatTokens'
import type { HourlyDay } from './HourlyHeatmapChart'

interface DailyLite {
  date: string
  totalTokens: number
}

interface UsageDistributionCompareProps {
  daily: DailyLite[] | null
  hourlyDays?: HourlyDay[] | null
  today?: string | null
}

type WindowId = 7 | 30 | 90

const WINDOWS: { id: WindowId; label: string; colorKey: 'chart1' | 'chart2' | 'chart4' }[] =
  [
    { id: 7, label: '近 7 天', colorKey: 'chart1' },
    { id: 30, label: '近 30 天', colorKey: 'chart2' },
    { id: 90, label: '近 90 天', colorKey: 'chart4' },
  ]

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

/** 高斯 KDE → 采样点 */
function kdeCurve(
  values: number[],
  points = 72,
): { x: number; density: number }[] {
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || Math.max(max, 1)
  const sigma = stddev(values)
  const bandwidth =
    sigma > 0
      ? 1.06 * sigma * values.length ** -0.2
      : range / 8
  const pad = bandwidth * 2
  const lo = Math.max(0, min - pad)
  const hi = max + pad
  const span = hi - lo || 1
  const out: { x: number; density: number }[] = []
  const norm = values.length * bandwidth * Math.sqrt(2 * Math.PI)
  for (let i = 0; i < points; i++) {
    const x = lo + (span * i) / (points - 1)
    let y = 0
    for (const v of values) {
      const z = (x - v) / bandwidth
      y += Math.exp(-0.5 * z * z)
    }
    out.push({ x, density: y / norm })
  }
  return out
}

function windowStats(
  complete: DailyLite[],
  todayEntry: DailyLite | null,
  n: WindowId,
) {
  const slice = complete.slice(-n)
  const sum = slice.reduce((s, d) => s + d.totalTokens, 0)
  const avg = slice.length ? sum / slice.length : 0
  return {
    days: slice,
    values: slice.map((d) => d.totalTokens),
    sum,
    avg,
    dayCount: slice.length,
    todayTokens: todayEntry?.totalTokens ?? 0,
  }
}

function fmtAxisTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(Math.round(n))
}

export function UsageDistributionCompare({
  daily,
  hourlyDays = null,
  today = null,
}: UsageDistributionCompareProps) {
  const colors = useChartColors()
  const tick = chartTickStyle(colors.tick)

  const { complete, todayEntry, todayKey } = useMemo(() => {
    if (!daily?.length) {
      return { complete: [] as DailyLite[], todayEntry: null as DailyLite | null, todayKey: today }
    }
    const key =
      today ||
      // 兜底：用序列最大日当作「今天」参考
      daily[daily.length - 1]?.date ||
      null
    const todayRow = key ? daily.find((d) => d.date === key) ?? null : null
    const done = key ? daily.filter((d) => d.date < key) : daily
    return { complete: done, todayEntry: todayRow, todayKey: key }
  }, [daily, today])

  const stats = useMemo(() => {
    const map = {} as Record<WindowId, ReturnType<typeof windowStats>>
    for (const w of WINDOWS) {
      map[w.id] = windowStats(complete, todayEntry, w.id)
    }
    return map
  }, [complete, todayEntry])

  const densData = useMemo(() => {
    const curves = WINDOWS.map((w) => ({
      id: w.id,
      key: `d${w.id}` as const,
      curve: kdeCurve(stats[w.id].values),
    }))
    const allX = new Set<number>()
    for (const c of curves) for (const p of c.curve) allX.add(p.x)
    const xs = [...allX].sort((a, b) => a - b)
    if (xs.length === 0) return []

    const lookups = curves.map((c) => {
      const m = new Map(c.curve.map((p) => [p.x, p.density]))
      // 若采样点不完全对齐，按最近邻
      const sorted = c.curve
      return (x: number) => {
        if (m.has(x)) return m.get(x)!
        if (!sorted.length) return 0
        let best = sorted[0]
        let bestDist = Math.abs(sorted[0].x - x)
        for (const p of sorted) {
          const dist = Math.abs(p.x - x)
          if (dist < bestDist) {
            best = p
            bestDist = dist
          }
        }
        return best.density
      }
    })

    // 归一化到各自峰值，便于同屏对比「形状」
    const peaks = lookups.map((fn) => Math.max(1e-12, ...xs.map(fn)))

    return xs.map((x) => ({
      x,
      label: fmtAxisTokens(x),
      d7: lookups[0](x) / peaks[0],
      d30: lookups[1](x) / peaks[1],
      d90: lookups[2](x) / peaks[2],
    }))
  }, [stats])

  const hourProfile = useMemo(() => {
    if (!hourlyDays?.length || !todayKey) return null
    const completeHourly = hourlyDays.filter((d) => d.date < todayKey)
    const result: {
      hour: string
      h7: number
      h30: number
      h90: number
    }[] = []

    const avgHours = (n: number) => {
      const slice = completeHourly.slice(-n)
      const acc = Array.from({ length: 24 }, () => 0)
      if (!slice.length) return acc
      for (const d of slice) {
        for (let h = 0; h < 24; h++) acc[h] += d.hours[h] ?? 0
      }
      return acc.map((v) => v / slice.length)
    }

    const a7 = avgHours(7)
    const a30 = avgHours(30)
    const a90 = avgHours(90)
    for (let h = 0; h < 24; h++) {
      result.push({
        hour: `${String(h).padStart(2, '0')}`,
        h7: a7[h],
        h30: a30[h],
        h90: a90[h],
      })
    }
    return result
  }, [hourlyDays, todayKey])

  if (!daily) {
    return <div className="h-64 animate-pulse panel bg-surface-2" />
  }

  const colorOf = (key: (typeof WINDOWS)[number]['colorKey']) => colors[key]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {WINDOWS.map((w) => {
          const s = stats[w.id]
          const todayVsAvg =
            s.avg > 0 && todayEntry ? todayEntry.totalTokens / s.avg : null
          let pace = '进行中'
          if (todayVsAvg != null) {
            if (todayVsAvg >= 1.15) pace = '今天偏勤奋'
            else if (todayVsAvg <= 0.7) pace = '今天偏懒'
            else pace = '今天接近日均'
          }
          return (
            <div key={w.id} className="panel px-3 py-2.5">
              <p className="section-label" style={{ color: colorOf(w.colorKey) }}>
                {w.label}
              </p>
              <p className="mt-1 text-lg font-semibold font-mono text-fg tracking-tight">
                {fmtTokens(s.sum)}
              </p>
              <p className="mt-1 text-[11px] text-fg-muted leading-snug">
                完整日 {s.dayCount} 天 · 日均 {fmtTokens(s.avg)}
                {todayEntry ? (
                  <>
                    <br />
                    今天 {fmtTokens(s.todayTokens)}
                    <span className="text-fg-faint"> · {pace}</span>
                  </>
                ) : null}
              </p>
            </div>
          )
        })}
      </div>

      <ChartPanel
        title="日用量分布对比"
        actions={
          <ChartLegendRow
            items={WINDOWS.map((w) => ({
              color: colorOf(w.colorKey),
              label: w.label,
            }))}
          />
        }
      >
        {densData.length === 0 ? (
          <p className="text-sm text-fg-muted py-8 text-center">
            完整日不足，暂无法画分布（需至少 1 个已结束的本地日）
          </p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={densData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGridProps(colors.grid)} />
                <XAxis
                  dataKey="x"
                  tick={tick}
                  tickFormatter={(v) => fmtAxisTokens(Number(v))}
                  tickLine={false}
                  axisLine={{ stroke: colors.grid }}
                  type="number"
                  domain={['dataMin', 'dataMax']}
                />
                <YAxis
                  tick={tick}
                  tickFormatter={() => ''}
                  width={28}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 1.05]}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const x = Number(payload[0]?.payload?.x ?? 0)
                    return (
                      <ChartTooltipShell label={`日用量 ≈ ${fmtTokens(x)}`}>
                        {WINDOWS.map((w, i) => (
                          <div key={w.id} className="flex justify-between gap-4">
                            <span className="text-fg-muted font-medium">{w.label}</span>
                            <span
                              className="chart-tooltip-value"
                              style={{ color: colorOf(w.colorKey) }}
                            >
                              {((payload[i]?.value as number) ?? 0).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </ChartTooltipShell>
                    )
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="d7"
                  stroke={colorOf('chart1')}
                  fill={colorOf('chart1')}
                  fillOpacity={0.12}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="d30"
                  stroke={colorOf('chart2')}
                  fill={colorOf('chart2')}
                  fillOpacity={0.08}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="d90"
                  stroke={colorOf('chart4')}
                  fill={colorOf('chart4')}
                  fillOpacity={0.06}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-2 text-[11px] text-fg-faint">
              曲线为完整本地日的日 token 总量核密度（峰值归一化便于比形状）。越靠右说明「大用量日」更多；今天单独标在卡片上，不计入分布。
            </p>
          </>
        )}
      </ChartPanel>

      {hourProfile && (
        <ChartPanel
          title="平均日内时段画像（次要）"
          actions={
            <ChartLegendRow
              items={WINDOWS.map((w) => ({
                color: colorOf(w.colorKey),
                label: w.label,
              }))}
            />
          }
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={hourProfile} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...chartGridProps(colors.grid)} />
              <XAxis
                dataKey="hour"
                tick={tick}
                interval={2}
                tickLine={false}
                axisLine={{ stroke: colors.grid }}
              />
              <YAxis
                tick={tick}
                tickFormatter={(v) => fmtTokens(Number(v))}
                width={52}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <ChartTooltipShell label={`${label}:00`}>
                      {WINDOWS.map((w, i) => (
                        <div key={w.id} className="flex justify-between gap-4">
                          <span className="text-fg-muted font-medium">{w.label}</span>
                          <span
                            className="chart-tooltip-value"
                            style={{ color: colorOf(w.colorKey) }}
                          >
                            {fmtTokens(Number(payload[i]?.value ?? 0))}
                          </span>
                        </div>
                      ))}
                    </ChartTooltipShell>
                  )
                }}
              />
              <Line
                type="monotone"
                dataKey="h7"
                stroke={colorOf('chart1')}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="h30"
                stroke={colorOf('chart2')}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="h90"
                stroke={colorOf('chart4')}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-[11px] text-fg-faint">
            各窗口完整日按小时平均 token，用来看「一天里几点更爱干活」。
          </p>
        </ChartPanel>
      )}
    </div>
  )
}
