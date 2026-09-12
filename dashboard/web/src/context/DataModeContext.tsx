import { createContext, useContext, type ReactNode } from 'react'
import type { DataMode } from '../lib/data/mode'

const DataModeContext = createContext<DataMode>('local')

export function DataModeProvider({
  mode,
  children,
}: {
  mode: DataMode
  children: ReactNode
}) {
  return (
    <DataModeContext.Provider value={mode}>{children}</DataModeContext.Provider>
  )
}

export function useDataMode(): DataMode {
  return useContext(DataModeContext)
}
