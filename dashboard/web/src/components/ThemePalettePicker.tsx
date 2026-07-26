/**
 * 配色主题选择器：色块预览 + 下拉
 */
import { useEffect, useRef, useState } from 'react'
import {
  PALETTE_OPTIONS,
  useTheme,
  type ThemePalette,
} from '../context/ThemeContext'

const PREVIEW: Record<
  ThemePalette,
  { light: [string, string, string]; dark: [string, string, string] }
> = {
  default: {
    light: ['#f8fafc', '#ffffff', '#059669'],
    dark: ['#020617', '#0f172a', '#34d399'],
  },
  nord: {
    light: ['#eceff4', '#e5e9f0', '#5e81ac'],
    dark: ['#2e3440', '#3b4252', '#88c0d0'],
  },
  catppuccin: {
    light: ['#eff1f5', '#e6e9ef', '#8839ef'],
    dark: ['#1e1e2e', '#313244', '#cba6f7'],
  },
  matcha: {
    light: ['#f4f7ef', '#eef3e6', '#5a8f3c'],
    dark: ['#1a2118', '#2a3526', '#a8d080'],
  },
}

export function ThemePalettePicker() {
  const { palette, setPalette, isDark } = useTheme()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = PALETTE_OPTIONS.find((o) => o.id === palette)!
  const dots = PREVIEW[palette][isDark ? 'dark' : 'light']

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ui-press flex items-center gap-2 h-8 rounded-full border-0 bg-transparent px-2.5
          text-fg-muted hover:bg-surface hover:text-fg"
        title="切换配色主题"
        aria-label="切换配色主题"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="flex items-center gap-0.5" aria-hidden>
          {dots.map((c) => (
            <span
              key={c}
              className="inline-block h-2.5 w-2.5 rounded-full border border-line"
              style={{ backgroundColor: c }}
            />
          ))}
        </span>
        <span className="text-xs font-medium text-fg hidden sm:inline">
          {current.label}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 mt-1.5 w-52 border border-line bg-elevated p-1 z-50"
          style={{ borderRadius: 'var(--radius-md)' }}
        >
          {PALETTE_OPTIONS.map((opt) => {
            const preview = PREVIEW[opt.id][isDark ? 'dark' : 'light']
            const active = opt.id === palette
            return (
              <li key={opt.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setPalette(opt.id)
                    setOpen(false)
                  }}
                  className={`ui-press w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left
                    ${active ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}
                  style={{ borderRadius: 'var(--radius-sm)' }}
                >
                  <span className="flex items-center gap-0.5 shrink-0" aria-hidden>
                    {preview.map((c) => (
                      <span
                        key={c}
                        className="inline-block h-3 w-3 rounded-full border border-line"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-fg">
                      {opt.label}
                    </span>
                    <span className="block text-[10px] text-fg-faint truncate">
                      {opt.hint}
                    </span>
                  </span>
                  {active && (
                    <span className="ml-auto text-accent text-xs">✓</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
