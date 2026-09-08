import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.tsx'

const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Em TVs antigas que não suportam módulos ES, este arquivo nem é executado e
// o aviso estático do index.html permanece visível em vez de uma tela branca.
window.requestAnimationFrame(() => {
  document.getElementById('legacy-browser-warning')?.remove()
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => undefined)
  })
}
