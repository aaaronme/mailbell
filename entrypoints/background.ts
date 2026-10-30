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
import { removeAccount, signIn } from '@/lib/auth/oauth'
import type { PublicPath } from 'wxt/browser'
import { StateManager, type EmailThread } from '@/lib/StateManager'
import { getThreadCode } from '@/lib/otp'
import { planUnsubscribe } from '@/lib/unsubscribe'
import { registerActionMenus } from '@/lib/menu'
import { menus } from '@/lib/constants'
import { debugLog } from '@/lib/debugLog'
import { playNotificationSound } from '@/lib/sound'

// Update badge
async function updateBadge(unreadCount: number) {
  if (unreadCount === 0) {
    browser.action.setBadgeText({ text: '' })
    return
  }
  await browser.action.setBadgeText({ text: unreadCount.toString() })
  await browser.action.setBadgeBackgroundColor({ color: '#FF0000' })
  await browser.action.setBadgeTextColor({ color: '#FFFFFF' })
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
  await debugLog('sendNotification ->', feed.url)

  // Safari doesn't support the notifications API (same "unsupported manifest
  // key" warning as idle) - skip instead of throwing.
  if (!browser.notifications) {
    await debugLog(
      'sendNotification: browser.notifications unsupported, skipping',
    )
    return
  }

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
  // A throw anywhere in start() aborts every registration after it -
  // this is the only thing standing between that and total silence (the
  // idle API being unsupported on Safari did exactly this: everything
  // after browser.idle.onStateChanged.addListener() - the alarm, the
  // startup fetch - just never ran, with no error visible anywhere).
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
  browser.notifications?.onClicked.addListener(async (id) => {
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
      // Guard against double-registration: this port disconnects and
      // reconnects often on Safari (seen throughout this file's debugLog
      // history). Registering a fresh closure unconditionally on every
      // connect meant that if a new connect fired before the previous
      // disconnect's cleanup below had run, two listeners briefly coexisted
      // - every notify() then pushed 'refreshPopup' twice in a row, visible
      // as the mail list flickering/re-rendering right when the popup
      // opens. Reusing one stable function reference plus this guard keeps
      // at most one registered at a time regardless of connect/disconnect
      // ordering.
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
  // Safari doesn't support the idle API at all (confirmed by the "idle" key
  // warning wxt/extport prints when converting the Safari build) - accessing
  // browser.idle there throws synchronously and, since this whole callback
  // is one async function, silently aborted every registration after it:
  // no alarm, no startup fetch, nothing - with zero indication why.
  if (browser.idle) {
    browser.idle.onStateChanged.addListener(async (state) => {
      if (state === 'active') {
        const alarms = await browser.alarms.get('fetchThreads')
        if (!alarms) {
          await browser.alarms.create('fetchThreads', { periodInMinutes: 0.5 })
        }
      } else {
        await browser.alarms.clear('fetchThreads')
      }
    })
  } else {
    void debugLog(
      'background: browser.idle unsupported, skipping idle-based alarm management',
    )
  }
  globalThis.addEventListener('online', async () => {
    const alarms = await browser.alarms.get('fetchThreads')
    if (!alarms) {
      await browser.alarms.create('fetchThreads', { periodInMinutes: 0.5 })
    }
  })
  globalThis.addEventListener('offline', () => {
    browser.alarms.clear('fetchThreads')
  })

  // listen to message
  bgMessager.onMessage('refreshThreads', () => stateManager.refresh())
  // Sign-in runs here, not in the popup: the popup closes the moment
  // Google's sign-in window takes focus, taking any pending work with it.
  bgMessager.onMessage('addAccount', async ({ data: loginHint }) => {
    const account = await signIn(loginHint)
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

  // Fire-and-forget: don't let alarms.create() block the actual mail fetch
  // below. Can't assume it returns a real Promise either - on Safari it
  // returned undefined, and chaining .then() on that threw and took down
  // the rest of startup with it.
  await debugLog('background: starting up')
  await debugLog('background: creating fetchThreads alarm')
  try {
    const created = browser.alarms.create('fetchThreads', {
      periodInMinutes: 0.5,
    })
    if (
      created &&
      typeof (created as unknown as Promise<void>).then === 'function'
    ) {
      ;(created as unknown as Promise<void>).then(
        () => debugLog('background: fetchThreads alarm created'),
        (err) =>
          debugLog('background: fetchThreads alarm creation failed ->', err),
      )
    } else {
      await debugLog(
        'background: fetchThreads alarm create() returned a non-promise, assuming it succeeded',
      )
    }
  } catch (err) {
    await debugLog('background: fetchThreads alarm creation threw ->', err)
  }
  await debugLog('background: running startup fetchThreads')
  await fetchThreadsWithRetry(stateManager)
}

// The network isn't always up the instant the browser starts the background
// (waking from sleep, captive portals). Retry a few times instead of giving
// up after one attempt right at cold start.
async function fetchThreadsWithRetry(
  stateManager: StateManager,
  attempts = 3,
  delayMs = 1500,
) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await stateManager.fetchThreads()
      await debugLog(
        `background: startup fetchThreads succeeded on attempt ${attempt}`,
      )
      return
    } catch (err) {
      await debugLog(
        `background: startup fetchThreads attempt ${attempt}/${attempts} failed ->`,
        err,
      )
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  await debugLog(
    `background: startup fetchThreads gave up after ${attempts} attempts`,
  )
}
