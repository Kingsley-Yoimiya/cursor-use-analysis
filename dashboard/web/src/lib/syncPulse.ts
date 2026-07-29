/** 同步成功后传给 KPI 的短暂动向 */
export interface SyncPulse {
  id: number
  addedRows: number
  addedTokens: number
  totalTokens: number
  elapsedMs: number | null
  firstSync: boolean
  syncMs?: number
}
