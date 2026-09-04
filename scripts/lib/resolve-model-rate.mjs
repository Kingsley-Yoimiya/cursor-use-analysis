/**
 * 将 CSV / 控制台 / 附加源映射后的 Model 字符串解析到 config/model-rates.json 的费率档。
 *
 * 顺序：
 * 1. 精确 aliases / models
 * 2. 去掉 cursor- / new- 前缀后再查
 * 3. 剥企业代理后缀（joybuilder / oxygen）
 * 4. Claude 语序与版本点/横杠变体（claude-haiku-4-5 ↔ claude-4.5-haiku 等）
 * 5. 短名（sonnet-5 → claude-sonnet-5）
 * 6. 把 `*-{effort}-fast` / `*-fast-{effort}` 收成 `*-fast`（含去 cursor-/new- 前缀后的名字）
 * 7. 逐段剥掉 effort / thinking / preview（绝不把 fast 剥成非 fast，以免低估）
 */

const EFFORT_SUFFIXES = new Set(['high', 'medium', 'low', 'xhigh', 'max', 'ultra']);
const STRIP_SUFFIXES = new Set([...EFFORT_SUFFIXES, 'thinking', 'preview']);
/** 企业代理零售名后缀；与 DongCC model-map stripSuffixes 对齐 */
const ENTERPRISE_SUFFIXES = ['-joybuilder', '-oxygen'];

/**
 * @param {string} key
 * @param {any} ratesConfig
 * @returns {{ kind: 'auto'|'model'|'unknown', rate: object|null, resolvedKey: string }|null}
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
 * 版本段点/横杠互换：4-5 ↔ 4.5；4-8 ↔ 4.8
 * @param {string} ver
 * @returns {string[]}
 */
function versionSpellings(ver) {
  const out = new Set([ver]);
  if (ver.includes('.')) out.add(ver.replace(/\./g, '-'));
  if (ver.includes('-')) out.add(ver.replace(/-/g, '.'));
  return [...out];
}

/**
 * Claude 命名变体：语序、版本分隔、Sonnet 5 特例、短名。
 * @param {string} key
 * @param {(k: string) => void} push
 */
function pushClaudeVariants(key, push) {
  // claude-{family}-{ver}（API/企业常见：claude-haiku-4-5、claude-opus-4-8）
  let m = key.match(
    /^claude-(sonnet|haiku|opus|fable)-(\d+(?:[.-]\d+)*)$/,
  );
  if (m) {
    const family = m[1];
    const ver = m[2];
    for (const v of versionSpellings(ver)) {
      push(`claude-${family}-${v.replace(/\./g, '-')}`);
      push(`claude-${v}-${family}`);
      // 主版本 5 / 5.0：claude-sonnet-5 / claude-fable-5 / claude-opus-5
      if (/^5(?:[.-]0)?$/.test(v)) {
        push(`claude-${family}-5`);
      }
    }
  }

  // claude-{ver}-{family}（Cursor 常见：claude-4.5-haiku、claude-4.6-sonnet）
  m = key.match(/^claude-(\d+(?:[.-]\d+)*)-(sonnet|haiku|opus|fable)$/);
  if (m) {
    const ver = m[1];
    const family = m[2];
    for (const v of versionSpellings(ver)) {
      push(`claude-${v}-${family}`);
      push(`claude-${family}-${v.replace(/\./g, '-')}`);
      if (/^5(?:[.-]0)?$/.test(v)) {
        push(`claude-${family}-5`);
      }
    }
  }

  // 短名：sonnet-5 / opus-5 / haiku-4.5
  m = key.match(/^(sonnet|haiku|opus|fable)-(\d+(?:[.-]\d+)*)$/);
  if (m) {
    const family = m[1];
    const ver = m[2];
    for (const v of versionSpellings(ver)) {
      push(`claude-${family}-${v.replace(/\./g, '-')}`);
      push(`claude-${v}-${family}`);
      if (/^5(?:[.-]0)?$/.test(v)) {
        push(`claude-${family}-5`);
      }
    }
  }

  // claude-opus 版本点写法：claude-opus-4.8 → claude-opus-4-8；claude-opus-5.0 → claude-opus-5
  m = key.match(/^claude-opus-(\d+(?:[.-]\d+)*)$/);
  if (m) {
    for (const v of versionSpellings(m[1])) {
      push(`claude-opus-${v.replace(/\./g, '-')}`);
      if (/^5(?:[.-]0)?$/.test(v)) push('claude-opus-5');
    }
  }
}

/**
 * 收拢 Fast + effort 语序，并去掉 cursor-/new- 前缀。
 * 否则 `cursor-grok-4.6-high-fast` 只会得到 `cursor-grok-4.6-fast`，
 * 撞不上 `models["grok-4.6-fast"]`。
 * @param {string} key
 * @param {(k: string) => void} push
 */
function foldFastEffort(key, push) {
  const emit = (folded) => {
    push(folded);
    for (const prefix of ['cursor-', 'new-']) {
      if (folded.startsWith(prefix)) push(folded.slice(prefix.length));
    }
  };
  let m = key.match(/^(.*)-(high|medium|low|xhigh|max|ultra)-fast$/);
  if (m) emit(`${m[1]}-fast`);
  m = key.match(/^(.*)-fast-(high|medium|low|xhigh|max|ultra)$/);
  if (m) emit(`${m[1]}-fast`);
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

  // 企业代理后缀
  let base = key;
  for (const suf of ENTERPRISE_SUFFIXES) {
    if (base.endsWith(suf)) {
      base = base.slice(0, -suf.length);
      push(base);
      break;
    }
  }

  pushClaudeVariants(key, push);
  if (base !== key) pushClaudeVariants(base, push);

  foldFastEffort(key, push);
  if (base !== key) foldFastEffort(base, push);
  for (const prefix of ['cursor-', 'new-']) {
    if (key.startsWith(prefix)) foldFastEffort(key.slice(prefix.length), push);
  }

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
    for (const suf of ENTERPRISE_SUFFIXES) {
      if (cur.endsWith(suf)) push(cur.slice(0, -suf.length));
    }
    pushClaudeVariants(cur, push);
    foldFastEffort(cur, push);
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
  const rk = String(resolvedKey || '');
  if (
    rk.includes('composer') ||
    rk.startsWith('grok-4.5') ||
    rk.startsWith('grok-4.6')
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
