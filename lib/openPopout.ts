import { parseThreadUrl } from './api/gmail'
import { popupMessager } from './messager'

// The hash is built by hand rather than with the router's serializer: lib is
// imported by the background, and the serializer only ships behind the React
// entry. The router parses it back the same way for any value.
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
  if (reused !== true) await browser.tabs.create({ url: popoutUrl(threadUrl) })
}
