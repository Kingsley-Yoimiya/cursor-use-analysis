/**
 * 每日 Token 消耗分布堆叠柱状图
 * 颜色语义：
 *   - cacheRead (缓存命中)：蓝色 #3b82f6，最节省，高亮
 *   - inputCacheWrite (缓存写入)：绿色 #22c55e
 *   - inputNoCache (无缓存输入)：橙色 #f97316，未命中，需关注
 *   - outputTokens (输出)：紫色 #a78bfa
 */
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useIsDark } from '../context/ThemeContext'

// ────────── 类型定义 ──────────

interface DailyEntry {
  date: string
  totalTokens: number
  cacheRead: number
  inputCacheWrite: number
  inputNoCache: number
  outputTokens: number
  cost: number
  rows: number
}

// ────────── 颜色配置 ──────────

const COLORS = {
  cacheRead: '#3b82f6',
  inputCacheWrite: '#22c55e',
  inputNoCache: '#f97316',
  outputTokens: '#a78bfa',
}

const LABELS: Record<keyof typeof COLORS, string> = {
  cacheRead: 'Cache Read',
  inputCacheWrite: 'Cache Write',
  inputNoCache: 'No-Cache Input',
  outputTokens: 'Output',
}

// ────────── 自定义 Tooltip ──────────

interface TooltipPayloadItem {
  value: number
  dataKey: keyof typeof COLORS
  color: string
  name: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-xl text-xs min-w-[160px]">
      <p className="mb-2 font-medium text-slate-500 dark:text-slate-400">{label}</p>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 mb-0.5">
          <span style={{ color: p.color }}>{LABELS[p.dataKey] ?? p.name}</span>
          <span className="font-mono text-slate-700 dark:text-slate-300">{fmtTok(p.value)}</span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-slate-200 dark:border-slate-800 pt-1 flex justify-between">
        <span className="text-slate-400 dark:text-slate-500">合计</span>
        <span className="font-mono text-slate-800 dark:text-slate-200">{fmtTok(total)}</span>
      </div>
    </div>
  )
}

// ────────── 图例渲染 ──────────

interface LegendPayloadItem {
  color: string
  value: string
  dataKey?: string
}

function CustomLegend({ payload }: { payload?: LegendPayloadItem[] }) {
  if (!payload) return null
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-2">
      {payload.map((entry) => (
        <span key={entry.value} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          {LABELS[entry.value as keyof typeof COLORS] ?? entry.value}
        </span>
      ))}
    </div>
  )
}

function fmtDate(d: string): string {
  const parts = d.split('-')
  if (parts.length < 3) return d
  return `${parts[1]}/${parts[2]}`
}

// ────────── 主组件 ──────────

interface TokenDistChartProps {
  daily: DailyEntry[] | null
}

export function TokenDistChart({ daily }: TokenDistChartProps) {
  const isDark = useIsDark()
  const gridColor = isDark ? '#1e293b' : '#e2e8f0'
  const tickColor = isDark ? '#64748b' : '#94a3b8'

  if (!daily) {
    return (
      <div className="h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800" />
    )
  }

  const chartData = daily.map((d) => ({
    date: fmtDate(d.date),
    cacheRead: d.cacheRead,
    inputCacheWrite: d.inputCacheWrite,
    inputNoCache: d.inputNoCache,
    outputTokens: d.outputTokens,
  }))

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 shadow-sm dark:shadow-lg">
      <h3 className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">
        每日 Token 消耗分布
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={chartData}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: tickColor, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: tickColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmtTok(v)}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: isDark ? '#1e293b55' : '#e2e8f055' }} />
          <Legend content={<CustomLegend />} />
          <Bar dataKey="cacheRead" name="cacheRead" stackId="a" fill={COLORS.cacheRead} radius={[0, 0, 0, 0]} />
          <Bar dataKey="inputCacheWrite" name="inputCacheWrite" stackId="a" fill={COLORS.inputCacheWrite} />
          <Bar dataKey="inputNoCache" name="inputNoCache" stackId="a" fill={COLORS.inputNoCache} />
          <Bar dataKey="outputTokens" name="outputTokens" stackId="a" fill={COLORS.outputTokens} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
