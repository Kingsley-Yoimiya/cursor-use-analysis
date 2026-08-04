/**
 * 右上角身份面板：勾选汇总身份、添加身份、复制 login 命令、按身份同步。
 */
import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { useProfiles, type ProfileInfo } from '../context/ProfilesContext'

function formatRelativeTime(iso?: string | null) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return '刚刚'
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

function statusLabel(p: ProfileInfo) {
  if (!p.files?.authJson?.exists) return { text: '未登录', tone: 'warn' as const }
  if (p.session?.expired) return { text: '会话过期', tone: 'warn' as const }
  if (!p.hasData) return { text: '无数据', tone: 'muted' as const }
  return { text: '就绪', tone: 'ok' as const }
}

export function ProfileSwitcher({
  onSynced,
}: {
  onSynced?: () => void
}) {
  const {
    profiles,
    selectedIds,
    toggleSelected,
    refreshProfiles,
    loading,
    error,
  } = useProfiles()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newId, setNewId] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selectedProfiles = profiles.filter((p) => selectedIds.includes(p.id))
  const triggerLabel =
    selectedProfiles.length === 0
      ? '身份'
      : selectedProfiles.length === 1
        ? selectedProfiles[0].email || selectedProfiles[0].displayName
        : `汇总 ${selectedProfiles.length} 个`

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1600)
    } catch {
      setBanner('复制失败，请手动选中命令')
    }
  }

  const handleAdd = async () => {
    setAddError(null)
    try {
      const r = await axios.post<{
        ok: boolean
        error?: string
        profile?: { id: string; loginHint?: { login: string } }
      }>('/api/profiles', {
        id: newId.trim(),
        label: newLabel.trim() || undefined,
      })
      if (!r.data.ok) {
        setAddError(r.data.error || '添加失败')
        return
      }
      setAdding(false)
      setNewId('')
      setNewLabel('')
      await refreshProfiles()
      const hint = r.data.profile?.loginHint?.login
      if (hint) {
        setBanner(`已添加。请在项目根目录执行：\n${hint}`)
        await copyText(hint, `login-${r.data.profile?.id}`)
      }
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleSync = async (id: string) => {
    setSyncingId(id)
    setBanner(null)
    try {
      const r = await axios.post<{
        ok: boolean
        hint?: string
        error?: string
        ms?: number
      }>('/api/sync', { profileId: id }, { timeout: 200_000 })
      if (!r.data.ok) {
        setBanner(r.data.hint || r.data.error || '同步失败')
      } else {
        setBanner(`同步完成（${Math.round((r.data.ms || 0) / 1000)}s）`)
        await refreshProfiles({ refreshEmail: true })
        onSynced?.()
      }
    } catch (e) {
      setBanner(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncingId(null)
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ui-press inline-flex items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 py-1.5 text-xs text-fg hover:bg-surface max-w-[14rem]"
        title="选择计入汇总的 Cursor 身份"
        aria-expanded={open}
      >
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
          className="shrink-0 opacity-70"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        <span className="truncate font-medium">{triggerLabel}</span>
        <span className="text-fg-faint shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-elevated shadow-lg p-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-fg">身份汇总</div>
              <div className="text-[11px] text-fg-muted mt-0.5">
                勾选后计入概览 / 模型 / 节奏 / 周期统计。报销仍用主数据源。
              </div>
            </div>
            <button
              type="button"
              className="text-[11px] text-accent shrink-0"
              onClick={() => void refreshProfiles({ refreshEmail: true })}
              disabled={loading}
            >
              刷新邮箱
            </button>
          </div>

          {error && (
            <div className="text-[11px] text-rose-500 whitespace-pre-wrap">
              {error}
            </div>
          )}

          <ul className="space-y-2 max-h-64 overflow-auto">
            {profiles.map((p) => {
              const st = statusLabel(p)
              const checked = selectedIds.includes(p.id)
              const syncAgo = formatRelativeTime(
                p.lastSync?.lastSuccessAt || p.lastSync?.updatedAt,
              )
              return (
                <li
                  key={p.id}
                  className="rounded-md border border-line/80 bg-canvas/40 px-2.5 py-2"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--accent)]"
                      checked={checked}
                      onChange={() => toggleSelected(p.id)}
                      aria-label={`汇总 ${p.displayName}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-fg truncate">
                        {p.email || p.displayName}
                      </div>
                      <div className="text-[10px] text-fg-muted flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        <span className="font-mono">{p.id}</span>
                        <span
                          className={
                            st.tone === 'ok'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : st.tone === 'warn'
                                ? 'text-amber-600 dark:text-amber-400'
                                : ''
                          }
                        >
                          {st.text}
                        </span>
                        {syncAgo && <span>同步 {syncAgo}</span>}
                      </div>
                      {!p.files?.authJson?.exists && p.loginHint?.login && (
                        <button
                          type="button"
                          className="mt-1 text-[10px] text-accent text-left"
                          onClick={() =>
                            void copyText(p.loginHint!.login, `login-${p.id}`)
                          }
                        >
                          {copied === `login-${p.id}`
                            ? '已复制 login 命令'
                            : '复制 npm run login 命令'}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={syncingId != null || !p.files?.authJson?.exists}
                      onClick={() => void handleSync(p.id)}
                      className="shrink-0 text-[11px] px-2 py-1 rounded border border-line hover:bg-surface disabled:opacity-40"
                      title={
                        p.files?.authJson?.exists
                          ? '导出并计价该身份'
                          : '请先 login'
                      }
                    >
                      {syncingId === p.id ? '同步中…' : '同步'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          {banner && (
            <div className="text-[11px] text-fg-muted whitespace-pre-wrap rounded border border-line bg-canvas/50 px-2 py-1.5">
              {banner}
            </div>
          )}

          {!adding ? (
            <button
              type="button"
              className="w-full text-xs text-left text-accent py-1"
              onClick={() => setAdding(true)}
            >
              + 添加身份
            </button>
          ) : (
            <div className="space-y-2 border-t border-line pt-2">
              <div className="text-[11px] text-fg-muted">
                添加后在终端对该身份执行 login（需浏览器过 Cloudflare）。
              </div>
              <input
                className="w-full rounded border border-line bg-canvas px-2 py-1.5 text-xs"
                placeholder="id（如 alt / work）"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
              />
              <input
                className="w-full rounded border border-line bg-canvas px-2 py-1.5 text-xs"
                placeholder="显示名（可选）"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              {addError && (
                <div className="text-[11px] text-rose-500">{addError}</div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded border border-line"
                  onClick={() => {
                    setAdding(false)
                    setAddError(null)
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded bg-accent text-white"
                  onClick={() => void handleAdd()}
                >
                  创建并复制 login
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
