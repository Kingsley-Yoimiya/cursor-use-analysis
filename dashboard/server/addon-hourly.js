/**
 * 附加源（如 DongCC）CSV → 日×24h token 聚合。
 * 时间戳按「墙钟」切日/时（无 Z/offset，与 dongcc cursor-daily 日键一致）。
 */
import fs, { createReadStream } from 'fs';
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

/**
 * @param {string} csvPath
 * @returns {Promise<{ days: Array<{ date: string, hours: number[], totalTokens: number, rows: number }>, timezone: string }>}
 */
export async function aggregateAddonHourlyFromCsv(csvPath) {
  if (!fs.existsSync(csvPath)) {
    return { days: [], timezone: 'local-wall-clock', error: 'csv_missing' };
  }

  /** @type {Map<string, { date: string, hours: number[], totalTokens: number, rows: number }>} */
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

        const tokens =
          parseIntField(row.cache_creation_tokens) +
          parseIntField(row.input_tokens) +
          parseIntField(row.cache_read_tokens) +
          parseIntField(row.output_tokens);

        let agg = byDay.get(local.date);
        if (!agg) {
          agg = {
            date: local.date,
            hours: Array.from({ length: 24 }, () => 0),
            totalTokens: 0,
            rows: 0,
          };
          byDay.set(local.date, agg);
        }
        agg.hours[local.hour] += tokens;
        agg.totalTokens += tokens;
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
