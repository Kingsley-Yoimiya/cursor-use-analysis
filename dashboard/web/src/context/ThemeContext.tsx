import { createContext, useContext } from 'react'

/** true = 暗色模式（默认），false = 亮色模式 */
export const ThemeContext = createContext<boolean>(true)

export const useIsDark = () => useContext(ThemeContext)
