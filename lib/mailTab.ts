import { popupMessager } from './messager'

// Every mail tab runs its own first load, preload and contact scan against one
// Gmail quota, so a single tab holds this lock until it closes. The browser
// frees it when the tab goes, however that happens.
const LOCK = 'mail-tab'
const ANSWER_MS = 1000

// Best effort - the navigation or the tab already open is what counts.
export async function focusThisTab(): Promise<void> {
  try {
    const tab = await browser.tabs.getCurrent()
    if (tab?.id !== undefined) await browser.tabs.update(tab.id, { active: true })
    if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true })
  } catch (err) {
    console.error('focusing the mail tab failed', err)
  }
}

// True if this tab is now the mail tab, and answers focusMailTab from here on.
export function claimMailTab(): Promise<boolean> {
  return new Promise((resolve) => {
    void navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
      resolve(lock !== null)
      if (!lock) return
      popupMessager.onMessage('focusMailTab', async () => {
        await focusThisTab()
        return true
      })
      return new Promise(() => {})
    })
  })
}

// The new tab is the one to go: it holds nothing yet, while the open one may
// hold a reply being written. False leaves this tab to carry on: an open tab
// that doesn't answer can't show the mail.
export async function retireMailTab(waitMs = ANSWER_MS): Promise<boolean> {
  const answer = popupMessager.sendMessage('focusMailTab', undefined).catch(() => false)
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), waitMs))
  if ((await Promise.race([answer, timeout])) !== true) return false
  try {
    const tab = await browser.tabs.getCurrent()
    if (tab?.id === undefined) return false
    await browser.tabs.remove(tab.id)
    return true
  } catch (err) {
    console.error('closing the extra mail tab failed', err)
    return false
  }
}
