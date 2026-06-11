import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('FoodBall: #root element missing')

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
