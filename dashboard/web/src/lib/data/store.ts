const DB_NAME = 'cursor-dashboard'
const DB_VERSION = 1

export type StoredProfile = {
  id: string
  label: string
  fileName: string
  sizeBytes: number
  rowCount: number
  updatedAt: string
  source: 'import' | 'demo'
}

export type ReimbursementProfile = {
  employeeName: string
  employeeEmail: string
  department: string
  purpose: string
  currency: string
}

const DEFAULT_REIMBURSE: ReimbursementProfile = {
  employeeName: '',
  employeeEmail: '',
  department: '',
  purpose: 'Cursor AI 开发工具订阅用量',
  currency: 'USD',
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('profiles')) {
        db.createObjectStore('profiles', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('csvs')) {
        db.createObjectStore('csvs', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中止'))
  })
}

function reqTo<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 请求失败'))
  })
}

export async function listProfiles(): Promise<StoredProfile[]> {
  const db = await openDb()
  try {
    const tx = db.transaction('profiles', 'readonly')
    const all = await reqTo(tx.objectStore('profiles').getAll() as IDBRequest<StoredProfile[]>)
    await txDone(tx)
    return all.sort((a, b) => a.id.localeCompare(b.id))
  } finally {
    db.close()
  }
}

export async function getCsv(id: string): Promise<string | null> {
  const db = await openDb()
  try {
    const tx = db.transaction('csvs', 'readonly')
    const row = await reqTo(
      tx.objectStore('csvs').get(id) as IDBRequest<{ id: string; text: string } | undefined>,
    )
    await txDone(tx)
    return row?.text ?? null
  } finally {
    db.close()
  }
}

export async function putProfileCsv(opts: {
  id: string
  label: string
  fileName: string
  csvText: string
  rowCount: number
  source: 'import' | 'demo'
}): Promise<StoredProfile> {
  const profile: StoredProfile = {
    id: opts.id,
    label: opts.label,
    fileName: opts.fileName,
    sizeBytes: new Blob([opts.csvText]).size,
    rowCount: opts.rowCount,
    updatedAt: new Date().toISOString(),
    source: opts.source,
  }
  const db = await openDb()
  try {
    const tx = db.transaction(['profiles', 'csvs'], 'readwrite')
    tx.objectStore('profiles').put(profile)
    tx.objectStore('csvs').put({ id: opts.id, text: opts.csvText })
    await txDone(tx)
    return profile
  } finally {
    db.close()
  }
}

export async function createEmptyProfile(id: string, label: string): Promise<StoredProfile> {
  const existing = (await listProfiles()).find((p) => p.id === id)
  if (existing) throw new Error(`身份 ${id} 已存在`)
  return putProfileCsv({
    id,
    label,
    fileName: '',
    csvText: '',
    rowCount: 0,
    source: 'import',
  })
}

export async function deleteProfile(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(['profiles', 'csvs'], 'readwrite')
    tx.objectStore('profiles').delete(id)
    tx.objectStore('csvs').delete(id)
    await txDone(tx)
  } finally {
    db.close()
  }
}

export async function getReimbursementProfile(): Promise<ReimbursementProfile> {
  const db = await openDb()
  try {
    const tx = db.transaction('kv', 'readonly')
    const row = await reqTo(
      tx.objectStore('kv').get('reimbursement') as IDBRequest<
        { key: string; value: ReimbursementProfile } | undefined
      >,
    )
    await txDone(tx)
    return { ...DEFAULT_REIMBURSE, ...(row?.value ?? {}) }
  } finally {
    db.close()
  }
}

export async function saveReimbursementProfile(
  profile: ReimbursementProfile,
): Promise<ReimbursementProfile> {
  const next: ReimbursementProfile = {
    employeeName: String(profile.employeeName ?? '').trim(),
    employeeEmail: String(profile.employeeEmail ?? '').trim(),
    department: String(profile.department ?? '').trim(),
    purpose: String(profile.purpose ?? DEFAULT_REIMBURSE.purpose).trim(),
    currency: String(profile.currency ?? 'USD').trim() || 'USD',
  }
  const db = await openDb()
  try {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put({ key: 'reimbursement', value: next })
    await txDone(tx)
    return next
  } finally {
    db.close()
  }
}

export function sanitizeProfileId(raw: string): string {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return id.slice(0, 40)
}

export { DEFAULT_REIMBURSE }
