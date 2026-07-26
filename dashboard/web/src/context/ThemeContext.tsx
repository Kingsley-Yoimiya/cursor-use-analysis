import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeMode = 'light' | 'dark'
export type ThemePalette = 'default' | 'nord' | 'catppuccin' | 'matcha'

export const PALETTE_OPTIONS: {
  id: ThemePalette
  label: string
  hint: string
}[] = [
  { id: 'default', label: '默认', hint: 'Slate + Emerald' },
  { id: 'nord', label: 'Nord', hint: '北极蓝灰' },
  { id: 'catppuccin', label: 'Catppuccin', hint: 'Latte / Mocha' },
  { id: 'matcha', label: '抹茶', hint: 'Matcha' },
]

const STORAGE_KEY = 'cursor-dashboard-theme-v2'
const LEGACY_KEY = 'cursor-dashboard-theme'

interface StoredTheme {
  mode: ThemeMode
  palette: ThemePalette
}

interface ThemeContextValue {
  mode: ThemeMode
  palette: ThemePalette
  isDark: boolean
  setMode: (mode: ThemeMode) => void
  setPalette: (palette: ThemePalette) => void
  toggleMode: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isPalette(v: unknown): v is ThemePalette {
  return (
    v === 'default' || v === 'nord' || v === 'catppuccin' || v === 'matcha'
  )
}

function isMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark'
}

function readStored(): StoredTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredTheme>
      if (isMode(parsed.mode) && isPalette(parsed.palette)) {
        return { mode: parsed.mode, palette: parsed.palette }
      }
    }
  } catch {
    /* ignore */
  }
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy === 'light' || legacy === 'dark') {
    return { mode: legacy, palette: 'default' }
  }
  return { mode: 'dark', palette: 'default' }
}

function applyDom(mode: ThemeMode, palette: ThemePalette) {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.dataset.palette = palette
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredTheme>(() => {
    const initial = readStored()
    applyDom(initial.mode, initial.palette)
    return initial
  })

  useEffect(() => {
    applyDom(stored.mode, stored.palette)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }, [stored])

  const setMode = useCallback((mode: ThemeMode) => {
    setStored((s) => ({ ...s, mode }))
  }, [])

  const setPalette = useCallback((palette: ThemePalette) => {
    setStored((s) => ({ ...s, palette }))
  }, [])

  const toggleMode = useCallback(() => {
    setStored((s) => ({
      ...s,
      mode: s.mode === 'dark' ? 'light' : 'dark',
    }))
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: stored.mode,
      palette: stored.palette,
      isDark: stored.mode === 'dark',
      setMode,
      setPalette,
      toggleMode,
    }),
    [stored, setMode, setPalette, toggleMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return ctx
}

/** @deprecated 兼容旧图表；请优先用 useTheme / useChartColors */
export function useIsDark(): boolean {
  const ctx = useContext(ThemeContext)
  return ctx?.isDark ?? true
}

/** 读取当前主题下的图表色（随 palette / mode 变化） */
export function useChartColors() {
  const { mode, palette } = useTheme()
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement)
    const get = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback
    return {
      grid: get('--chart-grid', '#e2e8f0'),
      tick: get('--chart-tick', '#94a3b8'),
      cursor: get('--chart-cursor', '#e2e8f055'),
      chart1: get('--chart-1', '#10b981'),
      chart2: get('--chart-2', '#3b82f6'),
      chart3: get('--chart-3', '#22c55e'),
      chart4: get('--chart-4', '#f97316'),
      chart5: get('--chart-5', '#a78bfa'),
      poolAuto: get('--pool-auto', '#f59e0b'),
      poolFirst: get('--pool-first', '#8b5cf6'),
      poolApi: get('--pool-api', '#06b6d4'),
      accent: get('--accent', '#10b981'),
      surface: get('--bg-elevated', '#ffffff'),
      border: get('--border', '#e2e8f0'),
      fg: get('--fg', '#0f172a'),
      muted: get('--fg-muted', '#64748b'),
    }
    // mode/palette 变化时强制重读 CSS 变量
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, palette])
}
