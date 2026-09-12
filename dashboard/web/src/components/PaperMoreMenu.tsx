import { useEffect, useRef, useState, type ReactNode } from 'react'

export function PaperMoreMenu({ children }: { children: ReactNode }) {
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost"
        aria-expanded={open}
        aria-haspopup="true"
      >
        更多
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1.5 w-72 border border-line bg-elevated p-3 z-50 space-y-3"
          style={{ borderRadius: 'var(--radius-md)' }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
