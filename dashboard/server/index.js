import express from 'express';
import cors from 'cors';
import fs, { createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ESTIMATE_JSON = path.join(REPO_ROOT, 'reports', 'estimate.json');
const USAGE_CSV = path.join(REPO_ROOT, 'exports', 'usage.csv');
const MODEL_RATES_PATH = path.join(REPO_ROOT, 'config', 'model-rates.json');

const PORT = Number(process.env.PORT) || 3001;
const bootT0 = Date.now();

// ──────────── 加载费率配置 ────────────

let ratesConfig = null;
try {
  const raw = fs.readFileSync(MODEL_RATES_PATH, 'utf8');
  ratesConfig = JSON.parse(raw);
  console.log(
    `[boot] 已加载 model-rates.json，模型数量: ${Object.keys(ratesConfig.models).length}`,
  );
} catch (e) {
  console.warn(`[boot] 警告：无法加载 model-rates.json: ${e?.message}`);
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

// ──────────── Express ────────────

const app = express();
app.use(cors());

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

  const col = {
    date: 'Date',
    model: 'Model',
    inCacheWrite: 'Input (w/ Cache Write)',
    inNoCache: 'Input (w/o Cache Write)',
    cacheRead: 'Cache Read',
    output: 'Output Tokens',
    total: 'Total Tokens',
  };

  try {
    await new Promise((resolve, reject) => {
      const stream = createReadStream(USAGE_CSV, { encoding: 'utf8' });
      stream.on('error', reject);
      stream
        .pipe(csv())
        .on('data', (row) => {
          const day = dayKeyFromDateCell(row[col.date]);
          if (!day) return;

          const cacheRead = parseIntField(row[col.cacheRead]);
          const inputCacheWrite = parseIntField(row[col.inCacheWrite]);
          const inputNoCache = parseIntField(row[col.inNoCache]);
          const outputTokens = parseIntField(row[col.output]);
          const totalTokens =
            parseIntField(row[col.total]) ||
            cacheRead + inputCacheWrite + inputNoCache + outputTokens;

          // 计算真实等效 USD 成本
          const modelRaw = row[col.model] ?? '';
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
          const rowTokens = cacheRead + inputCacheWrite + inputNoCache + outputTokens;

          const modelKey = resolvedKey || String(modelRaw || 'unknown').trim() || 'unknown';

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
          agg.tokensByModel[modelKey] = (agg.tokensByModel[modelKey] ?? 0) + rowTokens;
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, repoRoot: REPO_ROOT });
});

app.post('/api/refresh', async (req, res) => {
  const t0 = Date.now();
  console.log('[api/refresh] 开始拉取最新数据...');
  try {
    // 运行拉取数据命令
    await execPromise('npm run export', { cwd: REPO_ROOT });
    // 运行生成报告命令
    await execPromise('npm run estimate-cost', { cwd: REPO_ROOT });
    
    // 重新加载 ratesConfig (如果需要)
    try {
      const raw = fs.readFileSync(MODEL_RATES_PATH, 'utf8');
      ratesConfig = JSON.parse(raw);
    } catch (e) {
      console.warn(`[api/refresh] 重新加载 model-rates.json 失败: ${e?.message}`);
    }

    const ms = Date.now() - t0;
    console.log(`[api/refresh] 200 ok 刷新成功 ${ms}ms`);
    res.json({ ok: true, ms });
  } catch (e) {
    const ms = Date.now() - t0;
    console.error(`[api/refresh] 刷新失败: ${e?.message} ${ms}ms`);
    res.status(500).json({ ok: false, error: e?.message || String(e), ms });
  }
});

app.listen(PORT, () => {
  const bootMs = Date.now() - bootT0;
  console.log(
    `[boot] Express 监听 http://127.0.0.1:${PORT} repo=${REPO_ROOT} 启动耗时约 ${bootMs}ms`,
  );
});
