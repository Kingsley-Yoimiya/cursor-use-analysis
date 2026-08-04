/**
 * 多 Cursor 账号（Profile）注册表：路径解析、邮箱解析、增删改。
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const PROFILES_REL = 'config/profiles.json';
const IDENTITY_CACHE_DIR = 'data/profile-identity';
const EXPORT_START_MS = '1767225600000'; // 2026-01-01 UTC，与 package.json export 一致

const ID_RE = /^[a-z][a-z0-9_-]{1,31}$/;

function profilesConfigPath(repoRoot) {
  return path.join(repoRoot, PROFILES_REL);
}

function identityCachePath(repoRoot, id) {
  return path.join(repoRoot, IDENTITY_CACHE_DIR, `${id}.json`);
}

function syncStatusPath(repoRoot, profileId) {
  if (!profileId || profileId === 'default') {
    return path.join(repoRoot, 'data', 'dashboard-sync.json');
  }
  return path.join(repoRoot, 'data', `dashboard-sync-${profileId}.json`);
}

function defaultProfilesDoc() {
  return {
    version: 1,
    activeForSync: 'default',
    profiles: [
      {
        id: 'default',
        label: '主账号',
        legacy: true,
        authPath: 'data/auth.json',
        browserProfile: 'data/browser-profile',
        usageCsv: 'exports/usage.csv',
        estimateJson: 'reports/estimate.json',
      },
    ],
  };
}

function abs(repoRoot, rel) {
  return path.resolve(repoRoot, rel);
}

/**
 * 确保 config/profiles.json 存在；缺省时登记 legacy default。
 */
export function ensureProfilesConfig(repoRoot) {
  const p = profilesConfigPath(repoRoot);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const doc = defaultProfilesDoc();
    fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    return doc;
  }
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(doc.profiles) || doc.profiles.length === 0) {
      const fallback = defaultProfilesDoc();
      fs.writeFileSync(p, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
      return fallback;
    }
    if (!doc.activeForSync) doc.activeForSync = doc.profiles[0].id;
    return doc;
  } catch (e) {
    console.warn(`[profiles] 无法解析 profiles.json，重建默认: ${e?.message}`);
    const doc = defaultProfilesDoc();
    fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    return doc;
  }
}

export function writeProfilesConfig(repoRoot, doc) {
  const p = profilesConfigPath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return doc;
}

export function resolveProfile(repoRoot, profile) {
  return {
    ...profile,
    paths: {
      auth: abs(repoRoot, profile.authPath),
      browserProfile: abs(
        repoRoot,
        profile.browserProfile || `data/profiles/${profile.id}/browser-profile`,
      ),
      usageCsv: abs(repoRoot, profile.usageCsv),
      estimateJson: abs(repoRoot, profile.estimateJson),
      syncStatus: syncStatusPath(repoRoot, profile.id),
    },
  };
}

export function getProfileById(repoRoot, id) {
  const doc = ensureProfilesConfig(repoRoot);
  const raw = doc.profiles.find((p) => p.id === id);
  if (!raw) return null;
  return resolveProfile(repoRoot, raw);
}

export function listResolvedProfiles(repoRoot) {
  const doc = ensureProfilesConfig(repoRoot);
  return {
    activeForSync: doc.activeForSync || doc.profiles[0]?.id || 'default',
    profiles: doc.profiles.map((p) => resolveProfile(repoRoot, p)),
  };
}

/**
 * 从 ?profiles=a,b 或 body.profiles 解析；缺省 = 全部已登记身份。
 * @returns {{ ok: true, profiles: object[] } | { ok: false, error: string }}
 */
export function resolveRequestedProfiles(repoRoot, raw) {
  const { profiles: all } = listResolvedProfiles(repoRoot);
  if (all.length === 0) {
    return { ok: false, error: '没有已登记身份' };
  }
  let ids = null;
  if (typeof raw === 'string' && raw.trim()) {
    ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(raw) && raw.length > 0) {
    ids = raw.map(String);
  }
  if (!ids || ids.length === 0) {
    return { ok: true, profiles: all };
  }
  const out = [];
  for (const id of ids) {
    const p = all.find((x) => x.id === id);
    if (!p) return { ok: false, error: `未知身份: ${id}` };
    out.push(p);
  }
  return { ok: true, profiles: out };
}

export function fileMeta(filePath) {
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

/**
 * 解析 auth.json 中的会话 JWT：过期时间 + workos user id。
 */
export function parseAuthSession(authPath) {
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
    const sub = payload.sub ? String(payload.sub) : null;
    const workosId = sub?.includes('|') ? sub.split('|').pop() : sub;
    if (!payload.exp) {
      return { sub, workosId, expMs: null, expIso: null, expired: null };
    }
    return {
      sub,
      workosId,
      expMs: payload.exp * 1000,
      expIso: new Date(payload.exp * 1000).toISOString(),
      expired: Date.now() > payload.exp * 1000,
    };
  } catch {
    return null;
  }
}

function readCookieValue(authPath, name) {
  try {
    const state = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const c = (state.cookies ?? []).find((x) => x.name === name);
    return c?.value ? String(c.value) : null;
  } catch {
    return null;
  }
}

function httpGetJson(url, headers, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`非 JSON 响应: ${body.slice(0, 120)}`));
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 调用 Cursor GET /api/auth/me 解出邮箱。
 */
export async function fetchCursorAuthMe(authPath) {
  const token = readCookieValue(authPath, 'WorkosCursorSessionToken');
  if (!token) return null;
  const data = await httpGetJson('https://cursor.com/api/auth/me', {
    Cookie: `WorkosCursorSessionToken=${token}`,
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Origin: 'https://cursor.com',
    Referer: 'https://cursor.com/dashboard',
  });
  return {
    email: data?.email ? String(data.email) : null,
    name: data?.name ? String(data.name) : null,
    sub: data?.sub ? String(data.sub) : null,
    id: data?.id ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

function readIdentityCache(repoRoot, id) {
  const p = identityCachePath(repoRoot, id);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeIdentityCache(repoRoot, id, data) {
  const p = identityCachePath(repoRoot, id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

/**
 * 尽量拿到邮箱：缓存优先；auth 更新或强制刷新时打 /api/auth/me。
 */
export async function resolveProfileIdentity(
  repoRoot,
  profile,
  { force = false, allowNetwork = true } = {},
) {
  const authMeta = fileMeta(profile.paths.auth);
  const cached = readIdentityCache(repoRoot, profile.id);
  const authMtime = authMeta.mtimeMs || 0;
  const cacheFresh =
    cached?.email &&
    cached.authMtimeMs === authMtime &&
    !force;

  if (cacheFresh) {
    return {
      email: cached.email,
      name: cached.name || null,
      sub: cached.sub || null,
      source: 'cache',
      fetchedAt: cached.fetchedAt || null,
    };
  }

  if (!authMeta.exists || !allowNetwork) {
    return {
      email: cached?.email || null,
      name: cached?.name || null,
      sub: cached?.sub || null,
      source: cached?.email ? 'cache-stale' : 'none',
      fetchedAt: cached?.fetchedAt || null,
    };
  }

  try {
    const me = await fetchCursorAuthMe(profile.paths.auth);
    if (me?.email) {
      writeIdentityCache(repoRoot, profile.id, {
        ...me,
        authMtimeMs: authMtime,
      });
      return {
        email: me.email,
        name: me.name,
        sub: me.sub,
        source: 'auth/me',
        fetchedAt: me.fetchedAt,
      };
    }
  } catch (e) {
    console.warn(
      `[profiles] ${profile.id} 拉取邮箱失败: ${e?.message || e}`,
    );
  }

  return {
    email: cached?.email || null,
    name: cached?.name || null,
    sub: cached?.sub || null,
    source: cached?.email ? 'cache-fallback' : 'none',
    fetchedAt: cached?.fetchedAt || null,
  };
}

function readSyncStatusFile(statusPath) {
  if (!fs.existsSync(statusPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    return null;
  }
}

export function loginHintForProfile(profile) {
  const authRel = profile.authPath;
  const browserRel =
    profile.browserProfile || `data/profiles/${profile.id}/browser-profile`;
  return {
    login: `npm run login -- --auth ${authRel} --profile ${browserRel} --chrome`,
    export: `npm run export -- --auth ${authRel} --out ${profile.usageCsv}`,
    estimate: `npm run estimate-cost -- --in ${profile.usageCsv} --out ${profile.estimateJson}`,
  };
}

/**
 * 列表 API 用：含文件状态、会话、邮箱、登录指引。
 */
export async function enrichProfilesForApi(
  repoRoot,
  { refreshEmail = false } = {},
) {
  const { activeForSync, profiles } = listResolvedProfiles(repoRoot);
  const enriched = [];
  for (const p of profiles) {
    const session = parseAuthSession(p.paths.auth);
    const identity = await resolveProfileIdentity(repoRoot, p, {
      force: refreshEmail,
      allowNetwork: true,
    });
    const displayName =
      identity.email ||
      identity.name ||
      p.label ||
      p.id;
    enriched.push({
      id: p.id,
      label: p.label || p.id,
      displayName,
      email: identity.email,
      name: identity.name,
      legacy: Boolean(p.legacy),
      paths: {
        authPath: p.authPath,
        usageCsv: p.usageCsv,
        estimateJson: p.estimateJson,
        browserProfile: p.browserProfile,
      },
      files: {
        authJson: fileMeta(p.paths.auth),
        usageCsv: fileMeta(p.paths.usageCsv),
        estimateJson: fileMeta(p.paths.estimateJson),
      },
      session,
      identitySource: identity.source,
      lastSync: readSyncStatusFile(p.paths.syncStatus),
      loginHint: loginHintForProfile(p),
      hasData: fileMeta(p.paths.usageCsv).exists,
    });
  }
  return { activeForSync, profiles: enriched };
}

export function createProfile(repoRoot, { id, label } = {}) {
  const normalized = String(id || '')
    .trim()
    .toLowerCase();
  if (!ID_RE.test(normalized)) {
    return {
      ok: false,
      error:
        '身份 id 需为 2–32 位小写字母开头，仅含 a-z / 0-9 / _ / -（例如 alt、work）',
    };
  }
  if (normalized === 'default') {
    return { ok: false, error: 'default 为保留身份，不可新建' };
  }

  const doc = ensureProfilesConfig(repoRoot);
  if (doc.profiles.some((p) => p.id === normalized)) {
    return { ok: false, error: `身份已存在: ${normalized}` };
  }

  const entry = {
    id: normalized,
    label: (label && String(label).trim()) || normalized,
    legacy: false,
    authPath: `data/profiles/${normalized}/auth.json`,
    browserProfile: `data/profiles/${normalized}/browser-profile`,
    usageCsv: `exports/profiles/${normalized}/usage.csv`,
    estimateJson: `reports/profiles/${normalized}/estimate.json`,
  };

  fs.mkdirSync(abs(repoRoot, path.dirname(entry.authPath)), { recursive: true });
  fs.mkdirSync(abs(repoRoot, path.dirname(entry.usageCsv)), { recursive: true });
  fs.mkdirSync(abs(repoRoot, path.dirname(entry.estimateJson)), {
    recursive: true,
  });

  doc.profiles.push(entry);
  writeProfilesConfig(repoRoot, doc);

  const resolved = resolveProfile(repoRoot, entry);
  return {
    ok: true,
    profile: {
      id: resolved.id,
      label: resolved.label,
      paths: {
        authPath: resolved.authPath,
        usageCsv: resolved.usageCsv,
        estimateJson: resolved.estimateJson,
        browserProfile: resolved.browserProfile,
      },
      loginHint: loginHintForProfile(resolved),
    },
  };
}

export function setActiveForSync(repoRoot, profileId) {
  const doc = ensureProfilesConfig(repoRoot);
  if (!doc.profiles.some((p) => p.id === profileId)) {
    return { ok: false, error: `未知身份: ${profileId}` };
  }
  doc.activeForSync = profileId;
  writeProfilesConfig(repoRoot, doc);
  return { ok: true, activeForSync: profileId };
}

export function patchProfile(repoRoot, profileId, { label } = {}) {
  const doc = ensureProfilesConfig(repoRoot);
  const idx = doc.profiles.findIndex((p) => p.id === profileId);
  if (idx < 0) return { ok: false, error: `未知身份: ${profileId}` };
  if (label != null && String(label).trim()) {
    doc.profiles[idx].label = String(label).trim();
  }
  writeProfilesConfig(repoRoot, doc);
  return { ok: true, profile: resolveProfile(repoRoot, doc.profiles[idx]) };
}

export { EXPORT_START_MS, syncStatusPath, profilesConfigPath };
