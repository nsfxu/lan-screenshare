import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyRememberedTheme } from './lib/theme'
import './styles.css'

applyRememberedTheme()

window.addEventListener('error', (e) => window.api?.system.log('error', `${e.message} @ ${e.filename}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) => window.api?.system.log('error', `unhandled rejection: ${String(e.reason)}`))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
