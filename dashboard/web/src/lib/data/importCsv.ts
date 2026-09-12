import axios from 'axios'

export async function downloadApiCsv(
  url: string,
  fallbackName: string,
): Promise<void> {
  const r = await axios.get(url, { responseType: 'blob' })
  const blob: Blob =
    r.data instanceof Blob
      ? r.data
      : new Blob([r.data], { type: 'text/csv;charset=utf-8' })
  const cd = String(
    (r.headers as Record<string, string>)['content-disposition'] || '',
  )
  const m = cd.match(/filename="([^"]+)"/)
  const name = m?.[1] || fallbackName
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}

export async function importUsageCsvFile(
  file: File,
  profileId = 'default',
  label?: string,
) {
  const csvText = await file.text()
  return axios.post<{
    ok: boolean
    error?: string
    rows?: number
  }>(`/api/profiles/${encodeURIComponent(profileId)}/import`, {
    csvText,
    fileName: file.name,
    label,
  })
}
