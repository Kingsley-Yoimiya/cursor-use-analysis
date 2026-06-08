import express from 'express';
import cors from 'cors';
import fs, { createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import {
  ensureProxyEnv,
  getDataStatus,
  syncFromCursor,
} from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ESTIMATE_JSON = path.join(REPO_ROOT, 'reports', 'estimate.json');
const USAGE_CSV = path.join(REPO_ROOT, 'exports', 'usage.csv');
const MODEL_RATES_PATH = path.join(REPO_ROOT, 'config', 'model-rates.json');
const DASHBOARD_SETTINGS_PATH = path.join(
  REPO_ROOT,
  'config',
  'dashboard-settings.json',
);

const PORT = Number(process.env.PORT) || 3001;
const bootT0 = Date.now();

if (ensureProxyEnv()) {
  console.log(
    `[boot] 已配置出站代理: ${process.env.HTTPS_PROXY || process.env.PLAYWRIGHT_PROXY}`,
  );
}

// ──────────── 加载费率配置 ────────────

let ratesConfig = null;
function reloadRatesConfig() {
  try {
    const raw = fs.readFileSync(MODEL_RATES_PATH, 'utf8');
    ratesConfig = JSON.parse(raw);
    console.log(
      `[rates] 已加载 model-rates.json，模型数量: ${Object.keys(ratesConfig.models).length}`,
    );
  } catch (e) {
    console.warn(`[boot] 警告：无法加载 model-rates.json: ${e?.message}`);
  }
}

reloadRatesConfig();

let dashboardSettings = { defaultBillingCycleDay: 23 };
try {
  const raw = fs.readFileSync(DASHBOARD_SETTINGS_PATH, 'utf8');
  dashboardSettings = JSON.parse(raw);
  console.log(
    `[boot] 已加载 dashboard-settings.json，默认账单日: ${dashboardSettings.defaultBillingCycleDay}`,
  );
} catch (e) {
  console.warn(`[boot] 警告：无法加载 dashboard-settings.json: ${e?.message}`);
}

// ──────────── 费率查找逻辑（参照 estimate-cost.mjs）────────────

function resolveRateForModel(modelRaw) {
  if (!ratesConfig) return { kind: 'unknown', rate: null, resolvedKey: '' };
  const key = String(modelRaw || '')
    .trim()
    .toLowerCase();
  if (!key) return { kind: 'unknown', rate: null, resolvedKey: '' };

  if (key === 'auto' || ratesConfig.aliases[key] === 'auto') {
    return { kind: 'auto', rate: ratesConfig.autoPool, resolvedKey: 'auto' };
  }

  const canonical = ratesConfig.aliases[key] || key;
  if (canonical === 'auto') {
    return { kind: 'auto', rate: ratesConfig.autoPool, resolvedKey: 'auto' };
  }

  const modelRate = ratesConfig.models[canonical];
  if (modelRate) {
    return { kind: 'model', rate: modelRate, resolvedKey: canonical };
  }
  return { kind: 'unknown', rate: null, resolvedKey: key };
}

/**
 * @param {{ cacheWrite:number, noCache:number, cacheRead:number, output:number }} t
 * @param {object} rate
 */
function estimateTokensUsd(t, rate) {
  const inputTokensTotal = t.cacheWrite + t.noCache + t.cacheRead;
  let inputMult = 1;
  if (
    rate.longContextInputTokensThreshold != null &&
    inputTokensTotal > rate.longContextInputTokensThreshold
  ) {
    inputMult = rate.longContextMultiplier ?? 1;
  }
  const inputUsd =
    ((t.cacheWrite / 1e6) * rate.cacheWritePerMillion +
      (t.noCache / 1e6) * rate.inputPerMillion +
      (t.cacheRead / 1e6) * rate.cacheReadPerMillion) *
    inputMult;
  const outputUsd = (t.output / 1e6) * rate.outputPerMillion;
  return inputUsd + outputUsd;
}

/**
 * 根据解析结果判断池类型：Auto / Composer / API
 * @returns {'Auto'|'Composer'|'API'}
 */
function classifyPool(kind, resolvedKey) {
  if (kind === 'auto') return 'Auto';
  if (resolvedKey.includes('composer')) return 'Composer';
  return 'API';
}

function isFastModel(resolvedKey, modelRaw) {
  const key = String(resolvedKey || '').toLowerCase();
  if (key.includes('-fast')) return true;
  const raw = String(modelRaw || '').toLowerCase();
  return raw.includes('fast');
}

function createEmptyPeriodAgg(key, label, startDate, endDate) {
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
    costByPool: { Auto: 0, Composer: 0, API: 0 },
    tokensByPool: { Auto: 0, Composer: 0, API: 0 },
    /** @type {Map<string, { model: string, requests: number, tokens: number, cost: number }>} */
    byModel: new Map(),
  };
}

function addRowToPeriodAgg(agg, row) {
  agg.totalTokens += row.rowTokens;
  agg.totalCost += row.estimatedUsd;
  agg.totalRows += 1;
  if (row.isFast) {
    agg.fastTokens += row.rowTokens;
    agg.fastRows += 1;
  }
  agg.costByPool[row.pool] += row.estimatedUsd;
  agg.tokensByPool[row.pool] += row.rowTokens;

  const modelKey = row.modelKey;
  let modelAgg = agg.byModel.get(modelKey);
  if (!modelAgg) {
    modelAgg = {
      model: modelKey,
      requests: 0,
      tokens: 0,
      cost: 0,
    };
    agg.byModel.set(modelKey, modelAgg);
  }
  modelAgg.requests += 1;
  modelAgg.tokens += row.rowTokens;
  modelAgg.cost += row.estimatedUsd;
}

function calendarMonthKey(day) {
  return day.slice(0, 7);
}

function calendarMonthLabel(key) {
  const [y, m] = key.split('-');
  return `${y}年${Number(m)}月`;
}

function calendarMonthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    startDate: `${key}-01`,
    endDate: `${key}-${String(lastDay).padStart(2, '0')}`,
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 本地日历 YYYY-MM-DD，避免 toISOString() 在 UTC+8 下少 1～2 天 */
function formatLocalDate(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function addCalendarMonths(y, m, delta) {
  let nm = m + delta;
  let ny = y;
  while (nm > 12) {
    nm -= 12;
    ny += 1;
  }
  while (nm < 1) {
    nm += 12;
    ny -= 1;
  }
  return { y: ny, m: nm };
}

function billingCycleKeyFromDay(day, cycleDay) {
  const [y, m, d] = day.split('-').map(Number);
  if (d >= cycleDay) {
    return `${y}-${pad2(m)}-${pad2(cycleDay)}`;
  }
  let year = y;
  let month = m - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${pad2(month)}-${pad2(cycleDay)}`;
}

/**
 * 账单周期：从本月刷新日 00:00 至次月同日刷新前一刻。
 * - startDate / endDate：展示用，endDate 为「下次刷新日」（如 5.23 ~ 6.23）
 * - dataEndDate：该周期最后一条用量记录的日历日（次月刷新日的前一天）
 */
function billingCycleRange(cycleKey) {
  const [y, m, d] = cycleKey.split('-').map(Number);
  const startDate = formatLocalDate(y, m, d);
  const next = addCalendarMonths(y, m, 1);
  const endDate = formatLocalDate(next.y, next.m, d);
  const last = new Date(next.y, next.m - 1, d);
  last.setDate(last.getDate() - 1);
  const dataEndDate = formatLocalDate(
    last.getFullYear(),
    last.getMonth() + 1,
    last.getDate(),
  );
  return { startDate, endDate, dataEndDate };
}

function billingCycleLabel(cycleKey) {
  const { startDate, endDate } = billingCycleRange(cycleKey);
  return `${startDate} ~ ${endDate}`;
}

function pctChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

const POOLS = ['Auto', 'Composer', 'API'];

function poolShares(costByPool, tokensByPool, totalCost, totalTokens) {
  /** @type {Record<string, number>} */
  const costShare = {};
  /** @type {Record<string, number>} */
  const tokenShare = {};
  for (const pool of POOLS) {
    costShare[pool] = totalCost > 0 ? costByPool[pool] / totalCost : 0;
    tokenShare[pool] = totalTokens > 0 ? tokensByPool[pool] / totalTokens : 0;
  }
  return { costShare, tokenShare };
}

function poolChangesFromPrev(cur, prev) {
  /** @type {Record<string, { costPct: number|null, tokensPct: number|null, costShareDelta: number, tokenShareDelta: number }>} */
  const out = {};
  for (const pool of POOLS) {
    out[pool] = {
      costPct: pctChange(cur.costByPool[pool], prev.costByPool[pool]),
      tokensPct: pctChange(cur.tokensByPool[pool], prev.tokensByPool[pool]),
      costShareDelta: cur.costShareByPool[pool] - prev.costShareByPool[pool],
      tokenShareDelta: cur.tokenShareByPool[pool] - prev.tokenShareByPool[pool],
    };
  }
  return out;
}

function finalizePeriodList(periodMap, kind, billingCycleDay) {
  const sortedKeys = [...periodMap.keys()].sort();
  const finalized = sortedKeys.map((key) => {
    const agg = periodMap.get(key);
    const range =
      kind === 'calendar'
        ? calendarMonthRange(key)
        : billingCycleRange(key);
    const label =
      kind === 'calendar' ? calendarMonthLabel(key) : billingCycleLabel(key);

    const models = [...agg.byModel.values()].sort((a, b) => b.cost - a.cost);
    const totalModelRequests = models.reduce((s, m) => s + m.requests, 0);
    const { costShare, tokenShare } = poolShares(
      agg.costByPool,
      agg.tokensByPool,
      agg.totalCost,
      agg.totalTokens,
    );

    return {
      key,
      label,
      startDate: range.startDate,
      endDate: range.endDate,
      dataEndDate: range.dataEndDate ?? range.endDate,
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
    };
  });

  for (let i = 0; i < finalized.length; i++) {
    const cur = finalized[i];
    const prev = i > 0 ? finalized[i - 1] : null;
    cur.changes = prev
      ? {
          costPct: pctChange(cur.totalCost, prev.totalCost),
          tokensPct: pctChange(cur.totalTokens, prev.totalTokens),
          rowsPct: pctChange(cur.totalRows, prev.totalRows),
          fastRatioDelta: cur.fastRatio - prev.fastRatio,
          poolChanges: poolChangesFromPrev(cur, prev),
        }
      : null;
  }

  return {
    kind,
    billingCycleDay: kind === 'billing' ? billingCycleDay : null,
    periods: finalized,
  };
}

const CSV_COL = {
  date: 'Date',
  model: 'Model',
  inCacheWrite: 'Input (w/ Cache Write)',
  inNoCache: 'Input (w/o Cache Write)',
  cacheRead: 'Cache Read',
  output: 'Output Tokens',
  total: 'Total Tokens',
};

/**
 * @param {Record<string,string>} row
 */
function processUsageRow(row) {
  const day = dayKeyFromDateCell(row[CSV_COL.date]);
  if (!day) return null;

  const cacheRead = parseIntField(row[CSV_COL.cacheRead]);
  const inputCacheWrite = parseIntField(row[CSV_COL.inCacheWrite]);
  const inputNoCache = parseIntField(row[CSV_COL.inNoCache]);
  const outputTokens = parseIntField(row[CSV_COL.output]);
  const totalTokens =
    parseIntField(row[CSV_COL.total]) ||
    cacheRead + inputCacheWrite + inputNoCache + outputTokens;

  const modelRaw = row[CSV_COL.model] ?? '';
  const { kind, rate, resolvedKey } = resolveRateForModel(modelRaw);
  let estimatedUsd = 0;
  if (rate) {
    estimatedUsd = estimateTokensUsd(
      {
        cacheWrite: inputCacheWrite,
        noCache: inputNoCache,
        cacheRead,
        output: outputTokens,
      },
      rate,
    );
  }

  const pool = classifyPool(kind, resolvedKey);
  const rowTokens =
    cacheRead + inputCacheWrite + inputNoCache + outputTokens;
  const modelKey =
    resolvedKey || String(modelRaw || 'unknown').trim() || 'unknown';

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
  };
}

// ──────────── 工具函数 ────────────

function parseIntField(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = Number.parseInt(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function dayKeyFromDateCell(dateStr) {
  if (!dateStr) return null;
  const iso = String(dateStr).trim();
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

const EXPORT_EXTRA_HEADERS = [
  'Day',
  'Estimated USD',
  'Pool',
  'Resolved Model',
  'Billing Cycle',
];

function escapeCsvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatUsdForCsv(n) {
  return (Math.round(Number(n) * 1e6) / 1e6).toFixed(6);
}

// ──────────── Express ────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/summary', async (_req, res) => {
  const t0 = Date.now();
  try {
    if (!fs.existsSync(ESTIMATE_JSON)) {
      return res.status(404).json({
        ok: false,
        error: '找不到 estimate.json',
        path: ESTIMATE_JSON,
      });
    }
    const raw = await fs.promises.readFile(ESTIMATE_JSON, 'utf8');
    const data = JSON.parse(raw);
    const ms = Date.now() - t0;
    console.log(
      `[api/summary] 200 ok rows=${data?.totals?.rows ?? '?'} ${ms}ms`,
    );
    return res.json({ ok: true, data, ms });
  } catch (e) {
    const ms = Date.now() - t0;
    console.error(`[api/summary] 500 ${e?.message} ${ms}ms`);
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      path: ESTIMATE_JSON,
      ms,
    });
  }
});

app.get('/api/daily', async (_req, res) => {
  const t0 = Date.now();
  if (!fs.existsSync(USAGE_CSV)) {
    return res.status(404).json({
      ok: false,
      error: '找不到 usage CSV',
      path: USAGE_CSV,
    });
  }

  /**
   * @type {Map<string, {
   *   date: string
   *   totalTokens: number
   *   cacheRead: number
   *   inputCacheWrite: number
   *   inputNoCache: number
   *   outputTokens: number
   *   cost: number
   *   costByPool: { Auto: number; Composer: number; API: number }
   *   tokensByPool: { Auto: number; Composer: number; API: number }
   *   costByModel: Record<string, number>
   *   tokensByModel: Record<string, number>
   *   rows: number
   * }>}
   */
  const byDay = new Map();

  try {
    await new Promise((resolve, reject) => {
      const stream = createReadStream(USAGE_CSV, { encoding: 'utf8' });
      stream.on('error', reject);
      stream
        .pipe(csv())
        .on('data', (row) => {
          const parsed = processUsageRow(row);
          if (!parsed) return;

          const {
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
          } = parsed;

          let agg = byDay.get(day);
          if (!agg) {
            agg = {
              date: day,
              totalTokens: 0,
              cacheRead: 0,
              inputCacheWrite: 0,
              inputNoCache: 0,
              outputTokens: 0,
              cost: 0,
              costByPool: { Auto: 0, Composer: 0, API: 0 },
              tokensByPool: { Auto: 0, Composer: 0, API: 0 },
              costByModel: {},
              tokensByModel: {},
              rows: 0,
            };
            byDay.set(day, agg);
          }
          agg.totalTokens += totalTokens;
          agg.cacheRead += cacheRead;
          agg.inputCacheWrite += inputCacheWrite;
          agg.inputNoCache += inputNoCache;
          agg.outputTokens += outputTokens;
          agg.cost += estimatedUsd;
          agg.costByPool[pool] += estimatedUsd;
          agg.tokensByPool[pool] += rowTokens;
          agg.costByModel[modelKey] = (agg.costByModel[modelKey] ?? 0) + estimatedUsd;
          agg.tokensByModel[modelKey] =
            (agg.tokensByModel[modelKey] ?? 0) + rowTokens;
          agg.rows += 1;
        })
        .on('end', resolve)
        .on('error', reject);
    });
  } catch (e) {
    const ms = Date.now() - t0;
    console.error(`[api/daily] 流处理失败 ${e?.message} ${ms}ms`);
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      path: USAGE_CSV,
      ms,
    });
  }

  const daily = [...byDay.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const ms = Date.now() - t0;
  console.log(
    `[api/daily] 200 ok days=${daily.length} rowsTotal=${daily.reduce((s, d) => s + d.rows, 0)} ${ms}ms`,
  );
  return res.json({ ok: true, daily, ms });
});

app.get('/api/period-stats', async (req, res) => {
  const t0 = Date.now();
  if (!fs.existsSync(USAGE_CSV)) {
    return res.status(404).json({
      ok: false,
      error: '找不到 usage CSV',
      path: USAGE_CSV,
    });
  }

  const minDay = dashboardSettings.billingCycleDayMin ?? 1;
  const maxDay = dashboardSettings.billingCycleDayMax ?? 28;
  let billingCycleDay = Number(req.query.billingCycleDay);
  if (!Number.isFinite(billingCycleDay)) {
    billingCycleDay = dashboardSettings.defaultBillingCycleDay ?? 23;
  }
  billingCycleDay = Math.min(maxDay, Math.max(minDay, Math.round(billingCycleDay)));

  /** @type {Map<string, ReturnType<typeof createEmptyPeriodAgg>>} */
  const calendarMap = new Map();
  /** @type {Map<string, ReturnType<typeof createEmptyPeriodAgg>>} */
  const billingMap = new Map();

  try {
    await new Promise((resolve, reject) => {
      const stream = createReadStream(USAGE_CSV, { encoding: 'utf8' });
      stream.on('error', reject);
      stream
        .pipe(csv())
        .on('data', (row) => {
          const parsed = processUsageRow(row);
          if (!parsed) return;

          const calKey = calendarMonthKey(parsed.day);
          if (!calendarMap.has(calKey)) {
            const range = calendarMonthRange(calKey);
            calendarMap.set(
              calKey,
              createEmptyPeriodAgg(
                calKey,
                calendarMonthLabel(calKey),
                range.startDate,
                range.endDate,
              ),
            );
          }
          addRowToPeriodAgg(calendarMap.get(calKey), parsed);

          const billKey = billingCycleKeyFromDay(parsed.day, billingCycleDay);
          if (!billingMap.has(billKey)) {
            const range = billingCycleRange(billKey);
            billingMap.set(
              billKey,
              createEmptyPeriodAgg(
                billKey,
                billingCycleLabel(billKey),
                range.startDate,
                range.endDate,
              ),
            );
          }
          addRowToPeriodAgg(billingMap.get(billKey), parsed);
        })
        .on('end', resolve)
        .on('error', reject);
    });
  } catch (e) {
    const ms = Date.now() - t0;
    console.error(`[api/period-stats] 流处理失败 ${e?.message} ${ms}ms`);
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      path: USAGE_CSV,
      ms,
    });
  }

  const calendarMonths = finalizePeriodList(calendarMap, 'calendar', billingCycleDay);
  const billingCycles = finalizePeriodList(billingMap, 'billing', billingCycleDay);
  const ms = Date.now() - t0;
  console.log(
    `[api/period-stats] 200 ok calendar=${calendarMonths.periods.length} billing=${billingCycles.periods.length} day=${billingCycleDay} ${ms}ms`,
  );

  return res.json({
    ok: true,
    billingCycleDay,
    defaultBillingCycleDay: dashboardSettings.defaultBillingCycleDay ?? 23,
    billingCycleDayRange: { min: minDay, max: maxDay },
    calendarMonths,
    billingCycles,
    ms,
  });
});

function defaultReimbursementProfile() {
  return (
    dashboardSettings.reimbursementProfile ?? {
      employeeName: '',
      employeeEmail: '',
      department: '',
      purpose: 'Cursor AI 开发工具订阅用量',
      currency: 'USD',
    }
  );
}

function saveDashboardSettings() {
  fs.writeFileSync(
    DASHBOARD_SETTINGS_PATH,
    `${JSON.stringify(dashboardSettings, null, 2)}\n`,
    'utf8',
  );
}

app.get('/api/reimbursement-profile', (_req, res) => {
  let generatedAt = null;
  try {
    if (fs.existsSync(ESTIMATE_JSON)) {
      const est = JSON.parse(fs.readFileSync(ESTIMATE_JSON, 'utf8'));
      generatedAt = est.generatedAt ?? null;
    }
  } catch {
    /* ignore */
  }
  return res.json({
    ok: true,
    profile: defaultReimbursementProfile(),
    defaultBillingCycleDay: dashboardSettings.defaultBillingCycleDay ?? 23,
    billingCycleDayRange: {
      min: dashboardSettings.billingCycleDayMin ?? 1,
      max: dashboardSettings.billingCycleDayMax ?? 28,
    },
    generatedAt,
    disclaimer:
      '以下金额为按公开 API 单价估算的等效价值（estimatedUsd），不等同于 Cursor 实际发票金额，仅供内部报销参考。',
  });
});

app.get('/api/export/usage-with-cost.csv', async (req, res) => {
  const t0 = Date.now();
  if (!fs.existsSync(USAGE_CSV)) {
    return res.status(404).json({
      ok: false,
      error: '找不到 usage CSV',
      path: USAGE_CSV,
    });
  }

  const minDay = dashboardSettings.billingCycleDayMin ?? 1;
  const maxDay = dashboardSettings.billingCycleDayMax ?? 28;
  let billingCycleDay = Number(req.query.billingCycleDay);
  if (!Number.isFinite(billingCycleDay)) {
    billingCycleDay = dashboardSettings.defaultBillingCycleDay ?? 23;
  }
  billingCycleDay = Math.min(maxDay, Math.max(minDay, Math.round(billingCycleDay)));

  const periodKey = req.query.periodKey
    ? String(req.query.periodKey).trim()
    : null;
  const startDate = req.query.startDate
    ? String(req.query.startDate).trim()
    : null;
  const endDate = req.query.endDate ? String(req.query.endDate).trim() : null;

  /** @type {string[] | null} */
  let headerKeys = null;
  const bodyLines = [];

  try {
    await new Promise((resolve, reject) => {
      const stream = createReadStream(USAGE_CSV, { encoding: 'utf8' });
      stream.on('error', reject);
      stream
        .pipe(csv())
        .on('data', (row) => {
          if (!headerKeys) headerKeys = Object.keys(row);
          const parsed = processUsageRow(row);
          if (!parsed) return;

          const cycleKey = billingCycleKeyFromDay(parsed.day, billingCycleDay);
          if (periodKey && cycleKey !== periodKey) return;
          if (startDate && parsed.day < startDate) return;
          if (endDate && parsed.day > endDate) return;

          const cycleLabel = billingCycleLabel(cycleKey);
          const origCells = headerKeys.map((h) => escapeCsvCell(row[h]));
          const extraCells = [
            parsed.day,
            formatUsdForCsv(parsed.estimatedUsd),
            parsed.pool,
            parsed.modelKey,
            cycleLabel,
          ].map(escapeCsvCell);
          bodyLines.push([...origCells, ...extraCells].join(','));
        })
        .on('end', resolve)
        .on('error', reject);
    });
  } catch (e) {
    const ms = Date.now() - t0;
    console.error(`[api/export/usage-with-cost.csv] 失败 ${e?.message} ${ms}ms`);
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      ms,
    });
  }

  if (!headerKeys || headerKeys.length === 0) {
    return res.status(500).json({ ok: false, error: 'CSV 表头为空' });
  }

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let filename = `cursor-usage-with-cost-${stamp}.csv`;
  if (periodKey) {
    filename = `cursor-usage-with-cost-${periodKey}.csv`;
  }

  const headerLine = [...headerKeys, ...EXPORT_EXTRA_HEADERS]
    .map(escapeCsvCell)
    .join(',');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}"`,
  );
  res.write('\uFEFF');
  res.write(`${headerLine}\n`);
  for (const line of bodyLines) {
    res.write(`${line}\n`);
  }
  res.end();

  const ms = Date.now() - t0;
  console.log(
    `[api/export/usage-with-cost.csv] 200 rows=${bodyLines.length} period=${periodKey ?? 'all'} ${ms}ms`,
  );
});

app.put('/api/reimbursement-profile', (req, res) => {
  const body = req.body ?? {};
  const prev = defaultReimbursementProfile();
  dashboardSettings.reimbursementProfile = {
    employeeName: String(body.employeeName ?? prev.employeeName ?? '').trim(),
    employeeEmail: String(body.employeeEmail ?? prev.employeeEmail ?? '').trim(),
    department: String(body.department ?? prev.department ?? '').trim(),
    purpose: String(body.purpose ?? prev.purpose ?? '').trim(),
    currency: String(body.currency ?? prev.currency ?? 'USD').trim() || 'USD',
  };
  try {
    saveDashboardSettings();
    console.log(
      `[api/reimbursement-profile] 已保存 employee=${dashboardSettings.reimbursementProfile.employeeName || '(空)'}`,
    );
    return res.json({ ok: true, profile: dashboardSettings.reimbursementProfile });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    repoRoot: REPO_ROOT,
    features: [
      'summary',
      'daily',
      'period-stats',
      'reimbursement-profile',
      'export-usage-with-cost-csv',
      'data-status',
      'reload',
      'sync',
      'refresh',
    ],
  });
});

function dataStatusPayload() {
  return getDataStatus(REPO_ROOT, {
    usageCsv: USAGE_CSV,
    estimateJson: ESTIMATE_JSON,
    modelRatesPath: MODEL_RATES_PATH,
  });
}

app.get('/api/data-status', (_req, res) => {
  res.json(dataStatusPayload());
});

app.post('/api/reload', (_req, res) => {
  reloadRatesConfig();
  res.json({ ok: true, ...dataStatusPayload() });
});

app.post('/api/sync', async (_req, res) => {
  const t0 = Date.now();
  console.log('[api/sync] 开始从 Cursor 拉取…');
  const result = await syncFromCursor(REPO_ROOT, { reloadRates: reloadRatesConfig });
  if (result.ok) {
    console.log(`[api/sync] 200 ok ${result.ms}ms`);
    return res.json(result);
  }
  console.error(`[api/sync] 失败 ${result.ms}ms: ${result.error}`);
  return res.status(result.partial ? 207 : 500).json(result);
});

/** @deprecated 兼容旧前端；等价于 POST /api/sync */
app.post('/api/refresh', async (_req, res) => {
  console.log('[api/refresh] 开始拉取最新数据...');
  const result = await syncFromCursor(REPO_ROOT, { reloadRates: reloadRatesConfig });
  if (result.ok) {
    console.log(`[api/refresh] 200 ok 刷新成功 ${result.ms}ms`);
    return res.json({ ok: true, ms: result.ms, steps: result.steps });
  }
  const ms = result.ms ?? 0;
  console.error(`[api/refresh] 刷新失败: ${result.error} ${result.ms}ms`);
  return res.status(500).json({
    ok: false,
    error: result.hint || result.error || String(result.error),
    ms: result.ms,
    hint: result.hint,
  });
});

app.listen(PORT, () => {
  const bootMs = Date.now() - bootT0;
  console.log(
    `[boot] Express 监听 http://127.0.0.1:${PORT} repo=${REPO_ROOT} 启动耗时约 ${bootMs}ms`,
  );
});
