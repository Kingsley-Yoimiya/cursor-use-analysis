import { fmtTokens } from './formatTokens'

export interface DailyLike {
  date: string
  totalTokens: number
  cacheRead: number
  inputCacheWrite: number
  inputNoCache: number
  outputTokens: number
  cost: number
  rows: number
  costByPool: { Auto: number; FirstParty: number; API: number }
  tokensByPool: { Auto: number; FirstParty: number; API: number }
  costByModel: Record<string, number>
  tokensByModel: Record<string, number>
}

export function fmtUsdCompact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  }
  return `$${n.toFixed(0)}`
}

export function fmtUsdFull(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

const POOL_LABEL: Record<'Auto' | 'FirstParty' | 'API', string> = {
  Auto: 'Auto',
  FirstParty: 'First-party',
  API: 'API',
}

export function summarizeRange(daily: DailyLike[]) {
  let cost = 0
  let tokens = 0
  let rows = 0
  let cacheRead = 0
  let cacheWrite = 0
  let noCache = 0
  let output = 0
  const pool = { Auto: 0, FirstParty: 0, API: 0 }
  const modelCost: Record<string, number> = {}

  for (const d of daily) {
    cost += d.cost || 0
    tokens += d.totalTokens || 0
    rows += d.rows || 0
    cacheRead += d.cacheRead || 0
    cacheWrite += d.inputCacheWrite || 0
    noCache += d.inputNoCache || 0
    output += d.outputTokens || 0
    pool.Auto += d.costByPool.Auto ?? 0
    pool.FirstParty += d.costByPool.FirstParty ?? 0
    pool.API += d.costByPool.API ?? 0
    for (const [m, c] of Object.entries(d.costByModel)) {
      modelCost[m] = (modelCost[m] ?? 0) + c
    }
  }

  const input = cacheRead + cacheWrite + noCache
  const cacheShare = input > 0 ? cacheRead / input : 0
  const poolEntries = (
    Object.entries(pool) as ['Auto' | 'FirstParty' | 'API', number][]
  ).sort((a, b) => b[1] - a[1])
  const topPool = poolEntries[0]
  const topPoolShare = cost > 0 && topPool ? topPool[1] / cost : 0
  const topModel = Object.entries(modelCost).sort((a, b) => b[1] - a[1])[0]

  return {
    cost,
    tokens,
    rows,
    cacheRead,
    cacheWrite,
    noCache,
    output,
    cacheShare,
    pool,
    topPoolKey: topPool?.[0] ?? null,
    topPoolLabel: topPool ? POOL_LABEL[topPool[0]] : null,
    topPoolShare,
    modelCount: Object.keys(modelCost).length,
    topModel: topModel?.[0] ?? null,
    topModelShare: cost > 0 && topModel ? topModel[1] / cost : 0,
  }
}

export function rangePhrase(
  preset: '7' | '30' | '90' | 'all' | null,
  start: string,
  end: string,
): string {
  if (preset === '7') return '近 7 天'
  if (preset === '30') return '近 30 天'
  if (preset === '90') return '近 90 天'
  if (preset === 'all') return '全部有数据的日子'
  if (start && end) return `${start} 至 ${end}`
  return '这段时间'
}

export function buildHeroThesis(
  phrase: string,
  stats: ReturnType<typeof summarizeRange>,
): string {
  return `${phrase}公开单价等效约 ${fmtUsdCompact(stats.cost)}`
}

export function cacheThesis(stats: ReturnType<typeof summarizeRange>): string {
  const pct = Math.round(stats.cacheShare * 100)
  if (pct >= 80) return `输入侧大约 ${pct}% 是在读缓存`
  if (pct >= 50) return `缓存读掉了输入的一半以上（${pct}%）`
  return `缓存并不占绝对多数，Cache Read 约占输入 ${pct}%`
}

export function poolThesis(stats: ReturnType<typeof summarizeRange>): string {
  if (!stats.topPoolLabel) return '三个池都有花费'
  const pct = Math.round(stats.topPoolShare * 100)
  if (pct >= 50) return `费用主要落在 ${stats.topPoolLabel}（约 ${pct}%）`
  return `费用在 Auto / First-party / API 之间摊开，最高是 ${stats.topPoolLabel}`
}

export function modelThesis(stats: ReturnType<typeof summarizeRange>): string {
  if (!stats.topModel) return '还没有分得清的模型花费'
  const pct = Math.round(stats.topModelShare * 100)
  if (pct >= 40) {
    return `${stats.topModel} 拿走约 ${pct}% 的等效花费`
  }
  return `${stats.modelCount} 个模型里，没有一家独大`
}

export function factLine(stats: ReturnType<typeof summarizeRange>): string {
  const parts = [
    `${stats.rows.toLocaleString('en-US')} 行请求`,
    `${fmtTokens(stats.tokens)} token`,
    stats.modelCount > 0 ? `${stats.modelCount} 个模型` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** 题头一行对照，避免再为缓存/池/模型各开一块空图。 */
export function mastheadClaims(stats: ReturnType<typeof summarizeRange>): string {
  const cachePct = Math.round(stats.cacheShare * 100)
  const poolPct = Math.round(stats.topPoolShare * 100)
  const modelPct = Math.round(stats.topModelShare * 100)
  const parts = [
    `输入 ${cachePct}% 读缓存`,
    stats.topPoolLabel ? `费用 ${stats.topPoolLabel} ${poolPct}%` : null,
    stats.topModel
      ? stats.topModelShare >= 0.4
        ? `最高 ${stats.topModel} ${modelPct}%`
        : `${stats.modelCount} 个模型无一家独大`
      : null,
  ].filter(Boolean)
  return parts.join(' · ')
}
