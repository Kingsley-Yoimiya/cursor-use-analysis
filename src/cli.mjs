#!/usr/bin/env node
/**
 * 用量数据：
 * - export：浏览器会话 → 官网 CSV 导出（易被人机验证拦住）
 * - export-api：Admin API Key → api.cursor.com（推荐，无浏览器）
 *
 * 说明：Dashboard「Integrations」里的 User API Key 面向 Cloud Agents API，
 * 不能用于 /teams/filtered-usage-events。需团队管理员在
 * Settings → Advanced → Admin API Keys 创建带 admin:* 的密钥（企业团队）。
 */
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { request } from 'playwright';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

import { dirname, resolve } from 'node:path';

chromium.use(StealthPlugin());

const DEFAULT_AUTH = resolve(process.cwd(), 'data', 'auth.json');
const DEFAULT_BROWSER_PROFILE = resolve(process.cwd(), 'data', 'browser-profile');
/** 供 --remote-debugging-port 使用，必须与默认用户数据目录不同 */
const DEFAULT_CHROME_CDP_PROFILE = resolve(process.cwd(), 'data', 'chrome-cdp-profile');
const BASE = 'https://cursor.com';
const CURSOR_API = 'https://api.cursor.com';

/** Playwright 不读取 HTTP_PROXY；浏览器走系统代理时需在环境变量或此处显式配置 */
function playwrightProxyFromEnv() {
  const raw =
    process.env.PLAYWRIGHT_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  const server = raw?.trim();
  return server ? { server } : undefined;
}

function usage() {
  console.log(`
用法:
  node src/cli.mjs export-api [选项]   【推荐】Admin API Key，拉取 granular 用量（JSON/CSV）
  node src/cli.mjs login [选项]            Stealth + 持久配置/或对接已打开的 Chrome（见下）
  node src/cli.mjs chrome-cdp-cmd          打印「远程调试 Chrome」可复制命令（含 --user-data-dir）
  node src/cli.mjs export [选项]            用已保存会话下载官网 CSV

export-api 选项:
  --api-key <key>        或在环境中设置 CURSOR_API_KEY（不要用 User/Integrations 里的 key）
  --out <文件>           输出路径；扩展名 .csv 输出 CSV，否则 JSON（默认 ./usage-api-<时间戳>.json）
  --start / --end        毫秒时间戳，同官网；默认本月 1 号 UTC 至此刻
  --page-size <n>        每页条数（默认 100）
  --email <邮箱>         仅拉取该成员（可选）
  --user-id <id>         仅拉取该 userId（可选）

export 选项:
  --out <文件>           输出路径（默认 ./usage-export-<时间戳>.csv）
  --start <毫秒时间戳>   startDate（默认：本月 1 号 00:00 UTC）
  --end <毫秒时间戳>     endDate（默认：此刻）
  --strategy <名称>     默认 tokens
  --auth <路径>         会话文件（默认 ./data/auth.json）
  --headed              仅用浏览器下载（API 请求失败时可试）
  --chrome              与 --headed 一起用时，启动本机 Google Chrome

login 选项（减轻 Cloudflare 误判；人机仍需你在窗口里手动完成）:
  --chrome              使用本机已安装的 Google Chrome（比自带 Chromium 更不容易触发校验）
  --profile <目录>      持久化浏览器数据目录，默认 ./data/browser-profile（可复用 cf_clearance）
  --from-cdp <url>      连接已用远程调试启动的 Chrome，例如 http://127.0.0.1:9222
                         ⚠ 必须带独立 --user-data-dir，见: node src/cli.mjs chrome-cdp-cmd

常见问题（.remote-debugging 启动 Chrome）:
  • 首行提示要 non-default user-data-dir：必须加上，否则行为异常；用 chrome-cdp-cmd 生成命令。
  • ssl_client_socket net_error -100：多为后台连接/预加载失败刷屏，页面能开可忽略。
  • GCM DEPRECATED_ENDPOINT、GoogleUpdater：Chrome 自身日志，一般无关。
  • 新配置档首访 cursor.com 较慢：冷启动 + TLS + 资源多，属常见。
  • 已自动登录：该 user-data-dir 里若已有 Cookie / 谷歌账号会话，会直接进控制台，正常。

代理（浏览器能开 dashboard 但 npm export 超时）:
  Playwright 默认不走 macOS 系统代理。可设置:
  export PLAYWRIGHT_PROXY=http://127.0.0.1:7897
  或 HTTPS_PROXY（同上）。端口以本机 Clash/Surge 为准。

鉴权说明:
  User API Keys（Integrations）→ Cloud Agents，不能拉用量。
  用量请用 Admin API Key（admin:*）+ 企业团队，文档:
  https://cursor.com/docs/api

示例:
  export CURSOR_API_KEY='key_xxxxx'
  npm run export-api -- --out ./usage.json
  npm run export-api -- --out ./usage.csv --start 1774972800000 --end 1777478399999

  # 浏览器: 推荐先装 Chrome，然后（人机最省事的一种）
  npm run login -- --chrome
  # 远程调试 Chrome（先运行 chrome-cdp-cmd 复制整条命令，勿漏 --user-data-dir）
  npm run chrome-cdp-cmd
  npm run login -- --from-cdp http://127.0.0.1:9222
`);
}

function chromeExecutableHint() {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    return String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
  }
  return 'google-chrome'; // 或 chromium / 自行 which
}

function cmdChromeCdpCmd() {
  const chrome = chromeExecutableHint();
  const dir = DEFAULT_CHROME_CDP_PROFILE;
  console.log(`
先完全退出正在运行的 Chrome（含菜单栏图标），再在终端执行：

`);
  if (process.platform === 'win32') {
    console.log(
      `"${chrome}" --remote-debugging-port=9222 --user-data-dir="${dir.replace(/\\/g, '\\\\')}"\n`,
    );
  } else {
    const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
    console.log(
      `${q(chrome)} --remote-debugging-port=9222 --user-data-dir=${q(dir)}\n`,
    );
  }
  console.log(`独立配置目录（可重复用登录态）: ${dir}
浏览器里打开 ${BASE}/dashboard ，人机/登录完成后执行：

  npm run login -- --from-cdp http://127.0.0.1:9222
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--auth') args.auth = argv[++i];
    else if (a === '--api-key') args.apiKey = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--start') args.start = argv[++i];
    else if (a === '--end') args.end = argv[++i];
    else if (a === '--strategy') args.strategy = argv[++i];
    else if (a === '--page-size') args.pageSize = argv[++i];
    else if (a === '--email') args.email = argv[++i];
    else if (a === '--user-id') args.userId = argv[++i];
    else if (a === '--headed') args.headed = true;
    else if (a === '--chrome') args.chrome = true;
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '--from-cdp') args.fromCdp = argv[++i];
    else if (a.startsWith('-')) throw new Error(`未知参数: ${a}`);
    else args._.push(a);
  }
  return args;
}

function monthStartUtcMs(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
}

function buildExportUrl(startMs, endMs, strategy) {
  const u = new URL('/api/dashboard/export-usage-events-csv', BASE);
  u.searchParams.set('startDate', String(startMs));
  u.searchParams.set('endDate', String(endMs));
  u.searchParams.set('strategy', strategy);
  return u.toString();
}

async function waitForEnter(message) {
  const rl = createInterface({ input, output });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

async function cmdLogin(authPath, parsed) {
  await mkdir(dirname(authPath), { recursive: true });

  if (parsed.fromCdp) {
    console.log('连接到已有 Chrome 调试端口:', parsed.fromCdp);
    console.log(
      '请在该浏览器实例中打开 cursor.com，完成 Cloudflare 与登录后再继续。\n',
    );
    const browser = await chromium.connectOverCDP(parsed.fromCdp);
    try {
      const contexts = browser.contexts();
      const ctx = contexts[0];
      if (!ctx) {
        throw new Error('未找到浏览器上下文，请保留至少一个 Chrome 窗口');
      }
      await waitForEnter('确认已登录 cursor 控制台 → 按 Enter 写入会话文件… ');
      await ctx.storageState({ path: authPath });
    } finally {
      await browser.close();
    }
    console.log(`\n会话已写入: ${authPath}\n`);
    return;
  }

  const profileDir = resolve(parsed.profile || DEFAULT_BROWSER_PROFILE);
  await mkdir(profileDir, { recursive: true });

  console.log('持久化配置目录:', profileDir);
  console.log(
    '已启用 stealth 插件；Cloudflare 仍须你在窗口内手动完成（无法也不应全自动绕过）。',
  );
  if (parsed.chrome) {
    console.log('当前使用本机 Google Chrome。\n');
  } else {
    console.log('若校验仍循环，可尝试: npm run login -- --chrome\n');
  }

  const slow = Number(process.env.PLAYWRIGHT_SLOW_MO_MS);
  const proxy = playwrightProxyFromEnv();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: parsed.chrome ? 'chrome' : undefined,
    viewport: { width: 1280, height: 900 },
    slowMo: Number.isFinite(slow) && slow > 0 ? slow : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    ...(proxy ? { proxy } : {}),
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`${BASE}/dashboard`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    });
    await waitForEnter('确认已在浏览器中登录完成 → 按 Enter 保存会话… ');
    await context.storageState({ path: authPath });
  } finally {
    await context.close();
  }
  console.log(`\n会话已写入: ${authPath}`);
  console.log(
    '同一 profile 会保留 Cookie；短期内重跑可能少遇到校验。导出用量: npm run export -- --out ./usage.csv\n',
  );
}

async function downloadViaApi(authPath, url, outPath) {
  const proxy = playwrightProxyFromEnv();
  const ctx = await request.newContext({
    storageState: authPath,
    ...(proxy ? { proxy } : {}),
  });
  try {
    const res = await ctx.get(url, { timeout: 120_000 });
    const text = await res.text();
    if (!res.ok()) {
      return {
        ok: false,
        status: res.status(),
        hint: text.slice(0, 500),
      };
    }
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('text/html')) {
      return {
        ok: false,
        status: res.status(),
        hint: text.slice(0, 300),
        isHtml: true,
      };
    }
    await writeFile(outPath, text, 'utf8');
    return { ok: true, bytes: Buffer.byteLength(text, 'utf8') };
  } finally {
    await ctx.dispose();
  }
}

async function downloadViaBrowser(authPath, url, outPath, opts = {}) {
  const slow = Number(process.env.PLAYWRIGHT_SLOW_MO_MS);
  const proxy = playwrightProxyFromEnv();
  const browser = await chromium.launch({
    headless: false,
    channel: opts.useChrome ? 'chrome' : undefined,
    slowMo: Number.isFinite(slow) && slow > 0 ? slow : undefined,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    ...(proxy ? { proxy } : {}),
  });
  const context = await browser.newContext({
    storageState: authPath,
    acceptDownloads: true,
  });
  const page = await context.newPage();
  try {
    const rspPromise = page.waitForResponse(
      (r) =>
        r.url().includes('export-usage-events-csv') &&
        r.request().method() === 'GET',
      { timeout: 120_000 },
    );
    const gotoPromise = page.goto(url, { timeout: 120_000 });
    const [, rsp] = await Promise.all([gotoPromise, rspPromise]);
    const buf = await rsp.body();
    const head = buf.subarray(0, 120).toString('utf8');
    if (head.includes('<!DOCTYPE') || head.toLowerCase().includes('<html')) {
      return {
        ok: false,
        reason:
          '响应为 HTML（未登录、会话过期或 Cloudflare）。请在窗口内完成校验后重试，或重新 npm run login',
      };
    }
    await writeFile(outPath, buf);
    return { ok: true, via: 'response-body' };
  } finally {
    await browser.close();
  }
}

function basicAuthHeader(apiKey) {
  const token = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function csvEscape(value) {
  if (value == null || value === '') return '';
  const t = String(value);
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function usageEventsToCsv(rows) {
  const headers = [
    'timestamp',
    'userEmail',
    'model',
    'kind',
    'maxMode',
    'requestsCosts',
    'isTokenBasedCall',
    'isChargeable',
    'isHeadless',
    'chargedCents',
    'cursorTokenFee',
    'isFreeBugbot',
    'inputTokens',
    'outputTokens',
    'cacheWriteTokens',
    'cacheReadTokens',
    'tokenTotalCents',
    'discountPercentOff',
  ];
  const lines = [headers.join(',')];
  for (const e of rows) {
    const tu = e.tokenUsage || {};
    lines.push(
      [
        e.timestamp,
        e.userEmail,
        e.model,
        e.kind,
        e.maxMode,
        e.requestsCosts,
        e.isTokenBasedCall,
        e.isChargeable,
        e.isHeadless,
        e.chargedCents,
        e.cursorTokenFee,
        e.isFreeBugbot,
        tu.inputTokens,
        tu.outputTokens,
        tu.cacheWriteTokens,
        tu.cacheReadTokens,
        tu.totalCents,
        tu.discountPercentOff,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function postFilteredUsageEvents(apiKey, payload) {
  const res = await fetch(`${CURSOR_API}/teams/filtered-usage-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(apiKey),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  return { res, text, data };
}

async function cmdExportApi(parsed) {
  const apiKey = parsed.apiKey || process.env.CURSOR_API_KEY;
  if (!apiKey || !String(apiKey).trim()) {
    console.error('请设置 CURSOR_API_KEY 或使用 --api-key（须为 Admin API Key，key_ 前缀）');
    process.exitCode = 1;
    return;
  }

  const endMs = parsed.end ? Number(parsed.end) : Date.now();
  const startMs = parsed.start ? Number(parsed.start) : monthStartUtcMs(new Date(endMs));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('start/end 必须是数字（毫秒时间戳）');
  }

  const pageSize = Math.min(500, Math.max(1, Number(parsed.pageSize) || 100));
  const email = parsed.email || undefined;
  const userId = parsed.userId ? Number(parsed.userId) : undefined;
  if (parsed.userId != null && !Number.isFinite(userId)) {
    throw new Error('--user-id 必须是数字');
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = resolve(process.cwd(), `usage-api-export-${ts}.json`);
  const outPath = resolve(parsed.out || defaultOut);
  const wantCsv = outPath.toLowerCase().endsWith('.csv');

  await mkdir(dirname(outPath), { recursive: true });

  const allEvents = [];
  let page = 1;
  let totalReported = null;

  for (;;) {
    const body = {
      startDate: startMs,
      endDate: endMs,
      page,
      pageSize,
    };
    if (email) body.email = email;
    if (userId != null && Number.isFinite(userId)) body.userId = userId;

    process.stdout.write(`\r拉取第 ${page} 页… `);
    const { res, text, data } = await postFilteredUsageEvents(apiKey, body);

    if (res.status === 401) {
      console.error('\n401：密钥无效或格式不对。请确认是 Admin API Key（非 Integrations User Key）。');
      process.exitCode = 1;
      return;
    }
    if (res.status === 403) {
      console.error(
        '\n403：权限不足或计划不含企业 Admin API。官方说明见 https://cursor.com/docs/api',
      );
      if (data?.message) console.error('详情:', data.message);
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      console.error(`\n请求失败 HTTP ${res.status}:`, text.slice(0, 800));
      process.exitCode = 1;
      return;
    }

    const events = data?.usageEvents ?? [];
    if (typeof data?.totalUsageEventsCount === 'number') {
      totalReported = data.totalUsageEventsCount;
    }
    allEvents.push(...events);

    const pag = data?.pagination;
    const hasNext = pag?.hasNextPage === true;
    if (!hasNext) break;
    page += 1;
    if (page > 50000) {
      console.error('\n分页上限异常，中止。');
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write('\r');
  if (wantCsv) {
    await writeFile(outPath, usageEventsToCsv(allEvents), 'utf8');
  } else {
    const bundle = {
      pulledAt: new Date().toISOString(),
      startDate: startMs,
      endDate: endMs,
      totalUsageEventsCount: totalReported,
      eventCount: allEvents.length,
      usageEvents: allEvents,
    };
    await writeFile(outPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  }

  console.log(
    `已写入 ${outPath}（事件条数 ${allEvents.length}${totalReported != null ? `，服务端总计 ${totalReported}` : ''}）`,
  );
}

async function fileExists(p) {
  try {
    await access(p, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function cmdExport(parsed) {
  const authPath = resolve(parsed.auth || DEFAULT_AUTH);
  if (!(await fileExists(authPath))) {
    console.error(`找不到会话文件: ${authPath}`);
    console.error('请先运行: npm run login');
    process.exitCode = 1;
    return;
  }

  const strategy = parsed.strategy || 'tokens';
  const endMs = parsed.end ? Number(parsed.end) : Date.now();
  const startMs = parsed.start ? Number(parsed.start) : monthStartUtcMs(new Date(endMs));

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('start/end 必须是数字（毫秒时间戳）');
  }

  const url = buildExportUrl(startMs, endMs, strategy);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = resolve(parsed.out || `usage-export-${ts}.csv`);

  await mkdir(dirname(outPath), { recursive: true });

  console.log('请求地址:', url);
  console.log('会话文件:', authPath);

  if (parsed.headed) {
    const r = await downloadViaBrowser(authPath, url, outPath, {
      useChrome: parsed.chrome === true,
    });
    if (!r.ok) throw new Error(r.reason || 'headed 下载失败');
    console.log(`\n已保存 (${r.via}): ${outPath}`);
    return;
  }

  const r = await downloadViaApi(authPath, url, outPath);
  if (!r.ok) {
    console.error(`\nAPI 下载失败: HTTP ${r.status}`);
    if (r.isHtml) {
      console.error('响应为 HTML（可能是未登录或跳转登录页）。请执行 npm run login 后重试。');
    }
    if (r.hint) console.error('片段:\n', r.hint);
    console.error('\n可尝试: npm run export -- --headed --out ./usage.csv');
    process.exitCode = 1;
    return;
  }
  console.log(`\n已保存: ${outPath}（约 ${r.bytes} 字节）`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    usage();
    return;
  }

  const cmd = argv[0];
  const rest = argv.slice(1);
  const parsed = parseArgs(rest);

  if (cmd === 'chrome-cdp-cmd') {
    cmdChromeCdpCmd();
    return;
  }

  if (cmd === 'export-api') {
    await cmdExportApi(parsed);
    return;
  }

  if (cmd === 'login') {
    const authPath = resolve(parsed.auth || DEFAULT_AUTH);
    await cmdLogin(authPath, parsed);
    return;
  }

  if (cmd === 'export') {
    await cmdExport(parsed);
    return;
  }

  console.error('未知命令:', cmd);
  usage();
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
