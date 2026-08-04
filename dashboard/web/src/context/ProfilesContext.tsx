/**
 * 多 Cursor 身份选择：勾选计入汇总的身份列表。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import axios from 'axios'

const STORAGE_KEY = 'cursor-dashboard-selected-profiles'

export type ProfileInfo = {
  id: string
  label: string
  displayName: string
  email: string | null
  name: string | null
  legacy?: boolean
  hasData?: boolean
  files?: {
    authJson?: { exists: boolean; mtimeIso?: string }
    usageCsv?: { exists: boolean; mtimeIso?: string; sizeBytes?: number }
    estimateJson?: { exists: boolean; mtimeIso?: string }
  }
  session?: { expIso?: string; expired?: boolean | null } | null
  lastSync?: { ok?: boolean; updatedAt?: string; lastSuccessAt?: string } | null
  loginHint?: {
    login: string
    export: string
    estimate: string
  }
  identitySource?: string
}

type ProfilesContextValue = {
  profiles: ProfileInfo[]
  selectedIds: string[]
  selectedKey: string
  activeForSync: string
  loading: boolean
  error: string | null
  setSelectedIds: (ids: string[]) => void
  toggleSelected: (id: string) => void
  refreshProfiles: (opts?: { refreshEmail?: boolean }) => Promise<void>
  profilesQuery: string
}

const ProfilesContext = createContext<ProfilesContextValue | null>(null)

function readStoredIds(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.map(String)
  } catch {
    return null
  }
}

function writeStoredIds(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

export function ProfilesProvider({
  children,
  refreshKey = 0,
}: {
  children: ReactNode
  refreshKey?: number
}) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [selectedIds, setSelectedIdsState] = useState<string[]>([])
  const [activeForSync, setActiveForSync] = useState('default')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const refreshProfiles = useCallback(
    async (opts?: { refreshEmail?: boolean }) => {
      setLoading(true)
      try {
        const r = await axios.get<{
          ok: boolean
          profiles?: ProfileInfo[]
          activeForSync?: string
          error?: string
        }>('/api/profiles', {
          params: opts?.refreshEmail ? { refresh: '1' } : undefined,
        })
        if (!r.data.ok || !r.data.profiles) {
          setError(r.data.error ?? '无法加载身份列表')
          setProfiles([])
          return
        }
        setProfiles(r.data.profiles)
        setActiveForSync(r.data.activeForSync || 'default')
        setError(null)

        setSelectedIdsState((prev) => {
          const ids = r.data.profiles!.map((p) => p.id)
          const stored = readStoredIds()
          const base = hydrated ? prev : stored && stored.length ? stored : null
          let next: string[]
          if (base && base.length > 0) {
            next = base.filter((id) => ids.includes(id))
            if (next.length === 0) {
              next = r.data.profiles!.filter((p) => p.hasData).map((p) => p.id)
              if (next.length === 0) next = [ids[0]]
            }
          } else {
            next = r.data.profiles!.filter((p) => p.hasData).map((p) => p.id)
            if (next.length === 0) next = [ids[0]]
          }
          writeStoredIds(next)
          return next
        })
        setHydrated(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [hydrated],
  )

  useEffect(() => {
    void refreshProfiles()
  }, [refreshKey, refreshProfiles])

  const setSelectedIds = useCallback((ids: string[]) => {
    const uniq = [...new Set(ids)]
    setSelectedIdsState(uniq)
    writeStoredIds(uniq)
  }, [])

  const toggleSelected = useCallback((id: string) => {
    setSelectedIdsState((prev) => {
      const has = prev.includes(id)
      // 至少保留一个
      if (has && prev.length === 1) return prev
      const next = has ? prev.filter((x) => x !== id) : [...prev, id]
      writeStoredIds(next)
      return next
    })
  }, [])

  const selectedKey = selectedIds.slice().sort().join(',')
  const profilesQuery = selectedIds.join(',')

  const value = useMemo(
    () => ({
      profiles,
      selectedIds,
      selectedKey,
      activeForSync,
      loading,
      error,
      setSelectedIds,
      toggleSelected,
      refreshProfiles,
      profilesQuery,
    }),
    [
      profiles,
      selectedIds,
      selectedKey,
      activeForSync,
      loading,
      error,
      setSelectedIds,
      toggleSelected,
      refreshProfiles,
      profilesQuery,
    ],
  )

  return (
    <ProfilesContext.Provider value={value}>{children}</ProfilesContext.Provider>
  )
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext)
  if (!ctx) {
    throw new Error('useProfiles must be used within ProfilesProvider')
  }
  return ctx
}

/** 无 Provider 时安全降级（单身份兼容） */
export function useProfilesOptional(): ProfilesContextValue | null {
  return useContext(ProfilesContext)
}
