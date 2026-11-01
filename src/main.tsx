import { createRoot } from 'react-dom/client'
import App from './App'
import 'material-symbols/index.css'
import './styles.css'

const host = document.getElementById('root')
if (host) createRoot(host).render(<App />)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
