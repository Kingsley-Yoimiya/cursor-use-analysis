/**
 * 图表共用样式
 * 默认：编辑器 chrome（细实线网格、克制填充）
 * 论文主题：去顶右边框、仅 y 向 #808080 点线、空心描边 + hatch 柱
 */
import type { CSSProperties, ReactNode } from 'react'
import { useChartColors } from '../context/ThemeContext'

/** 概览页多图共用，Brush 拖动时同步窗口 */
export const OVERVIEW_SYNC_ID = 'overview-daily'

const HATCH_SIZE = 8

export function chartTickStyle(tickColor: string) {
  const paper =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.palette === 'paper'
  return {
    fill: tickColor,
    fontSize: paper ? 13 : 10,
    fontFamily: paper
      ? 'ui-sans-serif, system-ui, -apple-system, sans-serif'
      : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  } as const
}

export function chartGridProps(gridColor: string) {
  const paper =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.palette === 'paper'
  return {
    stroke: paper ? '#808080' : gridColor,
    strokeOpacity: paper ? 0.9 : 0.35,
    vertical: false as const,
    horizontal: true as const,
    strokeDasharray: paper ? '1.5 4' : '0',
    strokeWidth: paper ? 0.9 : 1,
  }
}

export function chartCursorFill(cursor: string) {
  return { fill: cursor, opacity: 0.35 }
}

function HatchPattern({
  id,
  color,
  variant,
  bg,
}: {
  id: string
  color: string
  variant: number
  bg: string
}) {
  const v = ((variant % 5) + 5) % 5
  return (
    <pattern
      id={id}
      width={HATCH_SIZE}
      height={HATCH_SIZE}
      patternUnits="userSpaceOnUse"
    >
      <rect width={HATCH_SIZE} height={HATCH_SIZE} fill={bg} />
      {v === 0 && (
        <path
          d="M0 8 L8 0 M-2 2 L2 -2 M6 10 L10 6"
          stroke={color}
          strokeWidth="1.15"
          fill="none"
        />
      )}
      {v === 1 && (
        <path
          d="M0 0 L8 8 M-2 6 L2 10 M6 -2 L10 2"
          stroke={color}
          strokeWidth="1.15"
          fill="none"
        />
      )}
      {v === 2 && (
        <path d="M4 0 L4 8" stroke={color} strokeWidth="1.2" fill="none" />
      )}
      {v === 3 && (
        <path d="M0 4 L8 4" stroke={color} strokeWidth="1.2" fill="none" />
      )}
      {v === 4 && (
        <>
          <path d="M0 8 L8 0" stroke={color} strokeWidth="1.05" fill="none" />
          <path d="M0 0 L8 8" stroke={color} strokeWidth="1.05" fill="none" />
        </>
      )}
    </pattern>
  )
}

export function paperHatchDefs(
  prefix: string,
  colors: string[],
  paper: boolean,
  bg: string,
): ReactNode {
  if (!paper || colors.length === 0) return null
  return (
    <defs>
      {colors.map((color, i) => (
        <HatchPattern
          key={`${prefix}-${i}`}
          id={`${prefix}-${i}`}
          color={color}
          variant={i}
          bg={bg}
        />
      ))}
    </defs>
  )
}

export function colorHatchId(prefix: string, color: string): string {
  return `${prefix}-${color.replace(/#/g, 'h').replace(/[^a-zA-Z0-9]/g, '')}`
}

export function paperColorHatchDefs(
  prefix: string,
  colors: string[],
  paper: boolean,
  bg: string,
): ReactNode {
  if (!paper) return null
  const unique = [...new Set(colors.filter((c) => c && c !== 'transparent'))]
  if (unique.length === 0) return null
  return (
    <defs>
      {unique.map((color, i) => (
        <HatchPattern
          key={color}
          id={colorHatchId(prefix, color)}
          color={color}
          variant={i}
          bg={bg}
        />
      ))}
    </defs>
  )
}

export function paperBarProps(
  prefix: string,
  color: string,
  index: number,
  paper: boolean,
): { fill: string; stroke?: string; strokeWidth?: number } {
  if (!paper) return { fill: color }
  return {
    fill: `url(#${prefix}-${index})`,
    stroke: color,
    strokeWidth: 1.15,
  }
}

export function paperColorFill(
  prefix: string,
  color: string,
  paper: boolean,
): string {
  if (!paper || !color || color === 'transparent') return color
  return `url(#${colorHatchId(prefix, color)})`
}

function hatchSwatchStyle(color: string, index: number): CSSProperties {
  const v = index % 5
  const base: CSSProperties = {
    width: 14,
    height: 10,
    borderRadius: 0,
    border: `1px solid ${color}`,
    backgroundColor: '#fff',
    backgroundSize: '6px 6px',
  }
  if (v === 0) {
    return {
      ...base,
      backgroundImage: `repeating-linear-gradient(-45deg, ${color} 0 1px, transparent 1px 5px)`,
    }
  }
  if (v === 1) {
    return {
      ...base,
      backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 1px, transparent 1px 5px)`,
    }
  }
  if (v === 2) {
    return {
      ...base,
      backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 1.5px, transparent 1.5px 6px)`,
    }
  }
  if (v === 3) {
    return {
      ...base,
      backgroundImage: `repeating-linear-gradient(0deg, ${color} 0 1.5px, transparent 1.5px 6px)`,
    }
  }
  return {
    ...base,
    backgroundImage: `repeating-linear-gradient(45deg, ${color} 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, ${color} 0 1px, transparent 1px 5px)`,
  }
}

export function ChartPanel({
  title,
  actions,
  children,
  className = '',
  bodyClassName = '',
  band,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  band?: 'warm' | 'cool'
}) {
  const bandClass =
    band === 'warm' ? 'band-warm' : band === 'cool' ? 'band-cool' : ''
  return (
    <div
      className={`panel p-3 flex flex-col min-h-0 ${bandClass} ${className}`.trim()}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h3 className="panel-title">{title}</h3>
        {actions}
      </div>
      <div className={`min-h-0 flex-1 ${bodyClassName}`.trim()}>{children}</div>
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
  const { paper } = useChartColors()
  return (
    <div className="chart-legend">
      {items.map((it, i) => (
        <span key={it.label} className="chart-legend-item">
          <span
            className="chart-legend-swatch"
            style={
              paper
                ? hatchSwatchStyle(it.color, i)
                : { backgroundColor: it.color }
            }
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}
