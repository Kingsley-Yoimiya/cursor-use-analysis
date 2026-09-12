export type DataMode = 'local' | 'static' | 'fixture'

const STORAGE_FORCE = 'cursor-dashboard-data-mode'

let current: DataMode = 'static'

export function getDataMode(): DataMode {
  return current
}

export function setDataMode(mode: DataMode) {
  current = mode
}

export function isBrowserDataMode(mode: DataMode = current): boolean {
  return mode === 'static' || mode === 'fixture'
}

function urlForcedMode(): DataMode | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const demo = q.get('demo')
  const mode = q.get('mode')
  if (demo === '1' || demo === 'true' || mode === 'fixture') return 'fixture'
  if (mode === 'static') return 'static'
  if (mode === 'local') return 'local'
  return null
}

export function forcedModeFromEnv(): DataMode | null {
  const fromUrl = urlForcedMode()
  if (fromUrl) return fromUrl
  const v = import.meta.env.VITE_DATA_MODE
  if (v === 'fixture') return 'fixture'
  if (v === 'static') return 'static'
  if (v === 'local') return 'local'
  try {
    const stored = localStorage.getItem(STORAGE_FORCE)
    if (stored === 'fixture' || stored === 'static' || stored === 'local') {
      return stored
    }
  } catch {
    /* ignore */
  }
  return null
}

export async function probeLocalApi(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), 2500)
    const r = await fetch('/api/health', {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    window.clearTimeout(t)
    if (!r.ok) return false
    const data = (await r.json()) as { ok?: boolean; features?: string[] }
    return Boolean(data?.ok && Array.isArray(data.features))
  } catch {
    return false
  }
}
