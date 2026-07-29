interface PoolValues {
  Auto: number
  FirstParty: number
  API: number
}

export interface DailyEntry {
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

function emptyPools(): PoolValues {
  return { Auto: 0, FirstParty: 0, API: 0 }
}

function addPools(a: PoolValues, b?: Partial<PoolValues>): PoolValues {
  return {
    Auto: (a.Auto || 0) + Number(b?.Auto || 0),
    FirstParty: (a.FirstParty || 0) + Number(b?.FirstParty || 0),
    API: (a.API || 0) + Number(b?.API || 0),
  }
}

function addRecord(
  a: Record<string, number>,
  b?: Record<string, number>,
): Record<string, number> {
  const out = { ...a }
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = (out[k] || 0) + Number(v || 0)
  }
  return out
}

/** 将附加源等价日表叠进主 daily（按 date 合并）。 */
export function mergeDailyEntries(
  base: DailyEntry[] | null | undefined,
  extras: DailyEntry[] | null | undefined,
): DailyEntry[] | null {
  if (!base && (!extras || extras.length === 0)) return null
  if (!extras || extras.length === 0) return base ? [...base] : null
  if (!base || base.length === 0) {
    return extras.map((d) => ({
      ...d,
      costByPool: { ...emptyPools(), ...d.costByPool },
      tokensByPool: { ...emptyPools(), ...d.tokensByPool },
      costByModel: { ...(d.costByModel || {}) },
      tokensByModel: { ...(d.tokensByModel || {}) },
    }))
  }

  const map = new Map<string, DailyEntry>()
  for (const d of base) {
    map.set(d.date, {
      ...d,
      costByPool: { ...emptyPools(), ...d.costByPool },
      tokensByPool: { ...emptyPools(), ...d.tokensByPool },
      costByModel: { ...(d.costByModel || {}) },
      tokensByModel: { ...(d.tokensByModel || {}) },
    })
  }

  for (const e of extras) {
    const cur = map.get(e.date)
    if (!cur) {
      map.set(e.date, {
        ...e,
        costByPool: { ...emptyPools(), ...e.costByPool },
        tokensByPool: { ...emptyPools(), ...e.tokensByPool },
        costByModel: { ...(e.costByModel || {}) },
        tokensByModel: { ...(e.tokensByModel || {}) },
      })
      continue
    }
    cur.totalTokens += e.totalTokens || 0
    cur.cacheRead += e.cacheRead || 0
    cur.inputCacheWrite += e.inputCacheWrite || 0
    cur.inputNoCache += e.inputNoCache || 0
    cur.outputTokens += e.outputTokens || 0
    cur.cost += e.cost || 0
    cur.rows += e.rows || 0
    cur.costByPool = addPools(cur.costByPool, e.costByPool)
    cur.tokensByPool = addPools(cur.tokensByPool, e.tokensByPool)
    cur.costByModel = addRecord(cur.costByModel, e.costByModel)
    cur.tokensByModel = addRecord(cur.tokensByModel, e.tokensByModel)
  }

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface FoldModelEntry {
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

export function mergeSummaryByModel(
  base: FoldModelEntry[] | undefined,
  extra: FoldModelEntry[] | undefined,
): FoldModelEntry[] {
  const map = new Map<string, FoldModelEntry>()
  for (const m of base || []) {
    map.set(m.model, {
      model: m.model,
      requests: m.requests,
      estimatedUsd: m.estimatedUsd,
      tokens: { ...m.tokens },
    })
  }
  for (const m of extra || []) {
    const cur = map.get(m.model)
    if (!cur) {
      map.set(m.model, {
        model: m.model,
        requests: m.requests,
        estimatedUsd: m.estimatedUsd,
        tokens: { ...m.tokens },
      })
      continue
    }
    cur.requests += m.requests
    cur.estimatedUsd += m.estimatedUsd
    cur.tokens.cacheWrite += m.tokens.cacheWrite
    cur.tokens.noCache += m.tokens.noCache
    cur.tokens.cacheRead += m.tokens.cacheRead
    cur.tokens.output += m.tokens.output
  }
  return [...map.values()].sort((a, b) => b.estimatedUsd - a.estimatedUsd)
}

export interface HourlyDayEntry {
  date: string
  hours: number[]
  /** 每小时估算 USD；旧数据可能缺失 */
  costHours?: number[]
  totalTokens: number
  totalCost?: number
  rows: number
}

function normalizeHourlyDay(d: HourlyDayEntry): HourlyDayEntry {
  const hours = Array.from({ length: 24 }, (_, h) => Number(d.hours?.[h] || 0))
  const costHours = Array.from({ length: 24 }, (_, h) =>
    Number(d.costHours?.[h] || 0),
  )
  return {
    date: d.date,
    hours,
    costHours,
    totalTokens: Number(d.totalTokens) || hours.reduce((s, v) => s + v, 0),
    totalCost:
      Number(d.totalCost) || costHours.reduce((s, v) => s + v, 0),
    rows: Number(d.rows) || 0,
  }
}

/** 将附加源小时桶叠进主 hourly（按 date 合并 hours / costHours）。 */
export function mergeHourlyDays(
  base: HourlyDayEntry[] | null | undefined,
  extras: HourlyDayEntry[] | null | undefined,
): HourlyDayEntry[] | null {
  if (!base && (!extras || extras.length === 0)) return null
  if (!extras || extras.length === 0) {
    return base ? base.map(normalizeHourlyDay) : null
  }
  if (!base || base.length === 0) {
    return extras.map(normalizeHourlyDay)
  }

  const map = new Map<string, HourlyDayEntry>()
  for (const d of base) {
    map.set(d.date, normalizeHourlyDay(d))
  }
  for (const e of extras) {
    const next = normalizeHourlyDay(e)
    const cur = map.get(e.date)
    if (!cur) {
      map.set(e.date, next)
      continue
    }
    for (let h = 0; h < 24; h++) {
      cur.hours[h] += next.hours[h]
      cur.costHours![h] += next.costHours![h]
    }
    cur.totalTokens += next.totalTokens
    cur.totalCost = (cur.totalCost || 0) + (next.totalCost || 0)
    cur.rows += next.rows
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}
