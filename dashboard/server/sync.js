import fs, { createReadStream } from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import util from 'util';
import csv from 'csv-parser';

const execPromise = util.promisify(exec);

const CSV_TOKEN_COLS = {
  date: 'Date',
  inCacheWrite: 'Input (w/ Cache Write)',
  inNoCache: 'Input (w/o Cache Write)',
  cacheRead: 'Cache Read',
  output: 'Output Tokens',
  total: 'Total Tokens',
};

function parseIntField(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  const n = Number.parseInt(String(v).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function rowTokenTotal(row) {
  const cacheRead = parseIntField(row[CSV_TOKEN_COLS.cacheRead]);
  const inputCacheWrite = parseIntField(row[CSV_TOKEN_COLS.inCacheWrite]);
  const inputNoCache = parseIntField(row[CSV_TOKEN_COLS.inNoCache]);
  const outputTokens = parseIntField(row[CSV_TOKEN_COLS.output]);
  const total =
    parseIntField(row[CSV_TOKEN_COLS.total]) ||
    cacheRead + inputCacheWrite + inputNoCache + outputTokens;
  return (
    total ||
    cacheRead + inputCacheWrite + inputNoCache + outputTokens
  );
}

/**
 * 扫描 usage.csv：合计 + 自 sinceIso 之后的增量（按事件 Date）。
 * @param {string} usageCsvPath
 * @param {string | null} sinceIso
 */
export async function summarizeUsageCsv(usageCsvPath, sinceIso = null) {
  if (!fs.existsSync(usageCsvPath)) {
    return {
      exists: false,
      totalRows: 0,
      totalTokens: 0,
      addedRows: 0,
      addedTokens: 0,
    };
  }

  const sinceMs =
    sinceIso != null && sinceIso !== ''
      ? new Date(sinceIso).getTime()
      : null;
  const sinceOk = sinceMs != null && Number.isFinite(sinceMs);

  let totalRows = 0;
  let totalTokens = 0;
  let addedRows = 0;
  let addedTokens = 0;

  await new Promise((resolve, reject) => {
    const stream = createReadStream(usageCsvPath, { encoding: 'utf8' });
    stream.on('error', reject);
    stream
      .pipe(csv())
      .on('data', (row) => {
        const tokens = rowTokenTotal(row);
        totalRows += 1;
        totalTokens += tokens;
        if (!sinceOk) return;
        const raw = row[CSV_TOKEN_COLS.date];
        if (!raw) return;
        const t = new Date(String(raw).trim()).getTime();
        if (!Number.isFinite(t) || t <= sinceMs) return;
        addedRows += 1;
        addedTokens += tokens;
      })
      .on('end', resolve)
      .on('error', reject);
  });

  return {
    exists: true,
    totalRows,
    totalTokens,
    addedRows,
    addedTokens,
  };
}

function tokensFromParts(tokens) {
  if (!tokens || typeof tokens !== 'object') return 0;
  return (
    (Number(tokens.cacheWrite) || 0) +
    (Number(tokens.noCache) || 0) +
    (Number(tokens.cacheRead) || 0) +
    (Number(tokens.output) || 0)
  );
}

function tokensFromByModel(byModel) {
  if (!Array.isArray(byModel)) return 0;
  let sum = 0;
  for (const m of byModel) sum += tokensFromParts(m?.tokens);
  return sum;
}

/**
 * 从 estimate.json 按事件时间统计增量（含估算 USD）。
 * @param {string} estimateJsonPath
 * @param {string | null} sinceIso
 */
export function summarizeEstimateDelta(estimateJsonPath, sinceIso = null) {
  if (!fs.existsSync(estimateJsonPath)) {
    return {
      exists: false,
      totalRows: 0,
      totalTokens: 0,
      totalUsd: 0,
      addedRows: 0,
      addedTokens: 0,
      addedUsd: 0,
    };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(estimateJsonPath, 'utf8'));
  } catch {
    return {
      exists: false,
      totalRows: 0,
      totalTokens: 0,
      totalUsd: 0,
      addedRows: 0,
      addedTokens: 0,
      addedUsd: 0,
    };
  }

  const sinceMs =
    sinceIso != null && sinceIso !== ''
      ? new Date(sinceIso).getTime()
      : null;
  const sinceOk = sinceMs != null && Number.isFinite(sinceMs);

  const rows = Array.isArray(data.rows) ? data.rows : [];
  let addedRows = 0;
  let addedTokens = 0;
  let addedUsd = 0;

  if (sinceOk) {
    for (const row of rows) {
      const raw = row?.date;
      if (!raw) continue;
      const t = new Date(String(raw).trim()).getTime();
      if (!Number.isFinite(t) || t <= sinceMs) continue;
      addedRows += 1;
      addedTokens += tokensFromParts(row.tokens);
      addedUsd += Number(row.estimatedUsd) || 0;
    }
  }

  const totalUsd = Number(data.totals?.totalEstimatedUsd) || 0;
  const totalRows = Number(data.totals?.rows) || rows.length;
  const totalTokens = tokensFromByModel(data.byModel);

  return {
    exists: true,
    totalRows,
    totalTokens,
    totalUsd,
    addedRows: sinceOk ? addedRows : 0,
    addedTokens: sinceOk ? addedTokens : 0,
    addedUsd: sinceOk ? addedUsd : 0,
  };
}

const AUTH_JSON = (repoRoot) => path.join(repoRoot, 'data', 'auth.json');
const SYNC_STATUS_PATH = (repoRoot) =>
  path.join(repoRoot, 'data', 'dashboard-sync.json');

/** macOS 系统代理不会自动传给 Node；与 start-dev.sh 行为一致 */
export function ensureProxyEnv() {
  if (
    process.env.PLAYWRIGHT_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy
  ) {
    return Boolean(
      process.env.PLAYWRIGHT_PROXY ||
        process.env.HTTPS_PROXY ||
        process.env.https_proxy,
    );
  }
  if (process.platform !== 'darwin') return false;
  try {
    const out = execSync('scutil --proxy', { encoding: 'utf8', timeout: 3000 });
    if (!/HTTPEnable\s*:\s*1/.test(out)) return false;
    const portMatch = out.match(/HTTPPort\s*:\s*(\d+)/);
    if (!portMatch) return false;
    const proxy = `http://127.0.0.1:${portMatch[1]}`;
    process.env.HTTPS_PROXY = proxy;
    process.env.HTTP_PROXY = proxy;
    return true;
  } catch {
    return false;
  }
}

function fileMeta(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, path: filePath };
  }
  const stat = fs.statSync(filePath);
  return {
    exists: true,
    path: filePath,
    mtimeMs: stat.mtimeMs,
    mtimeIso: stat.mtime.toISOString(),
    sizeBytes: stat.size,
  };
}

function parseAuthSessionExpiry(authPath) {
  if (!fs.existsSync(authPath)) return null;
  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    const state = JSON.parse(raw);
    const cookies = state.cookies ?? [];
    const token = cookies.find((c) => c.name === 'WorkosCursorSessionToken');
    if (!token?.value) return null;
    const encoded = String(token.value);
    const jwtPart = decodeURIComponent(encoded).split('::').pop();
    if (!jwtPart) return null;
    const payload = JSON.parse(
      Buffer.from(jwtPart.split('.')[1], 'base64url').toString('utf8'),
    );
    if (!payload.exp) return null;
    return {
      expMs: payload.exp * 1000,
      expIso: new Date(payload.exp * 1000).toISOString(),
      expired: Date.now() > payload.exp * 1000,
    };
  } catch {
    return null;
  }
}

function readSyncStatus(repoRoot) {
  const p = SYNC_STATUS_PATH(repoRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeSyncStatus(repoRoot, patch) {
  const p = SYNC_STATUS_PATH(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const prev = readSyncStatus(repoRoot) ?? {};
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function classifySyncError(text) {
  const t = String(text || '').toLowerCase();
  if (
    t.includes('etimedout') ||
    t.includes('timeout') ||
    t.includes('econnrefused') ||
    t.includes('enotfound') ||
    t.includes('socket disconnected') ||
    t.includes('tls connection') ||
    t.includes('network socket') ||
    t.includes('econnreset') ||
    t.includes('cert')
  ) {
    return '无法连接 cursor.com，多为未走代理或 TLS 中断。请确认 Clash/Surge 已开启，或在终端设置 HTTPS_PROXY=http://127.0.0.1:7897 后重启 dashboard。';
  }
  // 勿用 auth.json / login 子串：export 成功路径也会打印「会话文件: .../auth.json」和「请先运行: npm run login」
  if (t.includes('找不到会话文件')) {
    return '缺少 data/auth.json。请先 npm run login 完成浏览器登录。';
  }
  if (
    t.includes('响应为 html') ||
    t.includes('未登录') ||
    t.includes('跳转登录页') ||
    t.includes('登录已失效')
  ) {
    return 'Cursor 登录已失效。请在项目根目录执行 npm run login -- --chrome 重新保存会话。';
  }
  return '同步失败。可先在终端运行 npm run export 查看完整报错，或仅使用「重新加载」读取已有 CSV。';
}

export function getDataStatus(repoRoot, paths) {
  const { usageCsv, estimateJson, modelRatesPath } = paths;
  const authPath = AUTH_JSON(repoRoot);
  const auth = fileMeta(authPath);
  const session = parseAuthSessionExpiry(authPath);
  const proxyConfigured = Boolean(
    process.env.PLAYWRIGHT_PROXY ||
      process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
  );

  return {
    ok: true,
    files: {
      usageCsv: fileMeta(usageCsv),
      estimateJson: fileMeta(estimateJson),
      authJson: auth,
    },
    session,
    proxyConfigured,
    lastSync: readSyncStatus(repoRoot),
  };
}

async function runNpmScript(script, repoRoot) {
  const t0 = Date.now();
  const env = { ...process.env };
  try {
    const { stdout, stderr } = await execPromise(`npm run ${script}`, {
      cwd: repoRoot,
      env,
      maxBuffer: 12 * 1024 * 1024,
      timeout: 180_000,
    });
    return {
      ok: true,
      id: script,
      ms: Date.now() - t0,
      stdout: stdout?.slice(-2000),
      stderr: stderr?.slice(-2000),
    };
  } catch (e) {
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n');
    return {
      ok: false,
      id: script,
      ms: Date.now() - t0,
      error: e.message,
      detail: detail.slice(-4000),
      hint: classifySyncError(detail),
    };
  }
}

export async function syncFromCursor(
  repoRoot,
  { reloadRates, usageCsvPath, estimateJsonPath },
) {
  ensureProxyEnv();
  const t0 = Date.now();
  const steps = [];
  const prevStatus = readSyncStatus(repoRoot);
  const sinceIso =
    prevStatus?.lastSuccessAt ||
    (prevStatus?.ok ? prevStatus.updatedAt : null) ||
    null;

  const exportStep = await runNpmScript('export', repoRoot);
  steps.push({ id: 'export', ...exportStep });
  if (!exportStep.ok) {
    const status = writeSyncStatus(repoRoot, {
      ok: false,
      ms: Date.now() - t0,
      error: exportStep.error,
      hint: exportStep.hint,
      failedStep: 'export',
    });
    return {
      ok: false,
      ms: Date.now() - t0,
      steps,
      hint: exportStep.hint,
      error: exportStep.error,
      detail: exportStep.detail,
      lastSync: status,
    };
  }

  const estimateStep = await runNpmScript('estimate-cost', repoRoot);
  steps.push({ id: 'estimate-cost', ...estimateStep });
  if (!estimateStep.ok) {
    const status = writeSyncStatus(repoRoot, {
      ok: false,
      ms: Date.now() - t0,
      error: estimateStep.error,
      hint: estimateStep.hint,
      failedStep: 'estimate-cost',
      partial: true,
    });
    return {
      ok: false,
      ms: Date.now() - t0,
      steps,
      hint: estimateStep.hint,
      error: estimateStep.error,
      detail: estimateStep.detail,
      partial: true,
      lastSync: status,
    };
  }

  if (reloadRates) reloadRates();

  const successAt = new Date().toISOString();
  let delta = {
    sinceIso,
    elapsedMs:
      sinceIso != null
        ? Math.max(0, Date.now() - new Date(sinceIso).getTime())
        : null,
    addedRows: 0,
    addedTokens: 0,
    addedUsd: 0,
    totalTokens: 0,
    totalRows: 0,
    totalUsd: 0,
    firstSync: sinceIso == null,
    cursor: {
      addedRows: 0,
      addedTokens: 0,
      addedUsd: 0,
    },
    addons: {
      addedRows: 0,
      addedTokens: 0,
      addedUsd: 0,
    },
  };

  // 优先用 estimate.json（含 USD）；CSV 作兜底
  if (estimateJsonPath) {
    try {
      const est = summarizeEstimateDelta(estimateJsonPath, sinceIso);
      if (est.exists) {
        delta = {
          ...delta,
          addedRows: est.addedRows,
          addedTokens: est.addedTokens,
          addedUsd: est.addedUsd,
          totalTokens: est.totalTokens,
          totalRows: est.totalRows,
          totalUsd: est.totalUsd,
          cursor: {
            addedRows: est.addedRows,
            addedTokens: est.addedTokens,
            addedUsd: est.addedUsd,
          },
        };
      }
    } catch (e) {
      console.warn(`[sync] estimate 增量统计失败: ${e?.message}`);
    }
  }

  if (
    usageCsvPath &&
    delta.totalRows === 0 &&
    delta.totalTokens === 0
  ) {
    try {
      const summary = await summarizeUsageCsv(usageCsvPath, sinceIso);
      delta = {
        ...delta,
        addedRows: sinceIso == null ? 0 : summary.addedRows,
        addedTokens: sinceIso == null ? 0 : summary.addedTokens,
        totalTokens: summary.totalTokens,
        totalRows: summary.totalRows,
        cursor: {
          addedRows: sinceIso == null ? 0 : summary.addedRows,
          addedTokens: sinceIso == null ? 0 : summary.addedTokens,
          addedUsd: 0,
        },
      };
    } catch (e) {
      console.warn(`[sync] 用量增量统计失败: ${e?.message}`);
    }
  }

  const status = writeSyncStatus(repoRoot, {
    ok: true,
    ms: Date.now() - t0,
    error: null,
    hint: null,
    failedStep: null,
    lastSuccessAt: successAt,
    totalsAtSync: {
      rows: delta.totalRows,
      totalTokens: delta.totalTokens,
      totalUsd: delta.totalUsd,
    },
  });

  return {
    ok: true,
    ms: Date.now() - t0,
    steps,
    delta,
    lastSync: status,
  };
}
