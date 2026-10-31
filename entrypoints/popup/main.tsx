import ReactDOM from 'react-dom/client'
import App from './App.js'
import '@fontsource-variable/geist'
import '@fontsource-variable/source-serif-4'
import './style.css'
import { debugLog } from '@/lib/debugLog'
import { fetchTokenFromBackground } from '@/lib/messager'
import { setTokenSource } from '@/lib/api/gmail'
import { isPopoutTab } from './view'

// The toolbar popup sizes itself to its content, so a long unbroken subject
// or address can widen it: pin the width (style.css). The Popout tab isn't
// constrained.
if (!isPopoutTab) {
  document.documentElement.classList.add('fixed-width-popup')
}

setTokenSource(fetchTokenFromBackground)

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<App />)

// Heartbeat to keep the background alive while the popup is open. If the
// background is torn down anyway, reconnect after a gap: reconnecting at once
// can spin into a tight connect/disconnect loop.
const RECONNECT_DELAY_MS = 2000

function connectToServiceWorker() {
  const port = browser.runtime.connect({ name: 'popup' })
  port.onDisconnect.addListener(async () => {
    await debugLog('popup: service worker port disconnected, reconnecting in', RECONNECT_DELAY_MS, 'ms')
    setTimeout(() => {
      serviceWorkerConnection = connectToServiceWorker()
    }, RECONNECT_DELAY_MS)
  })
  return port
}
let serviceWorkerConnection = connectToServiceWorker()
setInterval(() => {
  try {
    serviceWorkerConnection.postMessage('heartbeat')
  } catch (err) {
    console.error('heartbeat failed', err)
  }
}, 15000)
