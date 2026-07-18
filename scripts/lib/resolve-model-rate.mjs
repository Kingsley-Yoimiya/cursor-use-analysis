/**
 * 将 CSV / 控制台里的 Model 字符串解析到 config/model-rates.json 的费率档。
 *
 * 顺序：
 * 1. 精确 aliases / models
 * 2. 去掉 cursor- / new- 前缀后再查
 * 3. 把 `*-{effort}-fast` / `*-fast-{effort}` 收成 `*-fast`
 * 4. 逐段剥掉 effort / thinking / preview（绝不把 fast 剥成非 fast，以免低估）
 */

const EFFORT_SUFFIXES = new Set(['high', 'medium', 'low', 'xhigh', 'max', 'ultra']);
const STRIP_SUFFIXES = new Set([...EFFORT_SUFFIXES, 'thinking', 'preview']);

/**
 * @param {string} key
 * @param {any} ratesConfig
 * @returns {{ kind: 'auto'|'model'|'unknown', rate: object|null, resolvedKey: string }}
 */
function lookupExact(key, ratesConfig) {
  if (!key) return null;

  if (key === 'auto' || ratesConfig.aliases?.[key] === 'auto') {
    return { kind: 'auto', rate: ratesConfig.autoPool, resolvedKey: 'auto' };
  }

  const canonical = ratesConfig.aliases?.[key] || key;
  if (canonical === 'auto') {
    return { kind: 'auto', rate: ratesConfig.autoPool, resolvedKey: 'auto' };
  }

  const modelRate = ratesConfig.models?.[canonical];
  if (modelRate) {
    return { kind: 'model', rate: modelRate, resolvedKey: canonical };
  }
  return null;
}

/**
 * @param {string} key
 * @returns {string[]}
 */
function expandCandidates(key) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  const push = (k) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };

  push(key);

  for (const prefix of ['cursor-', 'new-']) {
    if (key.startsWith(prefix)) push(key.slice(prefix.length));
  }

  // effort 在 fast 前：grok-4.5-high-fast → grok-4.5-fast
  let m = key.match(
    /^(.*)-(high|medium|low|xhigh|max|ultra)-fast$/,
  );
  if (m) push(`${m[1]}-fast`);

  // fast 在 effort 前：grok-4.5-fast-high → grok-4.5-fast
  m = key.match(/^(.*)-fast-(high|medium|low|xhigh|max|ultra)$/);
  if (m) push(`${m[1]}-fast`);

  // 逐段剥 effort / thinking / preview（保留 -fast）
  let cur = key;
  while (true) {
    const parts = cur.split('-');
    if (parts.length < 2) break;
    const last = parts[parts.length - 1];
    if (!STRIP_SUFFIXES.has(last)) break;
    cur = parts.slice(0, -1).join('-');
    push(cur);
    for (const prefix of ['cursor-', 'new-']) {
      if (cur.startsWith(prefix)) push(cur.slice(prefix.length));
    }
    const fm = cur.match(
      /^(.*)-(high|medium|low|xhigh|max|ultra)-fast$/,
    );
    if (fm) push(`${fm[1]}-fast`);
  }

  return out;
}

/**
 * @param {string} modelRaw
 * @param {any} ratesConfig
 * @returns {{ kind: 'auto'|'model'|'unknown', rate: object|null, resolvedKey: string }}
 */
export function resolveRateForModel(modelRaw, ratesConfig) {
  if (!ratesConfig) {
    return { kind: 'unknown', rate: null, resolvedKey: '' };
  }

  const key = String(modelRaw || '')
    .trim()
    .toLowerCase();
  if (!key) return { kind: 'unknown', rate: null, resolvedKey: '' };

  for (const candidate of expandCandidates(key)) {
    const hit = lookupExact(candidate, ratesConfig);
    if (hit) return hit;
  }

  return { kind: 'unknown', rate: null, resolvedKey: key };
}

/**
 * @returns {'Auto'|'FirstParty'|'API'}
 */
export function classifyPool(kind, resolvedKey, rate) {
  if (kind === 'auto') return 'Auto';
  if (rate?.billingPool === 'firstParty') return 'FirstParty';
  // 兼容未标 billingPool 的旧配置
  if (
    String(resolvedKey || '').includes('composer') ||
    String(resolvedKey || '').startsWith('grok-4.5')
  ) {
    return 'FirstParty';
  }
  return 'API';
}

/** Auto 与 First-party 模型豁免 Teams Cursor Token Rate */
export function isTeamsCtrExempt(kind, rate) {
  if (kind === 'auto') return true;
  if (rate?.billingPool === 'firstParty') return true;
  return false;
}
