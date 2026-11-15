import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
  document.addEventListener('contextmenu', (event) => event.preventDefault())
  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase()
    const modifier = event.ctrlKey || event.metaKey
    const browserShortcut = ['f1', 'f3', 'f5', 'f6', 'f7', 'f11', 'f12'].includes(key)
      || (event.altKey && ['arrowleft', 'arrowright', 'home'].includes(key))
      || (modifier && ['r', 'p', 's', 'u', 'l', 'w', 'f', 'g', 'h', 'j', 'd', 'n', 't', 'o', 'tab', '+', '=', '-', '0'].includes(key))
      || (modifier && event.shiftKey && ['i', 'j', 'c', 'm', 'n', 'delete'].includes(key))

    if (browserShortcut) event.preventDefault()
  }, true)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
