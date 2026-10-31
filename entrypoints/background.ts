import { bgMessager, popupMessager, tagOAuthError } from '@/lib/messager'
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
  sendReply,
  markAsUnread,
  openMailInWeb,
  parseThreadUrl,
} from '@/lib/api/gmail'
import { getAccessToken, getAccounts, getCustomClient, removeAccount, setCustomClient, signIn } from '@/lib/auth/oauth'
import type { PublicPath } from 'wxt/browser'
import { StateManager, type EmailThread } from '@/lib/StateManager'
import { getThreadCode } from '@/lib/otp'
import { planUnsubscribe } from '@/lib/unsubscribe'
import { registerActionMenus } from '@/lib/menu'
import { menus } from '@/lib/constants'
import { debugLog } from '@/lib/debugLog'
import { openPopoutOn } from '@/lib/openPopout'
import { playNotificationSound } from '@/lib/sound'
import { getSettings, isSettingsChange, notificationSound } from '@/lib/settings'

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

// Shows the toast for feed, unless its account or the settings filter it out.
// Returns whether it did.
async function sendNotification(stateManager: StateManager, feed: EmailThread): Promise<boolean> {
  const notificationId = `${NOTIFICATION_PREFIX}${feed.url}`

  if (stateManager.notifiedEmails.has(feed.url)) {
    return false
  }
  // Claim it before the first await: a fetch overlapping this one (the popup
  // opening mid-poll) otherwise saw it as new too and played the sound again.
  stateManager.notifiedEmails.add(feed.url)
  const sound = notificationSound(await getSettings(), feed)
  if (sound === null) return false
  await debugLog('sendNotification ->', feed.url)

  await browser.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: '/icon/48.png' as PublicPath,
    // Leading with the code means it can be read straight off the toast.
    title: (import.meta.env.DEV ? 'DEV: ' : '') + withCode(feed),
    message: `From: ${feed.author.name} <${feed.author.email}>\n${feed.summary}`,
    // Which inbox it landed in, when there's more than one.
    ...(stateManager.accounts.length > 1 && { contextMessage: feed.account }),
  })
  await playNotificationSound(sound)
  setTimeout(async () => {
    console.log('auto clear notification', notificationId)
    await browser.notifications.clear(notificationId)
  }, 10 * 1000)
  return true
}

const NOTIFICATION_PREFIX = `mailbell-${import.meta.env.MODE}-`

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
    if (!id.startsWith(NOTIFICATION_PREFIX)) return
    await browser.notifications.clear(id)
    await openPopoutOn(id.slice(NOTIFICATION_PREFIX.length))
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
  // The toolbar popup and the popout tab can be open at once: push to them
  // until the last one closes. One listener however many there are, or every
  // refresh was pushed twice.
  let openViews = 0
  async function pushRefreshToPopup(): Promise<void> {
    await popupMessager.sendMessage('refreshPopup', undefined)
  }
  browser.runtime.onConnect.addListener(async (port) => {
    if (port.name === 'popup') {
      if (openViews++ === 0) stateManager.on(pushRefreshToPopup)
      await debugLog('background: popup port connected')
      port.onDisconnect.addListener(async function () {
        await debugLog('background: popup port disconnected')
        if (--openViews > 0) return
        stateManager.off(pushRefreshToPopup)
        stateManager.clearViewed()
      })
    }
  })
  // notification listener
  stateManager.on(async () => {
    // One toast per poll: the newest mail that passes its account's and the
    // settings' filters, not just the newest mail.
    for (const feed of stateManager.getNewThreads()) {
      if (await sendNotification(stateManager, feed)) return
    }
  })

  // listen to polling event
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'fetchThreads') {
      await stateManager.fetchThreads()
    }
  })
  // Paused only while the screen is locked: someone reading or watching a
  // video is idle but still wants new mail. Offline needs no pause -
  // fetchThreads skips itself - and a suspended background can't hear
  // 'online' to resume one.
  browser.idle.onStateChanged.addListener(async (state) => {
    if (state === 'locked') {
      await browser.alarms.clear('fetchThreads')
    } else if (!(await browser.alarms.get('fetchThreads'))) {
      await createAlarm()
      await stateManager.fetchThreads()
    }
  })

  // listen to message
  bgMessager.onMessage('refreshThreads', () => stateManager.refresh())
  bgMessager.onMessage('poll', () => stateManager.fetchThreads())
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
    const current = await getCustomClient()
    const same = (a?: string | null, b?: string | null) => (a?.trim() || '') === (b?.trim() || '')
    if (same(current?.clientId, client?.clientId) && same(current?.clientSecret, client?.clientSecret)) return
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
  bgMessager.onMessage('getAccessToken', async ({ data }) => {
    try {
      return await getAccessToken(data.account, data.force)
    } catch (err) {
      throw tagOAuthError(err)
    }
  })
  // In the background, not the popup: a send must finish even if the popup
  // closes meanwhile.
  bgMessager.onMessage('sendReply', async ({ data }) => {
    await sendReply(data.url, data.recipients, data.text).catch(async (err) => {
      await debugLog('sendReply: failed ->', String(err))
      throw err
    })
    void stateManager.refresh().catch(() => {})
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
