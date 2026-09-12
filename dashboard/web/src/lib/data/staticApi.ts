/**
 * 静态模式下拦截 /api/*，用 IndexedDB + fixture 兑现与 Express 同形的响应。
 */
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { getDataMode } from './mode'
import { looksLikeUsageCsv, parseCsvText } from './parseCsv'
import {
  aggregateDaily,
  aggregateHourly,
  aggregatePeriodStats,
  BILLING_DEFAULTS,
  buildSummary,
  clampBillingCycleDay,
  exportUsageWithCostCsv,
  mergeDailyMaps,
  mergeHourlyLists,
  parseUsageRows,
  SHANGHAI_TZ,
  todayShanghai,
  type ParsedUsageRow,
} from './usageEngine'
import {
  createEmptyProfile,
  getCsv,
  getReimbursementProfile,
  listProfiles,
  putProfileCsv,
  sanitizeProfileId,
  saveReimbursementProfile,
  type StoredProfile,
} from './store'

const FIXTURE_URL = '/fixtures/usage.sample.csv'
const DEMO_ID = 'demo'

type Json = Record<string, unknown>

let fixtureCache: { text: string; rows: ParsedUsageRow[] } | null = null

async function loadFixture(): Promise<{ text: string; rows: ParsedUsageRow[] }> {
  if (fixtureCache) return fixtureCache
  const r = await fetch(FIXTURE_URL)
  if (!r.ok) throw new Error('找不到演示 CSV（public/fixtures/usage.sample.csv）')
  const text = await r.text()
  const rows = parseUsageRows(text)
  fixtureCache = { text, rows }
  return fixtureCache
}

function jsonResponse(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosResponse {
  return {
    data,
    status,
    statusText: status >= 400 ? 'Error' : 'OK',
    headers: { 'content-type': 'application/json' },
    config,
    request: {},
  }
}

function blobResponse(
  config: InternalAxiosRequestConfig,
  filename: string,
  text: string,
): AxiosResponse {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  return {
    data: blob,
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
    config,
    request: {},
  }
}

function parseBody(config: InternalAxiosRequestConfig): Json {
  const raw = config.data
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object') return raw as Json
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Json
    } catch {
      return {}
    }
  }
  return {}
}

function pathnameOf(config: InternalAxiosRequestConfig): { path: string; search: URLSearchParams } {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://local.invalid'
  const rawUrl = config.url || '/'
  const url = new URL(rawUrl, base)
  if (config.params && typeof config.params === 'object') {
    for (const [k, v] of Object.entries(config.params as Record<string, unknown>)) {
      if (v == null) continue
      url.searchParams.set(k, String(v))
    }
  }
  return { path: url.pathname.replace(/\/+$/, '') || '/', search: url.searchParams }
}

function methodOf(config: InternalAxiosRequestConfig): string {
  return String(config.method || 'get').toUpperCase()
}

async function profilesWithDemo(): Promise<StoredProfile[]> {
  const stored = await listProfiles()
  const mode = getDataMode()
  if (mode !== 'fixture') return stored
  const fixture = await loadFixture()
  const demo: StoredProfile = {
    id: DEMO_ID,
    label: '演示数据',
    fileName: 'usage.sample.csv',
    sizeBytes: new Blob([fixture.text]).size,
    rowCount: fixture.rows.length,
    updatedAt: stored.find((p) => p.id === DEMO_ID)?.updatedAt || new Date().toISOString(),
    source: 'demo',
  }
  if (stored.some((p) => p.id === DEMO_ID)) {
    return stored.map((p) => (p.id === DEMO_ID ? { ...p, ...demo, updatedAt: p.updatedAt } : p))
  }
  return [demo, ...stored]
}

async function rowsForProfile(id: string): Promise<ParsedUsageRow[] | null> {
  if (id === DEMO_ID) {
    const csv = await getCsv(DEMO_ID)
    if (csv && csv.trim()) return parseUsageRows(csv)
    return (await loadFixture()).rows
  }
  const csv = await getCsv(id)
  if (!csv || !csv.trim()) return null
  return parseUsageRows(csv)
}

function splitIds(raw: string | null): string[] {
  if (!raw || !raw.trim()) return ['default']
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function resolveRequested(raw: string | null): Promise<{
  ids: string[]
  missing: string[]
  chunks: { id: string; rows: ParsedUsageRow[] }[]
}> {
  const available = await profilesWithDemo()
  const availableIds = available.map((p) => p.id)
  let ids = splitIds(raw)
  if (ids.length === 1 && ids[0] === 'default' && !availableIds.includes('default')) {
    const imported = available.filter((p) => p.source === 'import' && p.rowCount > 0)
    if (imported.length > 0) ids = [imported[0].id]
    else if (availableIds.includes(DEMO_ID)) ids = [DEMO_ID]
  }
  const chunks: { id: string; rows: ParsedUsageRow[] }[] = []
  const missing: string[] = []
  for (const id of ids) {
    const rows = await rowsForProfile(id)
    if (!rows || rows.length === 0) {
      missing.push(id)
      continue
    }
    chunks.push({ id, rows })
  }
  return { ids, missing, chunks }
}

function toApiProfile(p: StoredProfile) {
  const hasData = p.rowCount > 0
  return {
    id: p.id,
    label: p.label,
    displayName: p.label,
    email: null,
    name: null,
    hasData,
    files: {
      authJson: { exists: false },
      usageCsv: {
        exists: hasData,
        mtimeIso: p.updatedAt,
        sizeBytes: p.sizeBytes,
      },
      estimateJson: { exists: hasData, mtimeIso: p.updatedAt },
    },
    session: null,
    lastSync: hasData ? { ok: true, updatedAt: p.updatedAt, lastSuccessAt: p.updatedAt } : null,
    loginHint: null,
    identitySource: p.source === 'demo' ? 'fixture' : 'indexeddb',
  }
}

async function handle(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const { path, search } = pathnameOf(config)
  const method = methodOf(config)
  const t0 = Date.now()
  const mode = getDataMode()

  if (method === 'GET' && path === '/api/health') {
    return jsonResponse(config, 200, {
      ok: true,
      mode,
      features: [
        'summary',
        'daily',
        'hourly',
        'period-stats',
        'reimbursement-profile',
        'export-usage-with-cost-csv',
        'data-status',
        'reload',
        'profiles',
        'csv-import',
      ],
      plugins: [],
    })
  }

  if (method === 'GET' && path === '/api/profiles') {
    const list = await profilesWithDemo()
    const profiles = list.map(toApiProfile)
    const activeForSync =
      list.find((p) => p.source === 'import' && p.rowCount > 0)?.id ||
      list.find((p) => p.rowCount > 0)?.id ||
      profiles[0]?.id ||
      DEMO_ID
    return jsonResponse(config, 200, {
      ok: true,
      profiles,
      activeForSync,
      ms: Date.now() - t0,
    })
  }

  if (method === 'POST' && path === '/api/profiles') {
    const body = parseBody(config)
    const id = sanitizeProfileId(String(body.id || ''))
    if (!id) {
      return jsonResponse(config, 400, { ok: false, error: '请填写身份 id' })
    }
    try {
      const csvText = typeof body.csvText === 'string' ? body.csvText : ''
      if (csvText.trim()) {
        if (!looksLikeUsageCsv(parseCsvText(csvText))) {
          return jsonResponse(config, 400, {
            ok: false,
            error: '不是 Cursor 用量 CSV（需要 Date / Model 列）',
          })
        }
        const rows = parseUsageRows(csvText)
        const profile = await putProfileCsv({
          id,
          label: String(body.label || id),
          fileName: String(body.fileName || `${id}.csv`),
          csvText,
          rowCount: rows.length,
          source: 'import',
        })
        return jsonResponse(config, 200, { ok: true, profile: toApiProfile(profile) })
      }
      const profile = await createEmptyProfile(id, String(body.label || id))
      return jsonResponse(config, 200, { ok: true, profile: toApiProfile(profile) })
    } catch (e) {
      return jsonResponse(config, 400, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const importMatch = path.match(/^\/api\/profiles\/([^/]+)\/import$/)
  if (method === 'POST' && importMatch) {
    const id = decodeURIComponent(importMatch[1])
    const body = parseBody(config)
    const csvText = String(body.csvText || '')
    if (!csvText.trim() || !looksLikeUsageCsv(parseCsvText(csvText))) {
      return jsonResponse(config, 400, {
        ok: false,
        error: '请选择 Cursor 控制台导出的用量 CSV（strategy=tokens）',
      })
    }
    const rows = parseUsageRows(csvText)
    const existing = (await listProfiles()).find((p) => p.id === id)
    const profile = await putProfileCsv({
      id,
      label: String(body.label || existing?.label || id),
      fileName: String(body.fileName || `${id}.csv`),
      csvText,
      rowCount: rows.length,
      source: 'import',
    })
    return jsonResponse(config, 200, {
      ok: true,
      profile: toApiProfile(profile),
      rows: rows.length,
      ms: Date.now() - t0,
    })
  }

  if (method === 'POST' && (path === '/api/sync' || path === '/api/refresh')) {
    return jsonResponse(config, 400, {
      ok: false,
      error: 'static-mode',
      hint: '静态部署不能代登录 Cursor。请在 cursor.com 导出 CSV 后点「导入」。',
    })
  }

  if (method === 'POST' && path === '/api/reload') {
    fixtureCache = null
    return jsonResponse(config, 200, await dataStatus('default'))
  }

  if (method === 'GET' && path === '/api/data-status') {
    const profileId = search.get('profile') || 'default'
    return jsonResponse(config, 200, await dataStatus(profileId))
  }

  if (method === 'GET' && path === '/api/daily') {
    const resolved = await resolveRequested(search.get('profiles'))
    if (resolved.chunks.length === 0) {
      return jsonResponse(config, 404, {
        ok: false,
        error: '还没有用量 CSV。请导入 cursor.com 导出的文件，或打开 ?demo=1 查看演示。',
        missing: resolved.missing,
      })
    }
    const daily = mergeDailyMaps(resolved.chunks.map((c) => aggregateDaily(c.rows)))
    return jsonResponse(config, 200, {
      ok: true,
      daily,
      profiles: resolved.chunks.map((c) => c.id),
      missing: resolved.missing,
      ms: Date.now() - t0,
    })
  }

  if (method === 'GET' && path === '/api/hourly') {
    const resolved = await resolveRequested(search.get('profiles'))
    if (resolved.chunks.length === 0) {
      return jsonResponse(config, 404, {
        ok: false,
        error: '还没有用量 CSV',
        missing: resolved.missing,
      })
    }
    let daysLimit = Number(search.get('days'))
    if (!Number.isFinite(daysLimit) || daysLimit <= 0) daysLimit = 90
    daysLimit = Math.min(180, Math.round(daysLimit))
    const startQ = search.get('start')
    const endQ = search.get('end')
    let days = mergeHourlyLists(resolved.chunks.map((c) => aggregateHourly(c.rows)))
    if (startQ || endQ) {
      days = days.filter((d) => {
        if (startQ && d.date < startQ) return false
        if (endQ && d.date > endQ) return false
        return true
      })
    } else if (days.length > daysLimit) {
      days = days.slice(-daysLimit)
    }
    const csvMtimeIso = (await profilesWithDemo()).find(
      (p) => p.id === resolved.chunks[0]?.id,
    )?.updatedAt
    return jsonResponse(config, 200, {
      ok: true,
      timezone: SHANGHAI_TZ,
      today: todayShanghai(),
      days,
      profiles: resolved.chunks.map((c) => c.id),
      missing: resolved.missing,
      meta: {
        generatedAt: new Date().toISOString(),
        csvMtimeIso,
        daysLimit: startQ || endQ ? null : daysLimit,
        start: startQ,
        end: endQ,
      },
      ms: Date.now() - t0,
    })
  }

  if (method === 'GET' && path === '/api/period-stats') {
    const resolved = await resolveRequested(search.get('profiles'))
    if (resolved.chunks.length === 0) {
      return jsonResponse(config, 404, {
        ok: false,
        error: '还没有用量 CSV',
      })
    }
    const allRows = resolved.chunks.flatMap((c) => c.rows)
    const stats = aggregatePeriodStats(allRows, Number(search.get('billingCycleDay')))
    return jsonResponse(config, 200, {
      ok: true,
      ...stats,
      profiles: resolved.chunks.map((c) => c.id),
      ms: Date.now() - t0,
    })
  }

  if (method === 'GET' && path === '/api/summary') {
    const resolved = await resolveRequested(search.get('profiles'))
    if (resolved.chunks.length === 0) {
      return jsonResponse(config, 404, {
        ok: false,
        error: '还没有用量数据',
      })
    }
    const data = buildSummary(resolved.chunks.flatMap((c) => c.rows))
    return jsonResponse(config, 200, {
      ok: true,
      data,
      profiles: resolved.chunks.map((c) => c.id),
      missing: resolved.missing,
      ms: Date.now() - t0,
    })
  }

  if (method === 'GET' && path === '/api/reimbursement-profile') {
    const profile = await getReimbursementProfile()
    return jsonResponse(config, 200, {
      ok: true,
      profile,
      defaultBillingCycleDay: BILLING_DEFAULTS.defaultBillingCycleDay,
      billingCycleDayRange: {
        min: BILLING_DEFAULTS.billingCycleDayMin,
        max: BILLING_DEFAULTS.billingCycleDayMax,
      },
      generatedAt: new Date().toISOString(),
      disclaimer:
        '以下金额为按公开 API 单价估算的等效价值（estimatedUsd），不等同于 Cursor 实际发票金额，仅供内部报销参考。',
    })
  }

  if (method === 'PUT' && path === '/api/reimbursement-profile') {
    const body = parseBody(config)
    const profile = await saveReimbursementProfile({
      employeeName: String(body.employeeName ?? ''),
      employeeEmail: String(body.employeeEmail ?? ''),
      department: String(body.department ?? ''),
      purpose: String(body.purpose ?? ''),
      currency: String(body.currency ?? 'USD'),
    })
    return jsonResponse(config, 200, { ok: true, profile })
  }

  if (method === 'GET' && path === '/api/export/usage-with-cost.csv') {
    const resolved = await resolveRequested('default')
    const rows = resolved.chunks[0]?.rows
    if (!rows) {
      return jsonResponse(config, 404, { ok: false, error: '还没有用量 CSV' })
    }
    const { filename, text } = exportUsageWithCostCsv(rows, {
      billingCycleDay: clampBillingCycleDay(search.get('billingCycleDay')),
      periodKey: search.get('periodKey'),
    })
    return blobResponse(config, filename, text)
  }

  if (path.startsWith('/api/plugins')) {
    return jsonResponse(config, 404, { ok: false, error: '静态模式不加载本机插件' })
  }

  return jsonResponse(config, 404, { ok: false, error: `静态模式未实现 ${method} ${path}` })
}

async function dataStatus(profileId: string) {
  const list = await profilesWithDemo()
  const p =
    list.find((x) => pMatch(x.id, profileId)) ||
    list.find((x) => x.source === 'import' && x.rowCount > 0) ||
    list[0]
  const has = Boolean(p && p.rowCount > 0)
  return {
    ok: true,
    files: {
      usageCsv: {
        exists: has,
        mtimeIso: p?.updatedAt,
        sizeBytes: p?.sizeBytes,
      },
      estimateJson: { exists: has, mtimeIso: p?.updatedAt },
      authJson: { exists: false },
    },
    session: null,
    proxyConfigured: false,
    lastSync: has
      ? { ok: true, updatedAt: p?.updatedAt, hint: p?.source === 'demo' ? '演示数据' : '浏览器导入' }
      : null,
  }
}

function pMatch(id: string, want: string) {
  if (id === want) return true
  if (want === 'default' && id === DEMO_ID) return true
  return false
}

export const staticAxiosAdapter: AxiosAdapter = async (config) => {
  try {
    return await handle(config)
  } catch (e) {
    return jsonResponse(config, 500, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
