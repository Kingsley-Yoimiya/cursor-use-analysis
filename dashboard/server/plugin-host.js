/**
 * Dashboard 扩展宿主：仅从本机 config/plugins.local.json 加载已显式启用的本地扩展。
 * 未配置时行为与无扩展一致。
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { aggregateAddonHourlyFromCsv } from './addon-hourly.js';

const API_VERSION = 1;

/**
 * @typedef {object} LoadedPlugin
 * @property {string} id
 * @property {string} root
 * @property {object} manifest
 * @property {object} options
 * @property {object|null} module
 * @property {string|null} loadError
 */

/**
 * @param {string} repoRoot
 * @returns {{ plugins: LoadedPlugin[], configPath: string|null, errors: string[] }}
 */
export async function loadPlugins(repoRoot) {
  const configPath = path.join(repoRoot, 'config', 'plugins.local.json');
  const errors = [];

  if (!fs.existsSync(configPath)) {
    return { plugins: [], configPath: null, errors };
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    errors.push(`无法解析 plugins.local.json: ${e?.message || e}`);
    return { plugins: [], configPath, errors };
  }

  const entries = Array.isArray(cfg?.plugins) ? cfg.plugins : [];
  /** @type {LoadedPlugin[]} */
  const plugins = [];

  for (const entry of entries) {
    const id = String(entry?.id || '').trim();
    if (!id) {
      errors.push('跳过无 id 的插件条目');
      continue;
    }
    if (entry?.enabled !== true) {
      console.log(`[plugins] 跳过未启用: ${id}`);
      continue;
    }

    const rootRaw = String(entry?.root || '').trim();
    if (!rootRaw) {
      errors.push(`插件 ${id}: 缺少 root`);
      continue;
    }
    const root = resolvePluginRoot(repoRoot, rootRaw);
    const manifestPath = path.join(root, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      errors.push(`插件 ${id}: 找不到 manifest.json (${manifestPath})`);
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      errors.push(`插件 ${id}: manifest 无效: ${e?.message || e}`);
      continue;
    }

    const mid = String(manifest.id || id).trim();
    if (mid !== id) {
      errors.push(`插件 ${id}: manifest.id=${mid} 与配置 id 不一致`);
      continue;
    }

    const apiVersion = Number(manifest.apiVersion ?? 0);
    if (apiVersion !== API_VERSION) {
      errors.push(
        `插件 ${id}: apiVersion=${apiVersion} 与宿主 ${API_VERSION} 不兼容`,
      );
      continue;
    }

    /** @type {LoadedPlugin} */
    const loaded = {
      id,
      root,
      manifest,
      options: entry.options && typeof entry.options === 'object' ? entry.options : {},
      module: null,
      loadError: null,
    };

    const serverEntry =
      manifest.entry?.server ||
      (fs.existsSync(path.join(root, 'server.mjs')) ? 'server.mjs' : null);

    if (serverEntry) {
      const abs = path.join(root, serverEntry);
      try {
        loaded.module = await import(pathToFileURL(abs).href);
      } catch (e) {
        loaded.loadError = e?.message || String(e);
        errors.push(`插件 ${id}: 加载 server 失败: ${loaded.loadError}`);
      }
    }

    plugins.push(loaded);
    console.log(
      `[plugins] 已加载 ${id} v${manifest.version || '?'} root=${root}`,
    );
  }

  return { plugins, configPath, errors };
}

function resolvePluginRoot(repoRoot, p) {
  if (p.startsWith('~/')) {
    return path.join(process.env.HOME || '', p.slice(2));
  }
  if (path.isAbsolute(p)) return p;
  return path.resolve(repoRoot, p);
}

/**
 * @param {import('express').Express} app
 * @param {string} repoRoot
 * @param {LoadedPlugin[]} plugins
 */
export async function registerPluginRoutes(app, repoRoot, plugins) {
  const byId = new Map(plugins.map((p) => [p.id, p]));

  app.get('/api/plugins', (_req, res) => {
    res.json({
      ok: true,
      plugins: plugins.map((p) => publicPluginInfo(p)),
    });
  });

  const readPluginJson = (plugin, relKey, defaultRel) => {
    const rel = plugin.manifest.paths?.[relKey] || defaultRel;
    const abs = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      return {
        ok: false,
        status: 404,
        body: {
          ok: false,
          error: `尚无文件: ${rel}`,
          hint: '请先在插件 Tab 点「重新导出」，或触发面板同步',
          path: abs,
        },
      };
    }
    try {
      return {
        ok: true,
        status: 200,
        body: {
          ok: true,
          id: plugin.id,
          path: abs,
          data: JSON.parse(fs.readFileSync(abs, 'utf8')),
        },
      };
    } catch (e) {
      return {
        ok: false,
        status: 500,
        body: {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        },
      };
    }
  };

  app.get('/api/plugins/:id/summary', (req, res) => {
    const plugin = byId.get(req.params.id);
    if (!plugin) {
      return res.status(404).json({
        ok: false,
        error: `插件未启用或不存在: ${req.params.id}`,
        hint: '请在 config/plugins.local.json 中 enabled: true 并重启 dashboard',
      });
    }
    const result = readPluginJson(
      plugin,
      'summaryRel',
      `reports/${plugin.id}-summary.json`,
    );
    return res.status(result.status).json(result.body);
  });

  app.get('/api/plugins/:id/cursor-daily', (req, res) => {
    const plugin = byId.get(req.params.id);
    if (!plugin) {
      return res.status(404).json({
        ok: false,
        error: `插件未启用或不存在: ${req.params.id}`,
      });
    }
    const result = readPluginJson(
      plugin,
      'cursorDailyRel',
      `reports/${plugin.id}-cursor-daily.json`,
    );
    return res.status(result.status).json(result.body);
  });

  app.get('/api/plugins/:id/cursor-summary', (req, res) => {
    const plugin = byId.get(req.params.id);
    if (!plugin) {
      return res.status(404).json({
        ok: false,
        error: `插件未启用或不存在: ${req.params.id}`,
      });
    }
    const result = readPluginJson(
      plugin,
      'cursorSummaryRel',
      `reports/${plugin.id}-cursor-summary.json`,
    );
    return res.status(result.status).json(result.body);
  });

  app.get('/api/plugins/:id/cursor-hourly', async (req, res) => {
    const plugin = byId.get(req.params.id);
    if (!plugin) {
      return res.status(404).json({
        ok: false,
        error: `插件未启用或不存在: ${req.params.id}`,
      });
    }

    const hourlyRel =
      plugin.manifest.paths?.cursorHourlyRel ||
      `reports/${plugin.id}-cursor-hourly.json`;
    const hourlyAbs = path.isAbsolute(hourlyRel)
      ? hourlyRel
      : path.join(repoRoot, hourlyRel);

    // 优先读预聚合 JSON；没有则从 exports/{id}-usage.csv 现场聚
    if (fs.existsSync(hourlyAbs)) {
      try {
        const data = JSON.parse(fs.readFileSync(hourlyAbs, 'utf8'));
        const days = Array.isArray(data) ? data : data.days || [];
        return res.json({
          ok: true,
          id: plugin.id,
          path: hourlyAbs,
          timezone: data.timezone || 'local-wall-clock',
          days,
          source: 'json',
        });
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const csvRel =
      plugin.manifest.paths?.usageCsvRel || `exports/${plugin.id}-usage.csv`;
    const csvAbs = path.isAbsolute(csvRel)
      ? csvRel
      : path.join(repoRoot, csvRel);

    try {
      const t0 = Date.now();
      const agg = await aggregateAddonHourlyFromCsv(csvAbs);
      if (agg.error === 'csv_missing') {
        return res.status(404).json({
          ok: false,
          error: `尚无小时数据（缺少 ${hourlyRel} 与 ${csvRel}）`,
          hint: '请先同步附加源导出 CSV',
        });
      }
      try {
        fs.mkdirSync(path.dirname(hourlyAbs), { recursive: true });
        fs.writeFileSync(
          hourlyAbs,
          `${JSON.stringify(
            {
              generatedAt: agg.generatedAt,
              timezone: agg.timezone,
              sourcePlugin: plugin.id,
              days: agg.days,
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      } catch {
        /* ignore cache write */
      }
      console.log(
        `[plugins] cursor-hourly ${plugin.id} 从 CSV 聚合 days=${agg.days.length} ${Date.now() - t0}ms`,
      );
      return res.json({
        ok: true,
        id: plugin.id,
        path: csvAbs,
        timezone: agg.timezone,
        days: agg.days,
        source: 'csv',
        ms: Date.now() - t0,
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post('/api/plugins/:id/sync', async (req, res) => {
    const plugin = byId.get(req.params.id);
    if (!plugin) {
      return res.status(404).json({
        ok: false,
        error: `插件未启用或不存在: ${req.params.id}`,
      });
    }
    const result = await runPluginSyncStep(plugin, repoRoot);
    const status = result.ok ? 200 : 500;
    return res.status(status).json(result);
  });

  for (const plugin of plugins) {
    if (typeof plugin.module?.register !== 'function') continue;
    const ctx = makePluginContext(plugin, repoRoot);
    try {
      await maybeAwait(plugin.module.register(app, ctx));
      console.log(`[plugins] ${plugin.id}: 已挂载自定义路由`);
    } catch (e) {
      console.warn(
        `[plugins] ${plugin.id}: register 失败: ${e?.message || e}`,
      );
    }
  }
}

/**
 * @param {LoadedPlugin} plugin
 * @param {string} repoRoot
 */
export async function runPluginSyncStep(plugin, repoRoot) {
  const t0 = Date.now();
  const ctx = makePluginContext(plugin, repoRoot);
  if (typeof plugin.module?.syncStep !== 'function') {
    return {
      ok: false,
      id: plugin.id,
      ms: Date.now() - t0,
      error: '插件未实现 syncStep',
    };
  }
  try {
    const out = await plugin.module.syncStep(ctx);
    return {
      ok: true,
      id: plugin.id,
      ms: Date.now() - t0,
      ...(out && typeof out === 'object' ? out : {}),
    };
  } catch (e) {
    return {
      ok: false,
      id: plugin.id,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Cursor 同步成功后，failSoft 跑各插件 syncStep
 * @param {string} repoRoot
 * @param {LoadedPlugin[]} plugins
 */
export async function runEnabledPluginSyncSteps(repoRoot, plugins) {
  const results = [];
  for (const plugin of plugins) {
    const steps = plugin.manifest.contributes?.syncSteps;
    if (!Array.isArray(steps) || !steps.includes('export')) continue;
    if (typeof plugin.module?.syncStep !== 'function') continue;
    const r = await runPluginSyncStep(plugin, repoRoot);
    results.push(r);
    if (r.ok) {
      console.log(`[plugins] syncStep ${plugin.id} ok ${r.ms}ms`);
    } else {
      console.warn(
        `[plugins] syncStep ${plugin.id} 失败（不影响 Cursor 同步）: ${r.error}`,
      );
    }
  }
  return results;
}

/**
 * 读取可合并进 Overview 的插件 cursor-summary 合计（USD / token / 行）。
 * @param {string} repoRoot
 * @param {LoadedPlugin[]} plugins
 */
export function snapshotMergeablePluginTotals(repoRoot, plugins) {
  let rows = 0;
  let tokens = 0;
  let usd = 0;
  /** @type {Record<string, { rows: number, tokens: number, usd: number }>} */
  const byId = {};

  for (const plugin of plugins) {
    const mergeRaw = plugin.manifest.contributes?.mergeIntoOverview;
    const mergeable =
      mergeRaw && (mergeRaw === true || mergeRaw.enabled !== false);
    if (!mergeable) continue;

    const rel =
      plugin.manifest.paths?.cursorSummaryRel ||
      `reports/${plugin.id}-cursor-summary.json`;
    const abs = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      byId[plugin.id] = { rows: 0, tokens: 0, usd: 0 };
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
      const pRows = Number(data.totals?.rows) || 0;
      const pUsd = Number(data.totals?.totalEstimatedUsd) || 0;
      let pTokens = 0;
      if (Array.isArray(data.byModel)) {
        for (const m of data.byModel) {
          const t = m?.tokens || {};
          pTokens +=
            (Number(t.cacheWrite) || 0) +
            (Number(t.noCache) || 0) +
            (Number(t.cacheRead) || 0) +
            (Number(t.output) || 0);
        }
      }
      byId[plugin.id] = { rows: pRows, tokens: pTokens, usd: pUsd };
      rows += pRows;
      tokens += pTokens;
      usd += pUsd;
    } catch {
      byId[plugin.id] = { rows: 0, tokens: 0, usd: 0 };
    }
  }

  return { rows, tokens, usd, byId };
}

/**
 * @param {LoadedPlugin[]} plugins
 */
export function pluginHealthPayload(plugins) {
  return {
    plugins: plugins.map((p) => publicPluginInfo(p)),
  };
}

/**
 * @param {LoadedPlugin} plugin
 */
function publicPluginInfo(plugin) {
  const tabs = Array.isArray(plugin.manifest.contributes?.tabs)
    ? plugin.manifest.contributes.tabs.map((t) => ({
        id: String(t.id || plugin.id),
        label: String(t.label || plugin.manifest.name || plugin.id),
        order: Number(t.order ?? 100),
      }))
    : [
        {
          id: plugin.id,
          label: String(plugin.manifest.name || plugin.id),
          order: 100,
        },
      ];

  const features = Array.isArray(plugin.manifest.contributes?.features)
    ? plugin.manifest.contributes.features.map(String)
    : [plugin.id];

  const mergeRaw = plugin.manifest.contributes?.mergeIntoOverview;
  const mergeIntoOverview =
    mergeRaw && (mergeRaw === true || mergeRaw.enabled !== false)
      ? {
          enabled: true,
          label: String(
            mergeRaw.label || `合并 ${plugin.manifest.name || plugin.id}`,
          ),
          affects: Array.isArray(mergeRaw.affects)
            ? mergeRaw.affects.map(String)
            : ['overview', 'model-details'],
          excludes: Array.isArray(mergeRaw.excludes)
            ? mergeRaw.excludes.map(String)
            : ['reimbursement', 'period-stats'],
        }
      : null;

  return {
    id: plugin.id,
    name: plugin.manifest.name || plugin.id,
    version: plugin.manifest.version || null,
    features,
    tabs,
    mergeIntoOverview,
    loadError: plugin.loadError,
  };
}

/**
 * @param {LoadedPlugin} plugin
 * @param {string} repoRoot
 */
function makePluginContext(plugin, repoRoot) {
  return {
    repoRoot,
    pluginRoot: plugin.root,
    pluginId: plugin.id,
    options: plugin.options,
    paths: {
      exports: path.join(repoRoot, 'exports'),
      reports: path.join(repoRoot, 'reports'),
      data: path.join(repoRoot, 'data'),
      config: path.join(repoRoot, 'config'),
    },
    log(level, msg, meta) {
      const line = meta
        ? `[plugins:${plugin.id}] ${msg} ${JSON.stringify(meta)}`
        : `[plugins:${plugin.id}] ${msg}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    },
  };
}

async function maybeAwait(v) {
  if (v && typeof v.then === 'function') return v;
  return v;
}
