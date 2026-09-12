import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.tsx'
import { DataModeProvider } from './context/DataModeContext'
import { installDataPlane } from './lib/data/install'

const rootEl = document.getElementById('root')!

rootEl.innerHTML =
  '<p style="font-family:ui-sans-serif,system-ui,sans-serif;padding:2rem;color:#64748b">正在准备看板…</p>'

void installDataPlane().then((mode) => {
  createRoot(rootEl).render(
    <StrictMode>
      <DataModeProvider mode={mode}>
        <App />
        <Analytics />
      </DataModeProvider>
    </StrictMode>,
  )
})
