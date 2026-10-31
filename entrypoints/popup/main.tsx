import ReactDOM from 'react-dom/client'
import App from './App.js'
import '@fontsource-variable/geist'
import '@fontsource-variable/source-serif-4'
import './style.css'
import { debugLog } from '@/lib/debugLog'
import { fetchTokenFromBackground, popupMessager } from '@/lib/messager'
import { parseThreadUrl, setTokenSource } from '@/lib/api/gmail'
import { isPopoutTab } from './view'
import { router } from './router'
import { validateMailSearch } from './popout/mailSearch'

// The toolbar popup sizes itself to its content, so a long unbroken subject
// or address can widen it: pin the width (style.css). The Popout tab isn't
// constrained.
if (!isPopoutTab) {
  document.documentElement.classList.add('fixed-width-popup')
}

setTokenSource(fetchTokenFromBackground)

// A notification click lands here when a popout is already open: show that mail
// and bring the tab forward. Focus is best effort - the navigation is what counts.
if (isPopoutTab) {
  popupMessager.onMessage('openThread', async ({ data: thread }) => {
    const account = parseThreadUrl(thread)?.account
    await router.navigate({ to: '/mail', search: validateMailSearch({ account, thread }) })
    try {
      const tab = await browser.tabs.getCurrent()
      if (tab?.id !== undefined) await browser.tabs.update(tab.id, { active: true })
      if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true })
    } catch (err) {
      console.error('focusing the popout failed', err)
    }
    return true
  })
}

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
