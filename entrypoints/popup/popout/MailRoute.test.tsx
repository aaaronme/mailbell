import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { threadUrl } from '@/lib/api/gmail'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)

const { createAppRouter } = await import('../router')
const { setTokenSource } = await import('@/lib/api/gmail')
const { getAccessToken } = await import('@/lib/auth/oauth')
const { queryClient } = await import('@/lib/queryClient')
const { notifyRefreshPopup } = await import('@/lib/mail/live')

const THREAD = threadUrl('a@example.com', 'abc')

// Tailwind is not loaded in tests, so the empty placeholders have no size:
// presence, not visibility, tells the panes apart.

// Hash history reads the page's own location, so the start is set there.
// The live checker patches the app's own client, so a test of it must share that.
async function mount(hash: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  window.location.hash = hash
  const router = createAppRouter([hash.slice(1)], { popout: true })
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, screen }
}

describe('MailRoute', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
  })

  it('shows all three panes on a wide viewport', async () => {
    await page.viewport(1200, 800)
    const { screen } = await mount('#/mail')
    await expect.element(screen.getByTestId('sidebar')).toBeInTheDocument()
    await expect.element(screen.getByTestId('thread-list')).toBeInTheDocument()
    await expect.element(screen.getByTestId('reading-pane')).toBeInTheDocument()
  })

  it('hides the sidebar behind a toggle below 1000px', async () => {
    await page.viewport(900, 800)
    const { screen } = await mount('#/mail')
    await expect.element(screen.getByTestId('thread-list')).toBeInTheDocument()
    await expect.element(screen.getByTestId('sidebar')).not.toBeInTheDocument()
    await screen.getByTitle('Show sidebar').click()
    await expect.element(screen.getByTestId('sidebar')).toBeInTheDocument()
  })

  it('closes the sidebar overlay on Escape', async () => {
    await page.viewport(900, 800)
    const { screen } = await mount('#/mail')
    await screen.getByTitle('Show sidebar').click()
    await expect.element(screen.getByTestId('sidebar')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByTestId('sidebar')).not.toBeInTheDocument()
  })

  it('closes the sidebar overlay when the viewport becomes wide', async () => {
    await page.viewport(900, 800)
    const { screen } = await mount('#/mail')
    await screen.getByTitle('Show sidebar').click()
    await page.viewport(1200, 800)
    // Wide: the sidebar is inline, so the overlay is gone.
    await vi.waitFor(() => expect(document.querySelector('.absolute [data-testid="sidebar"]')).toBeNull())
    await page.viewport(900, 800)
    await expect.element(screen.getByTestId('sidebar')).not.toBeInTheDocument()
  })

  it('is single-pane below 700px, and Back clears the thread', async () => {
    await page.viewport(600, 800)
    const { screen, router } = await mount(`#/mail?thread=${encodeURIComponent(THREAD)}`)
    await expect.element(screen.getByTestId('reading-pane')).toBeInTheDocument()
    await expect.element(screen.getByTestId('thread-list')).not.toBeInTheDocument()
    await screen.getByTitle('Back').click()
    await expect.element(screen.getByTestId('thread-list')).toBeInTheDocument()
    await expect.element(screen.getByTestId('reading-pane')).not.toBeInTheDocument()
    expect(router.state.location.search.thread).toBeUndefined()
  })

  it('reads a thread url containing ? and # back intact under hash history', async () => {
    await page.viewport(1200, 800)
    const { router } = await mount('#/mail')
    await router.navigate({ to: '/mail', search: { account: 'all', folder: 'INBOX', thread: THREAD } })
    expect(THREAD).toContain('#inbox/abc')
    expect(router.state.location.search.thread).toBe(THREAD)
    expect(window.location.hash.startsWith('#/mail')).toBe(true)
    expect(window.location.hash.indexOf('#', 1)).toBe(-1)
  })

  it('redirects / to /mail in the popout', async () => {
    await page.viewport(1200, 800)
    const { router } = await mount('#/')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/mail'))
  })

  it('leaves the popup router on the index page', async () => {
    await page.viewport(1200, 800)
    const router = createAppRouter(['/'])
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(document.querySelector('[data-testid="sidebar"]')).toBeNull()
  })
  describe('refreshPopup', () => {
    const A = 'a@example.com'
    let snippetOfB = ''
    let profileId = '1'
    let fetchMock: ReturnType<typeof vi.fn>

    const threadBody = (id: string, snippet: string) => ({
      id,
      snippet,
      historyId: profileId,
      messages: [
        {
          id: `m${id}`,
          labelIds: ['INBOX'],
          snippet,
          internalDate: String(Date.now() - (id === 'A' ? 0 : 1000)),
          payload: {
            headers: [
              { name: 'From', value: 'Bob <bob@example.org>' },
              { name: 'Subject', value: `Subject ${id}` },
            ],
          },
        },
      ],
    })

    let historyStatus = 200
    let profileServed = 0
    // While set, B's list rows and open thread wait for it.
    let hold: Promise<void> | undefined
    let release = () => {}
    let held = 0

    beforeEach(async () => {
      await browser.storage.local.set({
        oauthAccounts: [{ email: A, refreshToken: 'r', accessToken: 't', expiresAt: 0 }],
      })
      setTokenSource(async (account) => account)
      queryClient.clear()
      snippetOfB = 'old snippet'
      profileId = '1'
      historyStatus = 200
      profileServed = 0
      hold = undefined
      held = 0
      fetchMock = vi.fn(async (input: string) => {
        const url = new URL(input)
        const path = url.pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
        if (path === '/profile') {
          profileServed++
          return Response.json({ historyId: profileId })
        }
        if (path === '/history') {
          if (historyStatus !== 200) return new Response('', { status: historyStatus })
          const added = [{ message: { id: 'mB', threadId: 'B' }, labelIds: ['STARRED'] }]
          return Response.json({ history: [{ labelsAdded: added }], historyId: profileId })
        }
        const wait = hold
        if (path === '/threads') {
          if (wait) held++
          await wait
          return Response.json({ threads: [{ id: 'A' }, { id: 'B' }] })
        }
        if (path.startsWith('/threads/')) {
          const id = path.slice('/threads/'.length)
          if (wait && id === 'B') held++
          if (id === 'B') await wait
          return Response.json(threadBody(id, id === 'B' ? snippetOfB : 'snippet A'))
        }
        return Response.json({ labels: [] })
      })
      vi.stubGlobal('fetch', fetchMock)
    })
    afterEach(() => {
      release()
      vi.unstubAllGlobals()
      vi.stubGlobal('browser', fakeBrowser)
      vi.stubGlobal('chrome', fakeBrowser)
      setTokenSource(getAccessToken)
      queryClient.clear()
    })

    const reading = () => document.querySelector('[data-testid="reading-pane"]')!.textContent ?? ''
    const listText = () => document.querySelector('[data-testid="thread-list"]')!.textContent ?? ''

    // B is open; a refresh brings a new snippet for it. Whatever the refresh
    // does to the caches, B's content stays on screen until the new data lands.
    async function refreshWithB() {
      const search = `account=${A}&folder=INBOX&thread=${encodeURIComponent(threadUrl(A, 'B'))}&cat=primary`
      await page.viewport(1200, 800)
      const { router } = await mount(`#/mail?${search}`, queryClient)
      await vi.waitFor(() => expect(listText()).toContain('old snippet'))
      await vi.waitFor(() => expect(reading()).toContain('bob@example.org'))
      // The first check seeds the history id; only a later one finds changes.
      await vi.waitFor(() => expect(profileServed).toBe(1))
      await new Promise((r) => setTimeout(r, 0))
      hold = new Promise<void>((resolve) => (release = resolve))
      snippetOfB = 'new snippet'
      profileId = '2'
      notifyRefreshPopup()
      await vi.waitFor(() => expect(held).toBeGreaterThan(0))
      expect(listText()).toContain('old snippet')
      expect(reading()).toContain('bob@example.org')
      expect(reading()).not.toContain('No conversation selected')
      release()
      await vi.waitFor(() => expect(listText()).toContain('new snippet'))
      expect(listText()).not.toContain('old snippet')
      expect(reading()).toContain('bob@example.org')
      expect(router.state.location.search.thread).toBe(threadUrl(A, 'B'))
    }

    it('patches the open thread in place, keeping it on screen while its row is fetched', refreshWithB)

    it('keeps the open thread on screen while an expired history reloads the lists', async () => {
      historyStatus = 404
      await refreshWithB()
    })
  })
})
