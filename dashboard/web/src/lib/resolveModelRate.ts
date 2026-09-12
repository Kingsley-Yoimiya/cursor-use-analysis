/**
 * 与 scripts/lib/resolve-model-rate.mjs 同步：CSV Model 字符串 → model-rates 档位。
 */
import type ratesConfigType from 'virtual:model-rates'

type RatesConfig = typeof ratesConfigType

const EFFORT_SUFFIXES = new Set([
  'high',
  'medium',
  'low',
  'xhigh',
  'max',
  'ultra',
])
const STRIP_SUFFIXES = new Set([...EFFORT_SUFFIXES, 'thinking', 'preview'])
const ENTERPRISE_SUFFIXES = ['-joybuilder', '-oxygen']

export type RateKind = 'auto' | 'model' | 'unknown'

export type ModelRate = {
  displayName?: string
  billingPool?: string
  inputPerMillion: number
  cacheWritePerMillion: number
  cacheReadPerMillion: number
  outputPerMillion: number
  longContextInputTokensThreshold?: number | null
  longContextMultiplier?: number | null
}

export type ResolvedRate = {
  kind: RateKind
  rate: ModelRate | null
  resolvedKey: string
}

function lookupExact(key: string, ratesConfig: RatesConfig): ResolvedRate | null {
  if (!key) return null

  if (key === 'auto' || ratesConfig.aliases?.[key] === 'auto') {
    return { kind: 'auto', rate: ratesConfig.autoPool, resolvedKey: 'auto' }
  }

  const canonical = ratesConfig.aliases?.[key] || key
  if (canonical === 'auto') {
    return { kind: 'auto', rate: ratesConfig.autoPool, resolvedKey: 'auto' }
  }

  const modelRate = ratesConfig.models?.[canonical]
  if (modelRate) {
    return { kind: 'model', rate: modelRate, resolvedKey: canonical }
  }
  return null
}

function versionSpellings(ver: string): string[] {
  const out = new Set([ver])
  if (ver.includes('.')) out.add(ver.replace(/\./g, '-'))
  if (ver.includes('-')) out.add(ver.replace(/-/g, '.'))
  return [...out]
}

function pushClaudeVariants(key: string, push: (k: string) => void) {
  let m = key.match(/^claude-(sonnet|haiku|opus|fable)-(\d+(?:[.-]\d+)*)$/)
  if (m) {
    const family = m[1]
    const ver = m[2]
    for (const v of versionSpellings(ver)) {
      push(`claude-${family}-${v.replace(/\./g, '-')}`)
      push(`claude-${v}-${family}`)
      if (/^5(?:[.-]0)?$/.test(v)) push(`claude-${family}-5`)
    }
  }

  m = key.match(/^claude-(\d+(?:[.-]\d+)*)-(sonnet|haiku|opus|fable)$/)
  if (m) {
    const ver = m[1]
    const family = m[2]
    for (const v of versionSpellings(ver)) {
      push(`claude-${v}-${family}`)
      push(`claude-${family}-${v.replace(/\./g, '-')}`)
      if (/^5(?:[.-]0)?$/.test(v)) push(`claude-${family}-5`)
    }
  }

  m = key.match(/^(sonnet|haiku|opus|fable)-(\d+(?:[.-]\d+)*)$/)
  if (m) {
    const family = m[1]
    const ver = m[2]
    for (const v of versionSpellings(ver)) {
      push(`claude-${family}-${v.replace(/\./g, '-')}`)
      push(`claude-${v}-${family}`)
      if (/^5(?:[.-]0)?$/.test(v)) push(`claude-${family}-5`)
    }
  }

  m = key.match(/^claude-opus-(\d+(?:[.-]\d+)*)$/)
  if (m) {
    for (const v of versionSpellings(m[1])) {
      push(`claude-opus-${v.replace(/\./g, '-')}`)
      if (/^5(?:[.-]0)?$/.test(v)) push('claude-opus-5')
    }
  }
}

function foldFastEffort(key: string, push: (k: string) => void) {
  const emit = (folded: string) => {
    push(folded)
    for (const prefix of ['cursor-', 'new-']) {
      if (folded.startsWith(prefix)) push(folded.slice(prefix.length))
    }
  }
  let m = key.match(/^(.*)-(high|medium|low|xhigh|max|ultra)-fast$/)
  if (m) emit(`${m[1]}-fast`)
  m = key.match(/^(.*)-fast-(high|medium|low|xhigh|max|ultra)$/)
  if (m) emit(`${m[1]}-fast`)
}

function expandCandidates(key: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (k: string) => {
    if (!k || seen.has(k)) return
    seen.add(k)
    out.push(k)
  }

  push(key)

  for (const prefix of ['cursor-', 'new-']) {
    if (key.startsWith(prefix)) push(key.slice(prefix.length))
  }

  let base = key
  for (const suf of ENTERPRISE_SUFFIXES) {
    if (base.endsWith(suf)) {
      base = base.slice(0, -suf.length)
      push(base)
      break
    }
  }

  pushClaudeVariants(key, push)
  if (base !== key) pushClaudeVariants(base, push)

  foldFastEffort(key, push)
  if (base !== key) foldFastEffort(base, push)
  for (const prefix of ['cursor-', 'new-']) {
    if (key.startsWith(prefix)) foldFastEffort(key.slice(prefix.length), push)
  }

  let cur = key
  while (true) {
    const parts = cur.split('-')
    if (parts.length < 2) break
    const last = parts[parts.length - 1]
    if (!STRIP_SUFFIXES.has(last)) break
    cur = parts.slice(0, -1).join('-')
    push(cur)
    for (const prefix of ['cursor-', 'new-']) {
      if (cur.startsWith(prefix)) push(cur.slice(prefix.length))
    }
    for (const suf of ENTERPRISE_SUFFIXES) {
      if (cur.endsWith(suf)) push(cur.slice(0, -suf.length))
    }
    pushClaudeVariants(cur, push)
    foldFastEffort(cur, push)
  }

  return out
}

export function resolveRateForModel(
  modelRaw: string,
  ratesConfig: RatesConfig | null,
): ResolvedRate {
  if (!ratesConfig) {
    return { kind: 'unknown', rate: null, resolvedKey: '' }
  }

  const key = String(modelRaw || '')
    .trim()
    .toLowerCase()
  if (!key) return { kind: 'unknown', rate: null, resolvedKey: '' }

  for (const candidate of expandCandidates(key)) {
    const hit = lookupExact(candidate, ratesConfig)
    if (hit) return hit
  }

  return { kind: 'unknown', rate: null, resolvedKey: key }
}

export type PoolName = 'Auto' | 'FirstParty' | 'API'

export function classifyPool(
  kind: RateKind,
  resolvedKey: string,
  rate: ModelRate | null,
): PoolName {
  if (kind === 'auto') return 'Auto'
  if (rate?.billingPool === 'firstParty') return 'FirstParty'
  const rk = String(resolvedKey || '')
  if (
    rk.includes('composer') ||
    rk.startsWith('grok-4.5') ||
    rk.startsWith('grok-4.6')
  ) {
    return 'FirstParty'
  }
  return 'API'
}
