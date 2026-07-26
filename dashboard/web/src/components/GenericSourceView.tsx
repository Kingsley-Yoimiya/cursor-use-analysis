/**
 * 通用附加数据源视图：渲染 summary JSON（schemaVersion 1）
 */
import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useChartColors } from '../context/ThemeContext'
import {
  MergeAddonToggle,
  type AddonSourceInfo,
} from './MergeAddonToggle'

interface TokenTotals {
  requests?: number
  ok?: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
  total_tokens?: number
}

interface DayRow extends TokenTotals {
  date: string
}

interface ModelRow extends TokenTotals {
  model: string
  cursorModel?: string
  mapSource?: string
}

interface PluginSummary {
  schemaVersion?: number
  id?: string
  title?: string
  generatedAt?: string
  disclaimer?: string
  totals?: TokenTotals
  byDay?: DayRow[]
  byModel?: ModelRow[]
  meta?: Record<string, unknown>
}

interface SummaryResponse {
  ok: boolean
  data?: PluginSummary
  error?: string
  hint?: string
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function n(v: unknown): number {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function KPICard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent: string
}) {
  return (
    <div
      className={`panel p-4
        relative overflow-hidden border-l-4 ${accent}`}
    >
      <p className="text-xs font-medium uppercase tracking-widest text-fg-faint">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold font-mono tracking-tight text-fg">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-fg-faint">{sub}</p>}
    </div>
  )
}

export function GenericSourceView({
  pluginId,
  refreshKey,
  mergeEnabled,
  onMergeChange,
  addonSources,
}: {
  pluginId: string
  refreshKey?: number
  mergeEnabled?: boolean
  onMergeChange?: (v: boolean) => void
  addonSources?: AddonSourceInfo[]
}) {
  const chartColors = useChartColors()
  const [data, setData] = useState<PluginSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const barColors = useMemo(
    () => ({
      cacheRead: chartColors.chart2,
      inputCacheWrite: chartColors.chart3,
      inputNoCache: chartColors.chart4,
      outputTokens: chartColors.chart5,
    }),
    [chartColors],
  )

  const load = () => {
    setLoading(true)
    setError(null)
    setHint(null)
    axios
      .get<SummaryResponse>(`/api/plugins/${pluginId}/summary`)
      .then((r) => {
        if (r.data.ok && r.data.data) {
          setData(r.data.data)
        } else {
          setData(null)
          setError(r.data.error ?? '接口返回异常')
          setHint(r.data.hint ?? null)
        }
      })
      .catch((e) => {
        setData(null)
        const body = e?.response?.data
        setError(body?.error || (e instanceof Error ? e.message : String(e)))
        setHint(body?.hint ?? null)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, refreshKey])

  const syncPlugin = async () => {
    setSyncing(true)
    try {
      await axios.post(`/api/plugins/${pluginId}/sync`)
      load()
    } catch (e: unknown) {
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data
      setError(body?.error || (e instanceof Error ? e.message : String(e)))
    } finally {
      setSyncing(false)
    }
  }

  const totals = data?.totals
  const chartData = useMemo(
    () =>
      (data?.byDay ?? []).map((d) => ({
        date: d.date,
        cacheRead: n(d.cache_read_tokens),
        inputCacheWrite: n(d.cache_creation_tokens),
        inputNoCache: n(d.input_tokens),
        outputTokens: n(d.output_tokens),
      })),
    [data],
  )

  const cacheHit =
    totals &&
    (() => {
      const cr = n(totals.cache_read_tokens)
      const denom = cr + n(totals.input_tokens) + n(totals.cache_creation_tokens)
      return denom > 0 ? cr / denom : null
    })()

  if (loading) {
    return (
      <div className="panel bg-surface-2 p-8 text-sm text-fg-muted">
        加载插件数据…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-warning-border bg-warning-soft p-4 text-sm text-warning">
          <p className="font-medium">{error || '暂无数据'}</p>
          {hint && <p className="mt-1 text-xs opacity-80">{hint}</p>}
        </div>
        <button
          type="button"
          onClick={syncPlugin}
          disabled={syncing}
          className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm
            hover:bg-surface disabled:opacity-50"
        >
          {syncing ? '导出中…' : '从本机数据源重新导出'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">
            {data.title || pluginId}
          </h2>
          <p className="mt-1 text-xs text-fg-faint font-mono">
            plugin={pluginId}
            {data.generatedAt ? ` · generated ${data.generatedAt}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {addonSources && onMergeChange && (
            <MergeAddonToggle
              sources={addonSources}
              enabled={Boolean(mergeEnabled)}
              onChange={onMergeChange}
            />
          )}
          <button
            type="button"
            onClick={syncPlugin}
            disabled={syncing}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs
              hover:bg-surface disabled:opacity-50"
          >
            {syncing ? '导出中…' : '重新导出'}
          </button>
        </div>
      </div>

      {data.disclaimer && (
        <p className="rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs text-fg-muted">
          {data.disclaimer}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KPICard
          label="Requests"
          value={fmtInt(n(totals?.requests))}
          sub={totals?.ok != null ? `ok ${fmtInt(n(totals.ok))}` : undefined}
          accent="border-l-accent"
        />
        <KPICard
          label="Total Tokens"
          value={fmtTokens(n(totals?.total_tokens))}
          sub="input + cache + output"
          accent="border-l-info"
        />
        <KPICard
          label="Cache Read"
          value={fmtTokens(n(totals?.cache_read_tokens))}
          sub={
            cacheHit == null ? undefined : `hit ${(cacheHit * 100).toFixed(1)}%`
          }
          accent="border-l-info"
        />
        <KPICard
          label="Output"
          value={fmtTokens(n(totals?.output_tokens))}
          sub={`plain IO ${fmtTokens(n(totals?.input_tokens) + n(totals?.output_tokens))}`}
          accent="border-l-violet"
        />
      </div>

      <section className="panel bg-surface-2 p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-widest text-fg-faint">
          按日 Token
        </h3>
        {chartData.length === 0 ? (
          <p className="text-sm text-fg-muted">暂无按日数据</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: chartColors.tick, fontSize: 11 }} />
                <YAxis tick={{ fill: chartColors.tick, fontSize: 11 }} tickFormatter={fmtTokens} />
                <Tooltip
                  contentStyle={{
                    background: chartColors.surface,
                    border: `1px solid ${chartColors.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend />
                <Bar dataKey="cacheRead" stackId="t" fill={barColors.cacheRead} name="Cache Read" />
                <Bar dataKey="inputCacheWrite" stackId="t" fill={barColors.inputCacheWrite} name="Cache Write" />
                <Bar dataKey="inputNoCache" stackId="t" fill={barColors.inputNoCache} name="Input" />
                <Bar dataKey="outputTokens" stackId="t" fill={barColors.outputTokens} name="Output" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="panel bg-surface-2 overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <h3 className="text-xs font-medium uppercase tracking-widest text-fg-faint">
            按模型
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-fg-faint bg-surface-2">
              <tr>
                <th className="text-left px-4 py-2 font-medium">源模型</th>
                <th className="text-left px-4 py-2 font-medium">映射键</th>
                <th className="text-right px-4 py-2 font-medium">Requests</th>
                <th className="text-right px-4 py-2 font-medium">Input</th>
                <th className="text-right px-4 py-2 font-medium">Cache R</th>
                <th className="text-right px-4 py-2 font-medium">Cache W</th>
                <th className="text-right px-4 py-2 font-medium">Output</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {(data.byModel ?? []).map((m) => {
                const total =
                  n(m.total_tokens) ||
                  n(m.input_tokens) +
                    n(m.output_tokens) +
                    n(m.cache_read_tokens) +
                    n(m.cache_creation_tokens)
                return (
                  <tr
                    key={m.model}
                    className="border-t border-line-subtle"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{m.model}</td>
                    <td className="px-4 py-2 font-mono text-xs text-accent">
                      {m.cursorModel || '—'}
                      {m.mapSource ? (
                        <span className="ml-1 text-[10px] text-fg-faint">
                          ({m.mapSource})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{fmtInt(n(m.requests))}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtTokens(n(m.input_tokens))}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {fmtTokens(n(m.cache_read_tokens))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {fmtTokens(n(m.cache_creation_tokens))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{fmtTokens(n(m.output_tokens))}</td>
                    <td className="px-4 py-2 text-right font-mono font-medium">
                      {fmtTokens(total)}
                    </td>
                  </tr>
                )
              })}
              {(data.byModel ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-fg-muted">
                    暂无模型数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
