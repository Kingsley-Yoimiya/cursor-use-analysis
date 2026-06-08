import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

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
    t.includes('enotfound')
  ) {
    return '无法连接 cursor.com，多为未走代理。请确认 Clash/Surge 已开启，或在终端设置 HTTPS_PROXY=http://127.0.0.1:7897 后重启 dashboard。';
  }
  if (t.includes('html') || t.includes('未登录') || t.includes('login')) {
    return 'Cursor 登录已失效。请在项目根目录执行 npm run login -- --chrome 重新保存会话。';
  }
  if (t.includes('找不到会话') || t.includes('auth.json')) {
    return '缺少 data/auth.json。请先 npm run login 完成浏览器登录。';
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

export async function syncFromCursor(repoRoot, { reloadRates }) {
  ensureProxyEnv();
  const t0 = Date.now();
  const steps = [];

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

  const status = writeSyncStatus(repoRoot, {
    ok: true,
    ms: Date.now() - t0,
    error: null,
    hint: null,
    failedStep: null,
  });

  return {
    ok: true,
    ms: Date.now() - t0,
    steps,
    lastSync: status,
  };
}
