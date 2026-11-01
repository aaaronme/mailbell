import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import '@fontsource-variable/geist'
import '@fontsource-variable/source-serif-4'
import '@/entrypoints/popup/style.css'
import { answerBatches } from '@/lib/api/batch.testing'
import { PRESETS, type Theme } from '@/lib/theme'
import { ACCOUNTS, gmailApi, LAUNCH_PLAN, NEWSLETTER, NOW, PERSONAL, PHISHING, popupThreads, storageSeed, WORK } from './fixtures'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)

const { createAppRouter } = await import('@/entrypoints/popup/router')
const { setTokenSource, threadUrl } = await import('@/lib/api/gmail')
const { Toaster } = await import('@/components/ui/sonner')
const { useThemeSync } = await import('@/lib/theme')

const OUT = '../../docs/assets/store'
const POPUP = { width: 768, height: 580 }

const preset = (name: string) => PRESETS.find((it) => it.name === name)!
const theme = (mode: Theme['mode'], name: string): Theme => ({ mode, stops: preset(name).stops, brightness: preset(name).brightness })

function ThemeSync() {
  useThemeSync()
  return null
}

// What App.tsx wraps the router in, minus the background messaging.
async function mount(entry: string, { popout }: { popout: boolean }) {
  document.documentElement.classList.toggle('fixed-width-popup', !popout)
  if (popout) window.location.hash = `#${entry}`
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Toaster closeButton={true} />
      <ThemeSync />
      <RouterProvider router={createAppRouter([entry], { popout })} />
    </QueryClientProvider>,
  )
}

// The page's text, the mail bodies in their shadow roots included.
function visibleText() {
  const shadows = [...document.querySelectorAll('*')].flatMap((it) => (it.shadowRoot ? [it.shadowRoot.textContent] : []))
  return [document.body.innerText, ...shadows].join('\n')
}

// Loaded, laid out and painted: the text is in, nothing is loading, fonts are ready.
async function settle(...texts: string[]) {
  await vi.waitFor(
    () => {
      const body = visibleText()
      for (const text of texts) expect(body).toContain(text)
      expect(body).not.toContain('Loading')
    },
    { timeout: 15_000 },
  )
  await document.fonts.ready
  await new Promise((resolve) => setTimeout(resolve, 600))
}

const mailSearch = (params: Record<string, string>) => `/mail?${new URLSearchParams(params)}`
const openIn = (account: string, folder: string, thread: string) =>
  mailSearch({ account, folder, thread: threadUrl(account, thread) })

// The popup at its real size, framed on a 1280x800 canvas with a caption.
async function framedPopup(file: string, title: string, subtitle: string) {
  const base64 = await page.screenshot({ save: false, base64: true })
  document.body.innerHTML = ''
  document.documentElement.classList.remove('fixed-width-popup')
  await page.viewport(1280, 800)
  const canvas = document.createElement('div')
  canvas.innerHTML = `
    <div style="position:fixed;inset:0;z-index:100;display:flex;align-items:center;gap:56px;padding:0 64px 0 80px;
      background:linear-gradient(135deg,#00111b 0%,#06303f 100%);color:#fff;font-family:'Geist Variable',sans-serif">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;font-size:15px;color:rgb(255 255 255/.7)">
          <img src="/icon/48.png" style="width:24px;height:24px" alt="">Mailbell
        </div>
        <div style="margin-top:20px;font-family:'Source Serif 4 Variable',serif;font-size:42px;line-height:1.15">${title}</div>
        <div style="margin-top:16px;font-size:17px;line-height:1.5;color:rgb(255 255 255/.65)">${subtitle}</div>
      </div>
      <img src="data:image/png;base64,${base64}" alt="" style="width:${POPUP.width}px;height:${POPUP.height}px;flex:none;
        border-radius:12px;border:1px solid rgb(255 255 255/.1);box-shadow:0 24px 64px rgb(0 0 0/.45),0 4px 12px rgb(0 0 0/.3)">
    </div>`
  document.body.append(canvas)
  await Promise.all([...canvas.querySelectorAll('img')].map((it) => it.decode()))
  await document.fonts.ready
  await page.screenshot({ path: `${OUT}/${file}`, element: canvas.firstElementChild! })
  canvas.remove()
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  setTokenSource(async (account) => account)
  vi.stubGlobal('fetch', answerBatches(gmailApi))
})

beforeEach(async () => {
  fakeBrowser.reset()
  vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://example.invalid/')
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

it('1-popup', async () => {
  await browser.storage.local.set({ ...storageSeed(theme('dark', 'Navy')), accounts: ACCOUNTS, threads: popupThreads([PHISHING]) })
  await page.viewport(POPUP.width, POPUP.height)
  await mount('/', { popout: false })
  await settle('Dinner Saturday?', '482913')
  await framedPopup('1-popup.png', 'New mail at a glance', 'Unread mail from every account, right in the toolbar. Sign-in codes are ready to copy with one click.')
})

it('2-mail-client', async () => {
  await browser.storage.local.set(storageSeed(theme('dark', 'Navy')))
  await page.viewport(1280, 800)
  await mount(mailSearch({ account: 'all', folder: 'INBOX', thread: threadUrl(WORK, LAUNCH_PLAN) }), { popout: true })
  await settle('Q4 launch plan', 'Milestone', 'Your order has been delivered')
  await page.screenshot({ path: `${OUT}/2-mail-client.png` })
})

it('3-safe-view', async () => {
  await browser.storage.local.set(storageSeed(theme('dark', 'Graphite')))
  await page.viewport(1280, 800)
  await mount(openIn(PERSONAL, 'INBOX', PHISHING), { popout: true })
  await settle('This mail failed sender checks', 'Show formatted')
  await page.screenshot({ path: `${OUT}/3-safe-view.png` })
})

it('4-images-blocked', async () => {
  await browser.storage.local.set(storageSeed(theme('light', 'Ocean')))
  await page.viewport(1280, 800)
  await mount(openIn(PERSONAL, 'INBOX', NEWSLETTER), { popout: true })
  await settle('Images are hidden to protect your privacy', 'The quiet return of the paper map')
  await page.screenshot({ path: `${OUT}/4-images-blocked.png` })
})

it('5-themes', async () => {
  await browser.storage.local.set(storageSeed(theme('dark', 'Dusk')))
  await page.viewport(POPUP.width, POPUP.height)
  await mount('/settings', { popout: false })
  await settle('Appearance', 'Brightness')
  // Scrolled to Appearance, just under the sticky header.
  const appearance = [...document.querySelectorAll('section')].find((it) => it.textContent?.startsWith('Appearance'))!
  document.body.scrollTop = appearance.offsetTop - 48
  await framedPopup('5-themes.png', 'Make it yours', 'A colour or a two-tone gradient, light or dark. The popup and the mail client follow it.')
})
