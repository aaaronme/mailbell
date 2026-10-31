import { parseThreadUrl } from './api/gmail'
import { popupMessager } from './messager'

// The hash is built by hand rather than with the router's serializer: lib is
// imported by the background, and the serializer only ships behind the React
// entry. The router's parser
// JSON-reads values, so a numeric account comes back a number; validateMailSearch
// turns it back into a string.
export function popoutUrl(threadUrl: string): string {
  const account = parseThreadUrl(threadUrl)?.account ?? 'all'
  const search = new URLSearchParams({ account, folder: 'INBOX', thread: threadUrl })
  return `${browser.runtime.getURL('/popup.html')}?view=tab#/mail?${search}`
}

// An open popout tab navigates itself to the mail and focuses; with none
// (the toolbar popup alone answers nothing, which Chrome reports as a
// rejection and Firefox as undefined) a new tab is opened. With several
// popouts, whichever answers first wins.
export async function openPopoutOn(threadUrl: string): Promise<void> {
  const reused = await popupMessager.sendMessage('openThread', threadUrl).catch(() => false)
  if (reused === true) return
  const tab = await browser.tabs.create({ url: popoutUrl(threadUrl) })
  // A notification click from a background window should bring the mail up;
  // best effort, as the tab is open either way (and Android has no windows).
  if (tab.windowId === undefined) return
  try {
    await browser.windows.update(tab.windowId, { focused: true })
  } catch {
    // The tab still opened.
  }
}
