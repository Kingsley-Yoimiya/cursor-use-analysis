/**
 * 论文主题 Figure：第一眼论断，第二眼口径名，展开后才是分项。
 */
import { useEffect, useState, type ReactNode } from 'react'

export function PaperFigure({
  thesis,
  kicker,
  lede,
  children,
  details,
  detailsLabel = '分项与字段',
  defaultOpen = true,
  storageKey,
  compact,
  className = '',
}: {
  thesis: string
  kicker?: string
  lede?: string
  children?: ReactNode
  details?: ReactNode
  detailsLabel?: string
  defaultOpen?: boolean
  storageKey?: string
  compact?: boolean
  className?: string
}) {
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
    <section
      className={`paper-figure ${compact ? 'paper-figure-compact' : ''} ${className}`.trim()}
    >
      <div className="paper-figure-head">
        <h2 className="paper-thesis">{thesis}</h2>
        {kicker && <p className="paper-kicker">{kicker}</p>}
      </div>
      {lede && <p className="paper-lede">{lede}</p>}
      {children ? <div className="paper-figure-body">{children}</div> : null}
      {details != null && (
        <div className="mt-4">
          <button
            type="button"
            className="paper-details-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? '收起' : detailsLabel}
          </button>
          {open ? <div className="mt-3">{details}</div> : null}
        </div>
      )}
    </section>
  )
}
