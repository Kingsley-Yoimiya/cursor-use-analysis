/**
 * 浏览器侧用量引擎：口径对齐 dashboard/server/index.js。
 */
import ratesConfig from 'virtual:model-rates'
import {
  classifyPool,
  resolveRateForModel,
  type ModelRate,
  type PoolName,
} from '../resolveModelRate'
import { parseCsvText } from './parseCsv'

export const CSV_COL = {
  date: 'Date',
  model: 'Model',
  inCacheWrite: 'Input (w/ Cache Write)',
  inNoCache: 'Input (w/o Cache Write)',
  cacheRead: 'Cache Read',
  output: 'Output Tokens',
  total: 'Total Tokens',
}

export const SHANGHAI_TZ = 'Asia/Shanghai'

export type PoolValues = {
  Auto: number
  FirstParty: number
  API: number
}

export type DailyEntry = {
  date: string
  totalTokens: number
  cacheRead: number
  inputCacheWrite: number
  inputNoCache: number
  outputTokens: number
  cost: number
  costByPool: PoolValues
  tokensByPool: PoolValues
  costByModel: Record<string, number>
  tokensByModel: Record<string, number>
  rows: number
}

export type HourlyDay = {
  date: string
  hours: number[]
  costHours: number[]
  totalTokens: number
  totalCost: number
  rows: number
}

export type ParsedUsageRow = {
  day: string
  cacheRead: number
  inputCacheWrite: number
  inputNoCache: number
  outputTokens: number
  totalTokens: number
  estimatedUsd: number
  pool: PoolName
  rowTokens: number
  modelKey: string
  isFast: boolean
  raw: Record<string, string>
}

export type ModelSummary = {
  model: string
  requests: number
  estimatedUsd: number
  tokens: {
    cacheWrite: number
    noCache: number
    cacheRead: number
    output: number
  }
}

export const BILLING_DEFAULTS = {
  defaultBillingCycleDay: 23,
  billingCycleDayMin: 1,
  billingCycleDayMax: 28,
}

const EXPORT_EXTRA_HEADERS = [
  'Day',
  'Estimated USD',
  'Pool',
  'Resolved Model',
  'Billing Cycle',
]

function parseIntField(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback
  const n = Number.parseInt(String(v).replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : fallback
}

export function estimateTokensUsd(
  t: {
    cacheWrite: number
    noCache: number
    cacheRead: number
    output: number
  },
  rate: ModelRate,
): number {
  const inputTokensTotal = t.cacheWrite + t.noCache + t.cacheRead
  let inputMult = 1
  if (
    rate.longContextInputTokensThreshold != null &&
    inputTokensTotal > rate.longContextInputTokensThreshold
  ) {
    inputMult = rate.longContextMultiplier ?? 1
  }
  const inputUsd =
    ((t.cacheWrite / 1e6) * rate.cacheWritePerMillion +
      (t.noCache / 1e6) * rate.inputPerMillion +
      (t.cacheRead / 1e6) * rate.cacheReadPerMillion) *
    inputMult
  const outputUsd = (t.output / 1e6) * rate.outputPerMillion
  return inputUsd + outputUsd
}

function isFastModel(resolvedKey: string, modelRaw: string): boolean {
  const key = String(resolvedKey || '').toLowerCase()
  if (key.includes('-fast')) return true
  const raw = String(modelRaw || '').toLowerCase()
  return raw.includes('fast')
}

export function dayKeyFromDateCell(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  const iso = String(dateStr).trim()
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  } catch {
    return null
  }
}

export function shanghaiDayHour(
  dateStr: string | undefined,
): { date: string; hour: number } | null {
  if (!dateStr) return null
  const d = new Date(String(dateStr).trim())
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hourRaw = get('hour')
  if (!year || !month || !day || hourRaw == null) return null
  let hour = Number.parseInt(hourRaw, 10)
  if (hour === 24) hour = 0
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null
  return { date: `${year}-${month}-${day}`, hour }
}

export function todayShanghai(): string | null {
  return shanghaiDayHour(new Date().toISOString())?.date ?? null
}

export function processUsageRow(
  row: Record<string, string>,
): ParsedUsageRow | null {
  const day = dayKeyFromDateCell(row[CSV_COL.date])
  if (!day) return null

  const cacheRead = parseIntField(row[CSV_COL.cacheRead])
  const inputCacheWrite = parseIntField(row[CSV_COL.inCacheWrite])
  const inputNoCache = parseIntField(row[CSV_COL.inNoCache])
  const outputTokens = parseIntField(row[CSV_COL.output])
  const totalTokens =
    parseIntField(row[CSV_COL.total]) ||
    cacheRead + inputCacheWrite + inputNoCache + outputTokens

  const modelRaw = row[CSV_COL.model] ?? ''
  const { kind, rate, resolvedKey } = resolveRateForModel(modelRaw, ratesConfig)
  let estimatedUsd = 0
  if (rate) {
    estimatedUsd = estimateTokensUsd(
      {
        cacheWrite: inputCacheWrite,
        noCache: inputNoCache,
        cacheRead,
        output: outputTokens,
      },
      rate,
    )
  }

  const pool = classifyPool(kind, resolvedKey, rate)
  const rowTokens = cacheRead + inputCacheWrite + inputNoCache + outputTokens
  const modelKey = resolvedKey || String(modelRaw || 'unknown').trim() || 'unknown'

  return {
    day,
    cacheRead,
    inputCacheWrite,
    inputNoCache,
    outputTokens,
    totalTokens,
    estimatedUsd,
    pool,
    rowTokens,
    modelKey,
    isFast: isFastModel(resolvedKey, modelRaw),
    raw: row,
  }
}

function emptyPools(): PoolValues {
  return { Auto: 0, FirstParty: 0, API: 0 }
}

export function parseUsageRows(csvText: string): ParsedUsageRow[] {
  const rows = parseCsvText(csvText)
  const out: ParsedUsageRow[] = []
  for (const row of rows) {
    const parsed = processUsageRow(row)
    if (parsed) out.push(parsed)
  }
  return out
}

export function aggregateDaily(rows: ParsedUsageRow[]): DailyEntry[] {
  const byDay = new Map<string, DailyEntry>()
  for (const parsed of rows) {
    let agg = byDay.get(parsed.day)
    if (!agg) {
      agg = {
        date: parsed.day,
        totalTokens: 0,
        cacheRead: 0,
        inputCacheWrite: 0,
        inputNoCache: 0,
        outputTokens: 0,
        cost: 0,
        costByPool: emptyPools(),
        tokensByPool: emptyPools(),
        costByModel: {},
        tokensByModel: {},
        rows: 0,
      }
      byDay.set(parsed.day, agg)
    }
    agg.totalTokens += parsed.totalTokens
    agg.cacheRead += parsed.cacheRead
    agg.inputCacheWrite += parsed.inputCacheWrite
    agg.inputNoCache += parsed.inputNoCache
    agg.outputTokens += parsed.outputTokens
    agg.cost += parsed.estimatedUsd
    agg.costByPool[parsed.pool] += parsed.estimatedUsd
    agg.tokensByPool[parsed.pool] += parsed.rowTokens
    agg.costByModel[parsed.modelKey] =
      (agg.costByModel[parsed.modelKey] ?? 0) + parsed.estimatedUsd
    agg.tokensByModel[parsed.modelKey] =
      (agg.tokensByModel[parsed.modelKey] ?? 0) + parsed.rowTokens
    agg.rows += 1
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function mergeDailyMaps(lists: DailyEntry[][]): DailyEntry[] {
  const map = new Map<string, DailyEntry>()
  for (const list of lists) {
    for (const d of list) {
      let cur = map.get(d.date)
      if (!cur) {
        map.set(d.date, {
          ...d,
          costByPool: { ...emptyPools(), ...d.costByPool },
          tokensByPool: { ...emptyPools(), ...d.tokensByPool },
          costByModel: { ...(d.costByModel || {}) },
          tokensByModel: { ...(d.tokensByModel || {}) },
        })
        continue
      }
      cur.totalTokens += d.totalTokens || 0
      cur.cacheRead += d.cacheRead || 0
      cur.inputCacheWrite += d.inputCacheWrite || 0
      cur.inputNoCache += d.inputNoCache || 0
      cur.outputTokens += d.outputTokens || 0
      cur.cost += d.cost || 0
      cur.rows += d.rows || 0
      for (const k of Object.keys(emptyPools()) as PoolName[]) {
        cur.costByPool[k] = (cur.costByPool[k] || 0) + (d.costByPool?.[k] || 0)
        cur.tokensByPool[k] =
          (cur.tokensByPool[k] || 0) + (d.tokensByPool?.[k] || 0)
      }
      for (const [mk, mv] of Object.entries(d.costByModel || {})) {
        cur.costByModel[mk] = (cur.costByModel[mk] || 0) + mv
      }
      for (const [mk, mv] of Object.entries(d.tokensByModel || {})) {
        cur.tokensByModel[mk] = (cur.tokensByModel[mk] || 0) + mv
      }
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function aggregateHourly(rows: ParsedUsageRow[]): HourlyDay[] {
  const byDay = new Map<string, HourlyDay>()
  for (const parsed of rows) {
    const local = shanghaiDayHour(parsed.raw[CSV_COL.date])
    if (!local) continue
    let agg = byDay.get(local.date)
    if (!agg) {
      agg = {
        date: local.date,
        hours: Array.from({ length: 24 }, () => 0),
        costHours: Array.from({ length: 24 }, () => 0),
        totalTokens: 0,
        totalCost: 0,
        rows: 0,
      }
      byDay.set(local.date, agg)
    }
    agg.hours[local.hour] += parsed.rowTokens
    agg.costHours[local.hour] += parsed.estimatedUsd
    agg.totalTokens += parsed.rowTokens
    agg.totalCost += parsed.estimatedUsd
    agg.rows += 1
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function mergeHourlyLists(lists: HourlyDay[][]): HourlyDay[] {
  const map = new Map<string, HourlyDay>()
  for (const list of lists) {
    for (const d of list) {
      let cur = map.get(d.date)
      if (!cur) {
        map.set(d.date, {
          date: d.date,
          hours: [...d.hours],
          costHours: [...(d.costHours || Array(24).fill(0))],
          totalTokens: d.totalTokens || 0,
          totalCost: d.totalCost || 0,
          rows: d.rows || 0,
        })
        continue
      }
      for (let h = 0; h < 24; h++) {
        cur.hours[h] += d.hours[h] || 0
        cur.costHours[h] += d.costHours?.[h] || 0
      }
      cur.totalTokens += d.totalTokens || 0
      cur.totalCost += d.totalCost || 0
      cur.rows += d.rows || 0
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function buildSummary(rows: ParsedUsageRow[]) {
  const byModelMap = new Map<string, ModelSummary>()
  let unknownModelRows = 0
  let totalEstimatedUsd = 0
  for (const row of rows) {
    totalEstimatedUsd += row.estimatedUsd
    if (row.modelKey === 'unknown' || !row.modelKey) unknownModelRows += 1
    let cur = byModelMap.get(row.modelKey)
    if (!cur) {
      cur = {
        model: row.modelKey,
        requests: 0,
        estimatedUsd: 0,
        tokens: { cacheWrite: 0, noCache: 0, cacheRead: 0, output: 0 },
      }
      byModelMap.set(row.modelKey, cur)
    }
    cur.requests += 1
    cur.estimatedUsd += row.estimatedUsd
    cur.tokens.cacheWrite += row.inputCacheWrite
    cur.tokens.noCache += row.inputNoCache
    cur.tokens.cacheRead += row.cacheRead
    cur.tokens.output += row.outputTokens
  }
  const byModel = [...byModelMap.values()].sort(
    (a, b) => b.estimatedUsd - a.estimatedUsd,
  )
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      rows: rows.length,
      unknownModelRows,
      totalEstimatedUsd,
    },
    byModel,
  }
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function formatLocalDate(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function addCalendarMonths(y: number, m: number, delta: number) {
  let nm = m + delta
  let ny = y
  while (nm > 12) {
    nm -= 12
    ny += 1
  }
  while (nm < 1) {
    nm += 12
    ny -= 1
  }
  return { y: ny, m: nm }
}

function calendarMonthKey(day: string) {
  return day.slice(0, 7)
}

function calendarMonthLabel(key: string) {
  const [y, m] = key.split('-')
  return `${y}年${Number(m)}月`
}

function calendarMonthRange(key: string) {
  const [y, m] = key.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return {
    startDate: `${key}-01`,
    endDate: `${key}-${String(lastDay).padStart(2, '0')}`,
  }
}

export function billingCycleKeyFromDay(day: string, cycleDay: number) {
  const [y, m, d] = day.split('-').map(Number)
  if (d >= cycleDay) {
    return `${y}-${pad2(m)}-${pad2(cycleDay)}`
  }
  let year = y
  let month = m - 1
  if (month < 1) {
    month = 12
    year -= 1
  }
  return `${year}-${pad2(month)}-${pad2(cycleDay)}`
}

export function billingCycleRange(cycleKey: string) {
  const [y, m, d] = cycleKey.split('-').map(Number)
  const startDate = formatLocalDate(y, m, d)
  const next = addCalendarMonths(y, m, 1)
  const endDate = formatLocalDate(next.y, next.m, d)
  const last = new Date(next.y, next.m - 1, d)
  last.setDate(last.getDate() - 1)
  const dataEndDate = formatLocalDate(
    last.getFullYear(),
    last.getMonth() + 1,
    last.getDate(),
  )
  return { startDate, endDate, dataEndDate }
}

export function billingCycleLabel(cycleKey: string) {
  const { startDate, endDate } = billingCycleRange(cycleKey)
  return `${startDate} ~ ${endDate}`
}

function pctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}

const POOLS: PoolName[] = ['Auto', 'FirstParty', 'API']

type PeriodAgg = {
  key: string
  label: string
  startDate: string
  endDate: string
  totalTokens: number
  totalCost: number
  totalRows: number
  fastTokens: number
  fastRows: number
  costByPool: PoolValues
  tokensByPool: PoolValues
  byModel: Map<string, { model: string; requests: number; tokens: number; cost: number }>
}

function createEmptyPeriodAgg(
  key: string,
  label: string,
  startDate: string,
  endDate: string,
): PeriodAgg {
  return {
    key,
    label,
    startDate,
    endDate,
    totalTokens: 0,
    totalCost: 0,
    totalRows: 0,
    fastTokens: 0,
    fastRows: 0,
    costByPool: emptyPools(),
    tokensByPool: emptyPools(),
    byModel: new Map(),
  }
}

function addRowToPeriodAgg(agg: PeriodAgg, row: ParsedUsageRow) {
  agg.totalTokens += row.rowTokens
  agg.totalCost += row.estimatedUsd
  agg.totalRows += 1
  if (row.isFast) {
    agg.fastTokens += row.rowTokens
    agg.fastRows += 1
  }
  agg.costByPool[row.pool] += row.estimatedUsd
  agg.tokensByPool[row.pool] += row.rowTokens
  let modelAgg = agg.byModel.get(row.modelKey)
  if (!modelAgg) {
    modelAgg = { model: row.modelKey, requests: 0, tokens: 0, cost: 0 }
    agg.byModel.set(row.modelKey, modelAgg)
  }
  modelAgg.requests += 1
  modelAgg.tokens += row.rowTokens
  modelAgg.cost += row.estimatedUsd
}

function poolShares(
  costByPool: PoolValues,
  tokensByPool: PoolValues,
  totalCost: number,
  totalTokens: number,
) {
  const costShare: PoolValues = emptyPools()
  const tokenShare: PoolValues = emptyPools()
  for (const pool of POOLS) {
    costShare[pool] = totalCost > 0 ? costByPool[pool] / totalCost : 0
    tokenShare[pool] = totalTokens > 0 ? tokensByPool[pool] / totalTokens : 0
  }
  return { costShare, tokenShare }
}

function finalizePeriodList(
  periodMap: Map<string, PeriodAgg>,
  kind: 'calendar' | 'billing',
  billingCycleDay: number,
) {
  const sortedKeys = [...periodMap.keys()].sort()
  const finalized = sortedKeys.map((key) => {
    const agg = periodMap.get(key)!
    const range =
      kind === 'calendar' ? calendarMonthRange(key) : billingCycleRange(key)
    const label =
      kind === 'calendar' ? calendarMonthLabel(key) : billingCycleLabel(key)
    const models = [...agg.byModel.values()].sort((a, b) => b.cost - a.cost)
    const totalModelRequests = models.reduce((s, m) => s + m.requests, 0)
    const { costShare, tokenShare } = poolShares(
      agg.costByPool,
      agg.tokensByPool,
      agg.totalCost,
      agg.totalTokens,
    )
    return {
      key,
      label,
      startDate: range.startDate,
      endDate: range.endDate,
      dataEndDate: 'dataEndDate' in range ? range.dataEndDate : range.endDate,
      totalTokens: agg.totalTokens,
      totalCost: agg.totalCost,
      totalRows: agg.totalRows,
      fastTokens: agg.fastTokens,
      fastRows: agg.fastRows,
      fastRatio: agg.totalTokens > 0 ? agg.fastTokens / agg.totalTokens : 0,
      fastRowRatio: agg.totalRows > 0 ? agg.fastRows / agg.totalRows : 0,
      costByPool: agg.costByPool,
      tokensByPool: agg.tokensByPool,
      costShareByPool: costShare,
      tokenShareByPool: tokenShare,
      topModels: models.slice(0, 3),
      modelFrequency: models
        .slice()
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 10)
        .map((m) => ({
          ...m,
          requestShare:
            totalModelRequests > 0 ? m.requests / totalModelRequests : 0,
        })),
      changes: null as null | Record<string, unknown>,
    }
  })

  for (let i = 0; i < finalized.length; i++) {
    const cur = finalized[i]
    const prev = i > 0 ? finalized[i - 1] : null
    cur.changes = prev
      ? {
          costPct: pctChange(cur.totalCost, prev.totalCost),
          tokensPct: pctChange(cur.totalTokens, prev.totalTokens),
          rowsPct: pctChange(cur.totalRows, prev.totalRows),
          fastRatioDelta: cur.fastRatio - prev.fastRatio,
          poolChanges: Object.fromEntries(
            POOLS.map((pool) => [
              pool,
              {
                costPct: pctChange(cur.costByPool[pool], prev.costByPool[pool]),
                tokensPct: pctChange(
                  cur.tokensByPool[pool],
                  prev.tokensByPool[pool],
                ),
                costShareDelta:
                  cur.costShareByPool[pool] - prev.costShareByPool[pool],
                tokenShareDelta:
                  cur.tokenShareByPool[pool] - prev.tokenShareByPool[pool],
              },
            ]),
          ),
        }
      : null
  }

  return {
    kind,
    billingCycleDay: kind === 'billing' ? billingCycleDay : null,
    periods: finalized,
  }
}

export function clampBillingCycleDay(raw: unknown): number {
  const min = BILLING_DEFAULTS.billingCycleDayMin
  const max = BILLING_DEFAULTS.billingCycleDayMax
  let n = Number(raw)
  if (!Number.isFinite(n)) n = BILLING_DEFAULTS.defaultBillingCycleDay
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function aggregatePeriodStats(
  rows: ParsedUsageRow[],
  billingCycleDay: number,
) {
  const calendarMap = new Map<string, PeriodAgg>()
  const billingMap = new Map<string, PeriodAgg>()
  const day = clampBillingCycleDay(billingCycleDay)

  for (const parsed of rows) {
    const calKey = calendarMonthKey(parsed.day)
    if (!calendarMap.has(calKey)) {
      const range = calendarMonthRange(calKey)
      calendarMap.set(
        calKey,
        createEmptyPeriodAgg(
          calKey,
          calendarMonthLabel(calKey),
          range.startDate,
          range.endDate,
        ),
      )
    }
    addRowToPeriodAgg(calendarMap.get(calKey)!, parsed)

    const billKey = billingCycleKeyFromDay(parsed.day, day)
    if (!billingMap.has(billKey)) {
      const range = billingCycleRange(billKey)
      billingMap.set(
        billKey,
        createEmptyPeriodAgg(
          billKey,
          billingCycleLabel(billKey),
          range.startDate,
          range.endDate,
        ),
      )
    }
    addRowToPeriodAgg(billingMap.get(billKey)!, parsed)
  }

  return {
    billingCycleDay: day,
    defaultBillingCycleDay: BILLING_DEFAULTS.defaultBillingCycleDay,
    billingCycleDayRange: {
      min: BILLING_DEFAULTS.billingCycleDayMin,
      max: BILLING_DEFAULTS.billingCycleDayMax,
    },
    calendarMonths: finalizePeriodList(calendarMap, 'calendar', day),
    billingCycles: finalizePeriodList(billingMap, 'billing', day),
  }
}

function escapeCsvCell(v: unknown) {
  const s = v == null ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function formatUsdForCsv(n: number) {
  return (Math.round(Number(n) * 1e6) / 1e6).toFixed(6)
}

export function exportUsageWithCostCsv(
  rows: ParsedUsageRow[],
  opts: { billingCycleDay: number; periodKey?: string | null },
): { filename: string; text: string } {
  const billingCycleDay = clampBillingCycleDay(opts.billingCycleDay)
  const periodKey = opts.periodKey || null
  const headerKeys =
    rows[0] != null ? Object.keys(rows[0].raw) : Object.values(CSV_COL)
  const bodyLines: string[] = []
  for (const parsed of rows) {
    const cycleKey = billingCycleKeyFromDay(parsed.day, billingCycleDay)
    if (periodKey && cycleKey !== periodKey) continue
    const cycleLabel = billingCycleLabel(cycleKey)
    const origCells = headerKeys.map((h) => escapeCsvCell(parsed.raw[h]))
    const extraCells = [
      parsed.day,
      formatUsdForCsv(parsed.estimatedUsd),
      parsed.pool,
      parsed.modelKey,
      cycleLabel,
    ].map(escapeCsvCell)
    bodyLines.push([...origCells, ...extraCells].join(','))
  }
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = periodKey
    ? `cursor-usage-with-cost-${periodKey}.csv`
    : `cursor-usage-with-cost-${stamp}.csv`
  const headerLine = [...headerKeys, ...EXPORT_EXTRA_HEADERS]
    .map(escapeCsvCell)
    .join(',')
  const text = `\uFEFF${headerLine}\n${bodyLines.join('\n')}\n`
  return { filename, text }
}
