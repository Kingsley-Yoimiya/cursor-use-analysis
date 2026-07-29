/**
 * 可折叠区块：标题行可点击展开/收起，状态可持久化到 localStorage
 */
import { useEffect, useState, type ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  storageKey?: string
  defaultOpen?: boolean
  hint?: string
  children: ReactNode
}

export function CollapsibleSection({
  title,
  storageKey,
  defaultOpen = true,
  hint,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw === '0') return false
      if (raw === '1') return true
    } catch {
      /* ignore */
    }
    return defaultOpen
  })

  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [open, storageKey])

  return (
    <section className="space-y-3">
      <button
        type="button"
        className="group flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center text-fg-muted transition-transform duration-150 ${
            open ? 'rotate-90' : ''
          }`}
          aria-hidden
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
        <h2 className="section-title !mb-0 group-hover:text-accent transition-colors">
          {title}
        </h2>
        {hint && (
          <span className="ml-auto text-[11px] text-fg-faint font-mono hidden sm:inline">
            {open ? '收起' : hint}
          </span>
        )}
        {!hint && (
          <span className="ml-auto text-[11px] text-fg-faint font-mono hidden sm:inline">
            {open ? '收起' : '展开'}
          </span>
        )}
      </button>
      {open ? <div className="space-y-6">{children}</div> : null}
    </section>
  )
}
