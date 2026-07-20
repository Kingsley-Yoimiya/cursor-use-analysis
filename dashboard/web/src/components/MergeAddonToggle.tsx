/**
 * 将声明 mergeIntoOverview 的本地附加源叠进概览/模型详情。
 * 无附加源时不渲染。状态存 localStorage；不影响报销 / 周期统计。
 */
const STORAGE_KEY = 'cursor-dashboard-merge-addon'

export type AddonSourceInfo = {
  id: string
  name?: string
  mergeIntoOverview?: {
    enabled: boolean
    label: string
    affects?: string[]
    excludes?: string[]
  } | null
}

export function readMergeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeMergeEnabled(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function MergeAddonToggle({
  sources,
  enabled,
  onChange,
  compact,
}: {
  sources: AddonSourceInfo[]
  enabled: boolean
  onChange: (v: boolean) => void
  compact?: boolean
}) {
  const mergeable = sources.filter((p) => p.mergeIntoOverview?.enabled)
  if (mergeable.length === 0) return null

  const label =
    mergeable.length === 1
      ? mergeable[0].mergeIntoOverview?.label || '合并附加用量'
      : `合并附加用量 (${mergeable.length})`

  return (
    <label
      className={`inline-flex items-center gap-2 cursor-pointer select-none ${
        compact ? 'text-[11px]' : 'text-xs'
      } text-slate-500 dark:text-slate-400`}
      title="打开后，概览与模型详情会叠加本地附加数据源的等价用量；报销导出与周期统计仍只用主数据源。"
    >
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className={`relative w-9 h-5 rounded-full transition-colors ${
          enabled
            ? 'bg-emerald-500'
            : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-4' : ''
          }`}
        />
      </button>
      <span className={enabled ? 'text-emerald-600 dark:text-emerald-400' : ''}>
        {label}
      </span>
    </label>
  )
}
