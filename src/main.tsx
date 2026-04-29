import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastContainer } from './components/ui/Toast'

// Dev: open with ?resetClaude=1 to see the Connect Claude modal again (clears saved choice before React boots).
// Optional: &clearScores=1 also drops cached AI task scores so scoring runs fresh.
if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search)
  if (params.get('resetClaude') === '1') {
    localStorage.removeItem('foj_ai_mode')
    localStorage.removeItem('foj_user_claude_key')
    if (params.get('clearScores') === '1') {
      localStorage.removeItem('foj_ai_scores_v1')
    }
    params.delete('resetClaude')
    params.delete('clearScores')
    const q = params.toString()
    const next = `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', next)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <ToastContainer />
    </ErrorBoundary>
  </StrictMode>
)
