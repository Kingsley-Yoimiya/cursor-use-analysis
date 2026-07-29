/**
 * 附加源（如 DongCC）CSV → 日×24h token / 估算 USD 聚合。
 * 时间戳按「墙钟」切日/时（无 Z/offset，与 dongcc cursor-daily 日键一致）。
 */
import fs, { createReadStream } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import csv from 'csv-parser';

function parseIntField(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = Number.parseInt(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * @param {string} ts
 * @returns {{ date: string, hour: number } | null}
 */
export function wallClockDayHour(ts) {
  if (!ts) return null;
  const m = String(ts)
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2})/);
  if (!m) return null;
  const hour = Number.parseInt(m[2], 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return { date: m[1], hour };
}

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

async function loadRateHelpers(repoRoot) {
  if (!repoRoot) return null;
  const ratesPath = path.join(repoRoot, 'config', 'model-rates.json');
  const resolvePath = path.join(
    repoRoot,
    'scripts',
    'lib',
    'resolve-model-rate.mjs',
  );
  if (!fs.existsSync(ratesPath) || !fs.existsSync(resolvePath)) return null;
  const ratesConfig = JSON.parse(fs.readFileSync(ratesPath, 'utf8'));
  const { resolveRateForModel } = await import(pathToFileURL(resolvePath).href);
  return { ratesConfig, resolveRateForModel };
}

/**
 * @param {string} csvPath
 * @param {{ repoRoot?: string }} [opts]
 * @returns {Promise<{ days: Array<{ date: string, hours: number[], costHours: number[], totalTokens: number, totalCost: number, rows: number }>, timezone: string, generatedAt?: string, error?: string }>}
 */
export async function aggregateAddonHourlyFromCsv(csvPath, opts = {}) {
  if (!fs.existsSync(csvPath)) {
    return { days: [], timezone: 'local-wall-clock', error: 'csv_missing' };
  }

  const helpers = await loadRateHelpers(opts.repoRoot);

  /**
   * @type {Map<string, { date: string, hours: number[], costHours: number[], totalTokens: number, totalCost: number, rows: number }>}
   */
  const byDay = new Map();

  await new Promise((resolve, reject) => {
    const stream = createReadStream(csvPath, { encoding: 'utf8' });
    stream.on('error', reject);
    stream
      .pipe(csv())
      .on('data', (row) => {
        const local = wallClockDayHour(
          row.timestamp || row.Timestamp || row.date || row.Date,
        );
        if (!local) return;

        const tokensParts = {
          cacheWrite: parseIntField(row.cache_creation_tokens),
          noCache: parseIntField(row.input_tokens),
          cacheRead: parseIntField(row.cache_read_tokens),
          output: parseIntField(row.output_tokens),
        };
        const tokens =
          tokensParts.cacheWrite +
          tokensParts.noCache +
          tokensParts.cacheRead +
          tokensParts.output;

        let usd = 0;
        if (helpers) {
          const modelRaw = row.model || row.Model || '';
          const { rate } = helpers.resolveRateForModel(
            modelRaw,
            helpers.ratesConfig,
          );
          if (rate) usd = estimateTokensUsd(tokensParts, rate);
        }

        let agg = byDay.get(local.date);
        if (!agg) {
          agg = {
            date: local.date,
            hours: Array.from({ length: 24 }, () => 0),
            costHours: Array.from({ length: 24 }, () => 0),
            totalTokens: 0,
            totalCost: 0,
            rows: 0,
          };
          byDay.set(local.date, agg);
        }
        agg.hours[local.hour] += tokens;
        agg.costHours[local.hour] += usd;
        agg.totalTokens += tokens;
        agg.totalCost += usd;
        agg.rows += 1;
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    days,
    timezone: 'local-wall-clock',
    generatedAt: new Date().toISOString(),
  };
}
