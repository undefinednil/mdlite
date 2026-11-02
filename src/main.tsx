import { createRoot } from 'react-dom/client'
import App from './App'
import 'material-symbols/index.css'
import './styles.css'

const host = document.getElementById('root')
if (host) createRoot(host).render(<App />)

if (import.meta.env.VITE_MDLITE_SELFTEST === '1') {
  void import('./lib/selftest').then((module) => module.runSelfTest())
}
