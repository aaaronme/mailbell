import { bgMessager, popupMessager } from '@/lib/messager'
import {
  archiveMail,
  checkLoginStatus,
  clearInboxCache,
  composeUrl,
  deleteMail,
  getActiveInboxUrl,
  getAllRSS,
  getRawMessage,
  getThreadMail,
  markAsRead,
  markAsSpam,
  markAsUnread,
  openMailInWeb,
  parseThreadUrl,
} from '@/lib/api/gmail'
import { getAccounts, removeAccount, setCustomClient, signIn } from '@/lib/auth/oauth'
import type { PublicPath } from 'wxt/browser'
import { StateManager, type EmailThread } from '@/lib/StateManager'
import { getThreadCode } from '@/lib/otp'
import { planUnsubscribe } from '@/lib/unsubscribe'
import { registerActionMenus } from '@/lib/menu'
import { menus } from '@/lib/constants'
import { debugLog } from '@/lib/debugLog'
import { playNotificationSound } from '@/lib/sound'
import { getSettings, isSettingsChange } from '@/lib/settings'

const iconPaths = (dir: string) =>
  Object.fromEntries([16, 32, 48, 96, 128].map((size) => [size, `${dir}/${size}.png`])) as Record<number, string>

// The envelope gets a dot while anything is unread (assets/icon), and the
// badge says how much.
async function updateBadge(unreadCount: number) {
  await browser.action.setIcon({ path: iconPaths(unreadCount ? '/icon/unread' : '/icon') })
  await browser.action.setBadgeText({ text: unreadCount ? unreadCount.toString() : '' })
  await browser.action.setBadgeBackgroundColor({ color: '#df484c' })
  await browser.action.setBadgeTextColor({ color: '#ffffff' })
}

function withCode(thread: EmailThread) {
  const code = getThreadCode(thread)
  return code ? `${code} · ${thread.title}` : thread.title
}

async function sendNotification(stateManager: StateManager, feed: EmailThread) {
  const notificationId = `mailbell-${import.meta.env.MODE}-${feed.url}`

  if (stateManager.notifiedEmails.has(feed.url)) {
    return
  }
  // Claim it before the first await: a fetch overlapping this one (the popup
  // opening mid-poll) otherwise saw it as new too and played the sound again.
  stateManager.notifiedEmails.add(feed.url)
  if (!(await getSettings()).notifications) return
  await debugLog('sendNotification ->', feed.url)

  await browser.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: '/icon/48.png' as PublicPath,
    // Leading with the code means it can be read straight off the toast.
    title: (import.meta.env.DEV ? 'DEV: ' : '') + withCode(feed),
    message: `From: ${feed.author.name} <${feed.author.email}>\n${feed.summary}`,
  })
  await playNotificationSound()
  setTimeout(async () => {
    console.log('auto clear notification', notificationId)
    await browser.notifications.clear(notificationId)
  }, 10 * 1000)
}

export default defineBackground(() => {
  // A throw anywhere in start() aborts every registration after it, with
  // no error visible anywhere unless it's logged here.
  start().then(
    () => debugLog('background: startup complete'),
    (err) => debugLog('background: startup failed ->', err),
  )
})

// Every listener has to be added before start()'s first await. Firefox's
// event page and Chrome's service worker only wake for listeners added
// synchronously at startup; ones added after an await worked until the
// background was first suspended, then never fired again - no polls, no
// notifications until the popup was opened.

async function start() {
  // One listener for every notification; adding one per notification piled
  // them up, so each click ran every earlier one too.
  browser.notifications.onClicked.addListener(async (id) => {
    if (!id.startsWith('mailbell-')) return
    await browser.notifications.clear(id)
    await browser.action.openPopup()
  })
  const stateManager = new StateManager({
    checkLoginStatus,
    getAllRSS,
    getThreadMail,
    markAsRead,
    archive: async (url) => {
      await archiveMail(url)
    },
    delete: async (url) => {
      await deleteMail(url)
    },
    markAsSpam: async (url) => {
      await markAsSpam(url)
    },
    markAsUnread: async (url) => {
      await markAsUnread(url)
    },
  })
  void stateManager.restore()
  // badge listener
  stateManager.on(async () => {
    await updateBadge(stateManager.getUnreadThreads().length)
  })
  // popup listener
  let popupListenerRegistered = false
  async function pushRefreshToPopup(): Promise<void> {
    await popupMessager.sendMessage('refreshPopup', undefined)
  }
  browser.runtime.onConnect.addListener(async (port) => {
    if (port.name === 'popup') {
      await debugLog('background: popup port connected')
      // At most one registered: a new connect can land before the previous
      // disconnect's cleanup, and two listeners pushed every refresh twice.
      if (!popupListenerRegistered) {
        stateManager.on(pushRefreshToPopup)
        popupListenerRegistered = true
      }
      port.onDisconnect.addListener(async function () {
        await debugLog('background: popup port disconnected')
        stateManager.off(pushRefreshToPopup)
        popupListenerRegistered = false
        stateManager.clearViewed()
      })
    }
  })
  // notification listener
  stateManager.on(async () => {
    const newFeeds = stateManager.getNewThreads()
    if (newFeeds.length === 0) {
      return
    }
    await sendNotification(stateManager, newFeeds[0]!)
  })

  // listen to polling event
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'fetchThreads') {
      await stateManager.fetchThreads()
    }
  })
  browser.idle.onStateChanged.addListener(async (state) => {
    if (state === 'active') {
      await ensureAlarm()
    } else {
      await browser.alarms.clear('fetchThreads')
    }
  })
  globalThis.addEventListener('online', ensureAlarm)
  globalThis.addEventListener('offline', () => {
    browser.alarms.clear('fetchThreads')
  })

  // listen to message
  bgMessager.onMessage('refreshThreads', () => stateManager.refresh())
  // Sign-in runs here, not in the popup: the popup closes the moment
  // Google's sign-in window takes focus, taking any pending work with it.
  bgMessager.onMessage('addAccount', async ({ data: loginHint }) => {
    const account = await signIn(loginHint).catch(async (err) => {
      await debugLog('background: sign-in failed ->', String(err))
      throw err
    })
    await debugLog('background: signed in ->', account.email)
    await clearInboxCache(account.email)
    await stateManager.refresh()
    return account.email
  })
  bgMessager.onMessage('removeAccount', async ({ data: email }) => {
    await removeAccount(email)
    await clearInboxCache(email)
    await stateManager.refresh()
  })
  // Refresh tokens belong to the client that issued them: switching signs
  // every account out, revoked and with its cache gone, like removing it.
  bgMessager.onMessage('setOAuthClient', async ({ data: client }) => {
    const accounts = await getAccounts()
    await setCustomClient(client)
    for (const { email } of accounts) {
      await removeAccount(email)
      await clearInboxCache(email)
    }
    await stateManager.refresh()
  })
  bgMessager.onMessage('unsubscribe', async ({ data: url }) => {
    const html = stateManager.threads.find((t) => t.url === url)?.messages.at(-1)?.contentHtml ?? ''
    // The body link still works without headers, so a failed fetch only
    // costs the better options.
    const raw = await getRawMessage(url).catch(async (err) => {
      await debugLog('unsubscribe: raw message fetch failed ->', err)
      return null
    })
    const plan = planUnsubscribe(raw, html)
    await debugLog('unsubscribe: plan ->', plan)
    if (!plan) {
      return null
    }
    if (plan.kind === 'post') {
      // RFC 8058: a cookie-less form POST. no-cors because the sender owes
      // us no CORS headers - the response is opaque, which is fine, there is
      // nothing in it to act on.
      await fetch(plan.url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      })
    } else if (plan.kind === 'open') {
      await browser.tabs.create({ url: plan.url })
    } else {
      // Composed from the account the newsletter was sent to.
      const account = parseThreadUrl(url)?.account ?? ''
      await browser.tabs.create({ url: composeUrl(account, { to: plan.to, su: plan.subject }) })
    }
    return plan.kind
  })
  bgMessager.onMessage('gmailAction', async ({ data }) => {
    switch (data.cmd) {
      case 'markAsRead':
        return stateManager.markAsRead(data.url)
      case 'markAsUnread':
        return stateManager.markAsUnread(data.url)
      case 'viewed':
        return stateManager.viewed(data.url)
      case 'archive':
        return stateManager.archive(data.url)
      case 'deleteMail':
        return stateManager.delete(data.url)
      case 'markAsSpam':
        return stateManager.markAsSpam(data.url)
      case 'markAllAsRead':
        return stateManager.markAllAsRead(data.urls)
      case 'archiveAll':
        return stateManager.archiveAll(data.urls)
      case 'deleteAll':
        return stateManager.deleteAll(data.urls)
      default:
        data satisfies never
        throw new Error('Unknown command')
    }
  })

  browser.runtime.onInstalled.addListener(async () => {
    registerActionMenus(menus)
  })
  browser.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId === 'open-gmail') {
      await openMailInWeb(await getActiveInboxUrl())
      return
    }
    if (info.menuItemId === 'refresh') {
      await stateManager.refresh()
      return
    }
    throw new Error('Unknown menu item id: ' + info.menuItemId)
  })

  // A failed startup fetch (network not up yet after waking) is retried by
  // the alarm half a minute later.
  await createAlarm()
  browser.storage.onChanged.addListener((changes, area) => {
    if (isSettingsChange(changes, area)) void createAlarm()
  })
  await stateManager.fetchThreads()
}

// Creating an alarm under the same name replaces it, with the new period.
async function createAlarm() {
  await browser.alarms.create('fetchThreads', { periodInMinutes: (await getSettings()).pollMinutes })
}

async function ensureAlarm() {
  if (!(await browser.alarms.get('fetchThreads'))) await createAlarm()
}
