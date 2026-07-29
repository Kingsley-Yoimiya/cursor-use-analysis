/** 同步成功后传给 KPI 的短暂动向 */
export interface SyncPulse {
  id: number
  addedRows: number
  addedTokens: number
  addedUsd: number
  totalTokens: number
  totalUsd: number
  elapsedMs: number | null
  firstSync: boolean
  /** 附加源（插件）贡献的增量，便于文案提示 */
  addonUsd: number
  addonTokens: number
  syncMs?: number
}
