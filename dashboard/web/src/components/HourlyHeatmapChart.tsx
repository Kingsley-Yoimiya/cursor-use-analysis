/**
 * 多日 × 24h token 热力条（Asia/Shanghai）
 */
import { useMemo } from 'react'
import { useChartColors } from '../context/ThemeContext'
import { ChartPanel } from '../lib/chartChrome'
import { fmtTokens } from '../lib/formatTokens'

export interface HourlyDay {
  date: string
  hours: number[]
  totalTokens: number
  rows: number
}

interface HourlyHeatmapChartProps {
  days: HourlyDay[] | null
  selectedDate: string | null
  onSelectDate: (date: string) => void
  today?: string | null
  maxRows?: number
}

function heatColor(t: number, accent: string, empty: string): string {
  if (t <= 0) return empty
  const clamped = Math.min(1, Math.max(0, t))
  // 低→高：淡底 → accent
  const a = 0.12 + clamped * 0.88
  return `color-mix(in srgb, ${accent} ${Math.round(a * 100)}%, transparent)`
}

function fmtDayLabel(date: string, today?: string | null): string {
  const parts = date.split('-')
  if (parts.length < 3) return date
  const base = `${parts[1]}/${parts[2]}`
  if (today && date === today) return `${base} 今天`
  return base
}

export function HourlyHeatmapChart({
  days,
  selectedDate,
  onSelectDate,
  today = null,
  maxRows = 90,
}: HourlyHeatmapChartProps) {
  const colors = useChartColors()

  const viewDays = useMemo(() => {
    if (!days) return null
    return days.length > maxRows ? days.slice(-maxRows) : days
  }, [days, maxRows])

  const maxHour = useMemo(() => {
    if (!viewDays?.length) return 1
    let m = 0
    for (const d of viewDays) {
      for (const h of d.hours) if (h > m) m = h
    }
    return m || 1
  }, [viewDays])

  if (!viewDays) {
    return <div className="h-64 animate-pulse panel bg-surface-2" />
  }

  if (viewDays.length === 0) {
    return (
      <ChartPanel title="每日 × 24 小时热力（UTC+8）">
        <p className="text-sm text-fg-muted py-8 text-center">暂无小时级用量数据</p>
      </ChartPanel>
    )
  }

  const emptyCell = 'color-mix(in srgb, var(--border-subtle) 55%, transparent)'

  return (
    <ChartPanel
      title="每日 × 24 小时热力（UTC+8）"
      actions={
        <span className="text-[11px] text-fg-faint font-mono">
          {viewDays.length} 天 · 点选展开
        </span>
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div
            className="grid gap-px mb-1 text-[9px] font-mono text-fg-faint"
            style={{
              gridTemplateColumns: '64px repeat(24, minmax(0, 1fr)) 72px',
            }}
          >
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="text-center">
                {h % 3 === 0 ? h : ''}
              </span>
            ))}
            <span className="text-right pr-1">合计</span>
          </div>

          <div className="max-h-[320px] overflow-y-auto space-y-px">
            {[...viewDays].reverse().map((d) => {
              const selected = d.date === selectedDate
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => onSelectDate(d.date)}
                  className={`w-full grid gap-px rounded-sm transition-colors ${
                    selected
                      ? 'ring-1 ring-accent bg-accent-soft/40'
                      : 'hover:bg-surface-2'
                  }`}
                  style={{
                    gridTemplateColumns: '64px repeat(24, minmax(0, 1fr)) 72px',
                  }}
                  title={`${d.date} · ${fmtTokens(d.totalTokens)} token · ${d.rows} 行`}
                >
                  <span
                    className={`text-[10px] font-mono self-center text-left pl-0.5 truncate ${
                      d.date === today ? 'text-accent font-semibold' : 'text-fg-muted'
                    }`}
                  >
                    {fmtDayLabel(d.date, today)}
                  </span>
                  {d.hours.map((v, h) => (
                    <span
                      key={h}
                      className="h-4 rounded-[1px]"
                      style={{
                        background: heatColor(v / maxHour, colors.chart1, emptyCell),
                      }}
                      title={`${String(h).padStart(2, '0')}:00 · ${fmtTokens(v)}`}
                    />
                  ))}
                  <span className="text-[10px] font-mono text-fg-muted self-center text-right pr-1">
                    {fmtTokens(d.totalTokens)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-fg-faint">
        颜色越深该小时 token 越多（相对窗内峰值）。Token = Cache Write + No-Cache + Cache Read +
        Output。
      </p>
    </ChartPanel>
  )
}
