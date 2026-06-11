import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { initTheme } from './lib/theme'
import './index.css'

// Apply the saved/system theme before first paint (no flash of the wrong theme).
initTheme()

// Install the service worker / offline shell. autoUpdate (vite.config.ts) means
// a new deploy is picked up on the next visit — fine for a ~6-week league.
registerSW({ immediate: true })

const root = document.getElementById('root')
if (!root) throw new Error('FoodBall: #root element missing')

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
