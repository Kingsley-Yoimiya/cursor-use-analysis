#!/usr/bin/env node
/**
 * 按 Cursor 公开计费规则估算每条用量行的「等价美元」。
 *
 * 输入：官网导出的 usage CSV（token 分列 + Model + Max Mode）。
 * 费率：config/model-rates.json（需与官方 https://cursor.com/docs/models-and-pricing 对齐）。
 *
 * 限制：
 * - 不显式建模 First-party / API 池的包月抵扣；Out-of-pool 仍以同表单价估算。
 * - 长上下文 2x：默认对「输入侧三类 token 的费用」整体乘以倍数（见配置说明）。
 * - Teams 的 Cursor Token Rate 可选 --teams 粗略叠加（Auto 与 billingPool=firstParty 豁免）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @param {string} line */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') o.inFile = argv[++i];
    else if (a === '--out') o.outFile = argv[++i];
    else if (a === '--rates') o.ratesFile = argv[++i];
    else if (a === '--teams') o.teams = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('-')) throw new Error(`未知参数: ${a}`);
    else o._.push(a);
  }
  return o;
}

function usage() {
  console.log(`用法:
  node scripts/estimate-cost.mjs --in <usage.csv> [--out report.json] [--rates config/model-rates.json] [--teams]

  --teams   按 Teams 规则粗略加上 Cursor Token Rate（$0.25/M）；Auto 与 First-party（Composer / Grok 4.5）豁免。
`);
}

/** @param {string} s */
function num(s) {
  const n = Number(String(s).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Record<string,string>} row
 * @param {any} ratesConfig
 */
function resolveRateForModel(modelRaw, ratesConfig) {
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
 * @returns {'Auto'|'FirstParty'|'API'}
 */
function classifyPool(kind, resolvedKey, rate) {
  if (kind === 'auto') return 'Auto';
  if (rate?.billingPool === 'firstParty') return 'FirstParty';
  if (resolvedKey.includes('composer') || resolvedKey.startsWith('grok-4.5')) {
    return 'FirstParty';
  }
  return 'API';
}

/** Auto 与 First-party 模型豁免 Teams Cursor Token Rate */
function isTeamsCtrExempt(kind, rate) {
  if (kind === 'auto') return true;
  if (rate?.billingPool === 'firstParty') return true;
  return false;
}

/**
 * @param {{ cacheWrite:number, noCache:number, cacheRead:number, output:number }} t
 * @param {object} rate
 */
function estimateTokensUsd(t, rate, teamsExtraPerMillion) {
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
  let subtotal = inputUsd + outputUsd;

  let teamsCursorUsd = 0;
  if (teamsExtraPerMillion != null && teamsExtraPerMillion > 0) {
    const all = t.cacheWrite + t.noCache + t.cacheRead + t.output;
    teamsCursorUsd = (all / 1e6) * teamsExtraPerMillion;
    subtotal += teamsCursorUsd;
  }

  return {
    inputUsd,
    outputUsd,
    teamsCursorUsd,
    estimatedUsd: subtotal,
    inputMult,
    inputTokensTotal,
  };
}

async function main() {
  const raw = parseArgs(process.argv.slice(2));
  if (raw.help || !raw.inFile) {
    usage();
    if (!raw.help && !raw.inFile) process.exitCode = 1;
    return;
  }

  const inPath = resolve(process.cwd(), raw.inFile);
  const outPath = resolve(
    process.cwd(),
    raw.outFile || join('reports', `estimate-${Date.now()}.json`),
  );
  const ratesPath = resolve(
    process.cwd(),
    raw.ratesFile || join('config', 'model-rates.json'),
  );

  const [csvText, ratesText] = await Promise.all([
    readFile(inPath, 'utf8'),
    readFile(ratesPath, 'utf8'),
  ]);
  const ratesConfig = JSON.parse(ratesText);

  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV 行数不足');

  const headers = parseCsvLine(lines[0]);
  const h = (name) => headers.indexOf(name);

  const idxDate = h('Date');
  const idxModel = h('Model');
  const idxMax = h('Max Mode');
  const idxKind = h('Kind');
  const idxCost = h('Cost');
  const idxInCW = h('Input (w/ Cache Write)');
  const idxInNCW = h('Input (w/o Cache Write)');
  const idxCR = h('Cache Read');
  const idxOut = h('Output Tokens');
  const idxTotal = h('Total Tokens');

  if ([idxModel, idxInCW, idxInNCW, idxCR, idxOut].some((i) => i < 0)) {
    throw new Error('CSV 缺少必要列（Model / Input / Cache Read / Output）');
  }

  const rows = [];
  const byModel = {};
  const byPool = { Auto: 0, FirstParty: 0, API: 0 };

  let unknownModelCount = 0;
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const get = (i) => (i >= 0 ? cols[i] : '');

    const modelRaw = get(idxModel);
    const { kind: rateKind, rate, resolvedKey } = resolveRateForModel(
      modelRaw,
      ratesConfig,
    );

    if (!rate) {
      unknownModelCount++;
      rows.push({
        line: li + 1,
        model: modelRaw,
        resolvedKey,
        pool: 'API',
        error: 'unknown_model',
        costColumn: get(idxCost),
        kindColumn: get(idxKind),
      });
      continue;
    }

    const tokens = {
      cacheWrite: num(get(idxInCW)),
      noCache: num(get(idxInNCW)),
      cacheRead: num(get(idxCR)),
      output: num(get(idxOut)),
    };

    const pool = classifyPool(rateKind, resolvedKey, rate);
    const teamsRate =
      raw.teams && !isTeamsCtrExempt(rateKind, rate)
        ? ratesConfig.teamsCursorTokenRatePerMillion
        : null;

    const est = estimateTokensUsd(tokens, rate, teamsRate);

    const rec = {
      line: li + 1,
      date: get(idxDate),
      model: modelRaw,
      resolvedRateKey: resolvedKey,
      rateSource: rateKind,
      pool,
      maxMode: get(idxMax),
      kindColumn: get(idxKind),
      costColumn: get(idxCost),
      tokens,
      totalTokensReported: idxTotal >= 0 ? num(get(idxTotal)) : null,
      ...est,
    };
    rows.push(rec);
    byPool[pool] += est.estimatedUsd;

    const aggKey = resolvedKey || modelRaw;
    if (!byModel[aggKey]) {
      byModel[aggKey] = {
        model: aggKey,
        pool,
        requests: 0,
        estimatedUsd: 0,
        tokens: {
          cacheWrite: 0,
          noCache: 0,
          cacheRead: 0,
          output: 0,
        },
        longContextScaledRows: 0,
      };
    }
    byModel[aggKey].requests++;
    byModel[aggKey].estimatedUsd += est.estimatedUsd;
    byModel[aggKey].tokens.cacheWrite += tokens.cacheWrite;
    byModel[aggKey].tokens.noCache += tokens.noCache;
    byModel[aggKey].tokens.cacheRead += tokens.cacheRead;
    byModel[aggKey].tokens.output += tokens.output;
    if (est.inputMult > 1) byModel[aggKey].longContextScaledRows++;
  }

  const totalEstimatedUsd = rows
    .filter((r) => typeof r.estimatedUsd === 'number')
    .reduce((s, r) => s + r.estimatedUsd, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    inputCsv: inPath,
    ratesFile: ratesPath,
    teamsSurchargeApplied: Boolean(raw.teams),
    disclaimer:
      'estimatedUsd 为按公开文档单价估算的等价费用，不等同于发票金额；Included 套餐内额度未建模抵扣。Grok 4.5 / Composer 计入 First-party 池，非 API。',
    totals: {
      rows: rows.length,
      unknownModelRows: unknownModelCount,
      totalEstimatedUsd,
      estimatedUsdByPool: byPool,
    },
    byModel: Object.values(byModel).sort((a, b) => b.estimatedUsd - a.estimatedUsd),
    rows,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`\n已写入: ${outPath}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
