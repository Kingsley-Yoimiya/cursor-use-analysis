/**
 * 多日 × 24h 热力条（Asia/Shanghai）
 * 可切换 Token / 估算 USD；高度由父级锁定，内部滚动
 */
import { useMemo, useState } from 'react'
import { useChartColors } from '../context/ThemeContext'
import { ChartPanel } from '../lib/chartChrome'
import { fmtTokens } from '../lib/formatTokens'

export interface HourlyDay {
  date: string
  hours: number[]
  costHours?: number[]
  totalTokens: number
  totalCost?: number
  rows: number
}

export type HeatMetric = 'tokens' | 'cost'

interface HourlyHeatmapChartProps {
  days: HourlyDay[] | null
  selectedDate: string | null
  onSelectDate: (date: string) => void
  today?: string | null
  maxRows?: number
  className?: string
}

function heatColor(t: number, accent: string, empty: string): string {
  if (t <= 0) return empty
  const clamped = Math.min(1, Math.max(0, t))
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

function fmtUsdShort(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 100) return `$${n.toFixed(0)}`
  if (Math.abs(n) >= 10) return `$${n.toFixed(1)}`
  return `$${n.toFixed(2)}`
}

function dayCost(d: HourlyDay): number {
  if (d.totalCost != null && Number.isFinite(d.totalCost)) return d.totalCost
  return (d.costHours || []).reduce((s, v) => s + v, 0)
}

function hourValues(d: HourlyDay, metric: HeatMetric): number[] {
  if (metric === 'cost') {
    return Array.from({ length: 24 }, (_, h) => Number(d.costHours?.[h] || 0))
  }
  return Array.from({ length: 24 }, (_, h) => Number(d.hours?.[h] || 0))
}

export function HourlyHeatmapChart({
  days,
  selectedDate,
  onSelectDate,
  today = null,
  maxRows = 90,
  className = '',
}: HourlyHeatmapChartProps) {
  const colors = useChartColors()
  const [metric, setMetric] = useState<HeatMetric>('tokens')

  const viewDays = useMemo(() => {
    if (!days) return null
    return days.length > maxRows ? days.slice(-maxRows) : days
  }, [days, maxRows])

  const accent = metric === 'cost' ? colors.chart2 : colors.chart1

  const maxHour = useMemo(() => {
    if (!viewDays?.length) return 1
    let m = 0
    for (const d of viewDays) {
      for (const h of hourValues(d, metric)) if (h > m) m = h
    }
    return m || 1
  }, [viewDays, metric])

  if (!viewDays) {
    return (
      <div className={`h-full animate-pulse panel bg-surface-2 ${className}`} />
    )
  }

  if (viewDays.length === 0) {
    return (
      <ChartPanel
        title="每日 × 24 小时热力（UTC+8）"
        className={`h-full ${className}`}
      >
        <p className="text-sm text-fg-muted py-8 text-center">
          暂无小时级用量数据
        </p>
      </ChartPanel>
    )
  }

  const emptyCell = 'color-mix(in srgb, var(--border-subtle) 55%, transparent)'

  return (
    <ChartPanel
      title="每日 × 24 小时热力（UTC+8）"
      className={`h-full overflow-hidden ${className}`}
      bodyClassName="flex flex-col min-h-0 overflow-hidden"
      actions={
        <div className="toolbar-cluster">
          <button
            type="button"
            className={`range-preset ${metric === 'tokens' ? 'is-active' : ''}`}
            onClick={() => setMetric('tokens')}
          >
            Token
          </button>
          <button
            type="button"
            className={`range-preset ${metric === 'cost' ? 'is-active' : ''}`}
            onClick={() => setMetric('cost')}
          >
            金额
          </button>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[560px]">
          <div
            className="grid gap-px mb-1 text-[9px] font-mono text-fg-faint sticky top-0 bg-surface z-[1]"
            style={{
              gridTemplateColumns: '56px repeat(24, minmax(0, 1fr)) 64px',
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

          <div className="space-y-px">
            {[...viewDays].reverse().map((d) => {
              const selected = d.date === selectedDate
              const vals = hourValues(d, metric)
              const total = metric === 'cost' ? dayCost(d) : d.totalTokens
              const totalLabel =
                metric === 'cost' ? fmtUsdShort(total) : fmtTokens(total)
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
                    gridTemplateColumns: '56px repeat(24, minmax(0, 1fr)) 64px',
                  }}
                  title={`${d.date} · ${fmtTokens(d.totalTokens)} · ${fmtUsdShort(dayCost(d))} · ${d.rows} 行`}
                >
                  <span
                    className={`text-[10px] font-mono self-center text-left pl-0.5 truncate ${
                      d.date === today
                        ? 'text-accent font-semibold'
                        : 'text-fg-muted'
                    }`}
                  >
                    {fmtDayLabel(d.date, today)}
                  </span>
                  {vals.map((v, h) => (
                    <span
                      key={h}
                      className="h-3.5 rounded-[1px]"
                      style={{
                        background: heatColor(v / maxHour, accent, emptyCell),
                      }}
                      title={`${String(h).padStart(2, '0')}:00 · ${
                        metric === 'cost' ? fmtUsdShort(v) : fmtTokens(v)
                      }`}
                    />
                  ))}
                  <span className="text-[10px] font-mono text-fg-muted self-center text-right pr-1">
                    {totalLabel}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </ChartPanel>
  )
}
