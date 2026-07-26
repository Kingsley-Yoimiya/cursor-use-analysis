/**
 * 编辑器 chrome 风格的图表共用样式（对标 VSCode hover / 面板）
 * — 细实线网格、等宽刻度、直角柱、克制填充、hover 小窗
 */
import type { ReactNode } from 'react'

/** 概览页多图共用，Brush 拖动时同步窗口 */
export const OVERVIEW_SYNC_ID = 'overview-daily'

export function chartTickStyle(tickColor: string) {
  return {
    fill: tickColor,
    fontSize: 10,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  } as const
}

export function chartGridProps(gridColor: string) {
  return {
    stroke: gridColor,
    strokeOpacity: 0.35,
    vertical: false as const,
    horizontal: true as const,
    strokeDasharray: '0',
  }
}

export function chartCursorFill(cursor: string) {
  return { fill: cursor, opacity: 0.35 }
}

export function ChartPanel({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="panel p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="panel-title">{title}</h3>
        {actions}
      </div>
      {children}
    </div>
  )
}

export function ChartTooltipShell({
  label,
  children,
}: {
  label?: string
  children: ReactNode
}) {
  return (
    <div className="chart-tooltip">
      {label != null && label !== '' && (
        <p className="chart-tooltip-label">{label}</p>
      )}
      {children}
    </div>
  )
}

export function ChartLegendRow({
  items,
}: {
  items: { color: string; label: string }[]
}) {
  return (
    <div className="chart-legend">
      {items.map((it) => (
        <span key={it.label} className="chart-legend-item">
          <span
            className="chart-legend-swatch"
            style={{ backgroundColor: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}
