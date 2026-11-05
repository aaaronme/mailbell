import ReactDOM from 'react-dom/client'
import App from './App.js'
import '@fontsource-variable/geist'
import '@fontsource-variable/source-serif-4'
import './style.css'
import { debugLog } from '@/lib/debugLog'
import { fetchTokenFromBackground, popupMessager } from '@/lib/messager'
import { parseThreadUrl, setTokenSource } from '@/lib/api/gmail'
import { isPopoutTab } from './view'
import { claimMailTab, focusThisTab, retireMailTab } from '@/lib/mailTab'
import { paintCachedTheme } from '@/lib/theme'
import { router } from './router'
import { validateMailSearch } from './popout/mailSearch'
import type { VisibleMessage } from '@/lib/fastPoll'

// The toolbar popup sizes itself to its content, so a long unbroken subject
// or address can widen it: pin the width (style.css). The Popout tab isn't
// constrained.
if (!isPopoutTab) {
  document.documentElement.classList.add('fixed-width-popup')
}

setTokenSource(fetchTokenFromBackground)
paintCachedTheme()

// The Settings sound-picker tab (?page=) is a popout tab too, but not a mail one.
const isMailTab = isPopoutTab && !new URLSearchParams(location.search).has('page')

function start() {
  // A notification click lands here when a popout is already open: show that mail
  // and bring the tab forward. Focus is best effort - the navigation is what counts.
  if (isMailTab) {
    popupMessager.onMessage('openThread', async ({ data: thread }) => {
      const account = parseThreadUrl(thread)?.account
      await router.navigate({ to: '/mail', search: validateMailSearch({ account, thread }) })
      await focusThisTab()
      return true
    })
  }

  const root = ReactDOM.createRoot(document.getElementById('root')!)
  root.render(<App />)

  // Heartbeat to keep the background alive while the popup is open. If the
  // background is torn down anyway, reconnect after a gap: reconnecting at once
  // can spin into a tight connect/disconnect loop.
  const RECONNECT_DELAY_MS = 2000

  // The background polls fast while any view is on screen; a reconnected port
  // is a new view to it, so each connection says so again.
  function postVisibility(port: ReturnType<typeof browser.runtime.connect>) {
    const message: VisibleMessage = { type: 'visible', visible: document.visibilityState === 'visible' }
    try {
      port.postMessage(message)
    } catch (err) {
      console.error('posting visibility failed', err)
    }
  }

  function connectToServiceWorker() {
    const port = browser.runtime.connect({ name: 'popup' })
    port.onDisconnect.addListener(async () => {
      await debugLog('popup: service worker port disconnected, reconnecting in', RECONNECT_DELAY_MS, 'ms')
      setTimeout(() => {
        serviceWorkerConnection = connectToServiceWorker()
      }, RECONNECT_DELAY_MS)
    })
    postVisibility(port)
    return port
  }
  let serviceWorkerConnection = connectToServiceWorker()
  document.addEventListener('visibilitychange', () => postVisibility(serviceWorkerConnection))
  setInterval(() => {
    try {
      serviceWorkerConnection.postMessage('heartbeat')
    } catch (err) {
      console.error('heartbeat failed', err)
    }
  }, 15000)
}

// A second mail tab hands over to the first before it requests anything.
const retired = isMailTab && !(await claimMailTab()) && (await retireMailTab())
if (!retired) start()
