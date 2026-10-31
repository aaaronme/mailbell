import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { toast } from 'sonner'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)

const { createAppRouter } = await import('../router')
const { setTokenSource } = await import('@/lib/api/gmail')
const { OAuthError } = await import('@/lib/auth/oauth')
const { bgMessager } = await import('@/lib/messager')

const A = 'a@example.com'
const B = 'b@example.com'

const LABELS: Record<string, Record<string, object>> = {
  [A]: {
    INBOX: { id: 'INBOX', name: 'INBOX', type: 'system', threadsUnread: 3 },
    SPAM: { id: 'SPAM', name: 'SPAM', type: 'system', threadsUnread: 0 },
    L1: { id: 'L1', name: 'Work', type: 'user', threadsUnread: 0 },
    L2: { id: 'L2', name: 'Work/Clients', type: 'user', threadsUnread: 4 },
    L3: { id: 'L3', name: 'Stuff/Acme', type: 'user', threadsUnread: 0 },
  },
  [B]: {
    INBOX: { id: 'INBOX', name: 'INBOX', type: 'system', threadsUnread: 2 },
    SPAM: { id: 'SPAM', name: 'SPAM', type: 'system', threadsUnread: 0 },
  },
}

// B's labels fail with a 500 while this is set.
let failB = false
const fetchCalls: { account: string; path: string }[] = []

function stubFetch() {
  failB = false
  fetchCalls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const account = (init.headers as Record<string, string>).Authorization!.replace('Bearer ', '')
      fetchCalls.push({ account, path: new URL(input).pathname })
      if (failB && account === B) return new Response('boom', { status: 500 })
      const path = new URL(input).pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
      const labels = LABELS[account]!
      const json = (body: object) => new Response(JSON.stringify(body))
      if (path === '/labels') return json({ labels: Object.values(labels) })
      const id = decodeURIComponent(path.replace('/labels/', ''))
      return json(labels[id] ?? {})
    }),
  )
}

async function mount() {
  await page.viewport(1200, 800)
  window.location.hash = '#/mail'
  const router = createAppRouter(['/mail'], { popout: true })
  const screen = await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, screen }
}

describe('Sidebar', () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
    await browser.storage.local.set({
      oauthAccounts: [A, B].map((email) => ({ email, refreshToken: 'r', accessToken: 't', expiresAt: 0 })),
    })
    setTokenSource(async (account) => account)
    stubFetch()
  })

  it('sums the inbox counts under All inboxes', async () => {
    const { screen } = await mount()
    await expect.element(screen.getByRole('button', { name: /^All inboxes, 5 unread$/ })).toBeInTheDocument()
  })

  it('nests child labels under their parent', async () => {
    const { screen } = await mount()
    await expect.element(screen.getByRole('button', { name: 'Work', exact: true })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: /^Clients, 4 unread$/ })).toBeInTheDocument()
  })

  it('navigates to a folder of the clicked account', async () => {
    const { router } = await mount()
    const spam = () => document.querySelector<HTMLElement>(`[data-account="${B}"] [data-folder="SPAM"]`)
    await vi.waitFor(() => expect(spam()).not.toBeNull())
    spam()!.click()
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ account: B, folder: 'SPAM' }))
  })

  it('offers Reconnect for an account whose sign-in failed, and keeps the others', async () => {
    setTokenSource(async (account) => {
      if (account === B) throw new OAuthError('needs_reauth', B)
      return account
    })
    const send = vi.spyOn(bgMessager, 'sendMessage').mockResolvedValue(B as never)
    const { screen } = await mount()
    await expect.element(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: /^Clients, 4 unread$/ })).toBeInTheDocument()
    await screen.getByRole('button', { name: 'Reconnect' }).click()
    expect(send).toHaveBeenCalledWith('addAccount', B)
  })

  it('toggles a prefix-only parent instead of navigating', async () => {
    const { screen, router } = await mount()
    const parent = screen.getByRole('button', { name: 'Stuff', exact: true })
    await expect.element(screen.getByRole('button', { name: 'Acme' })).toBeInTheDocument()
    await parent.click()
    await expect.element(screen.getByRole('button', { name: 'Acme' })).not.toBeInTheDocument()
    expect(router.state.location.search).toMatchObject({ account: 'all', folder: 'INBOX' })
  })

  it('marks the active entry inverted, with a lighter count', async () => {
    const { screen } = await mount()
    const all = screen.getByRole('button', { name: /^All inboxes/ })
    await expect.element(all).toHaveClass('bg-emphasis', 'text-emphasis-foreground')
    await expect.element(all.getByText('5', { exact: true })).toHaveClass('text-emphasis-foreground/70')
  })

  it('collapses an account section', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(document.querySelector(`[data-account="${A}"] [data-folder="SPAM"]`)).not.toBeNull())
    await screen.getByRole('button', { name: A, exact: true }).click()
    expect(document.querySelector(`[data-account="${A}"] [data-folder]`)).toBeNull()
  })

  it('opens Settings', async () => {
    const { screen, router } = await mount()
    await screen.getByRole('button', { name: 'Settings' }).click()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
  })

  it('closes the overlay after a navigation', async () => {
    await page.viewport(900, 800)
    window.location.hash = '#/mail'
    const router = createAppRouter(['/mail'], { popout: true })
    const screen = await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    await screen.getByTitle('Show sidebar').click()
    await screen.getByRole('button', { name: 'All inboxes' }).click()
    await expect.element(screen.getByTestId('sidebar')).not.toBeInTheDocument()
  })

  it('seeds correspondents once per account, even with the sidebar closed', async () => {
    await page.viewport(900, 800)
    window.location.hash = '#/mail'
    const router = createAppRouter(['/mail'], { popout: true })
    await render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const sent = (account: string) =>
      fetchCalls.filter((it) => it.account === account && it.path.endsWith('/messages')).length
    await vi.waitFor(() => expect([sent(A), sent(B)]).toEqual([1, 1]))
  })

  it('says labels failed to load and retries', async () => {
    failB = true
    const { screen } = await mount()
    await expect.element(screen.getByText("Couldn't load labels")).toBeInTheDocument()
    failB = false
    await screen.getByRole('button', { name: 'Retry' }).click()
    await expect.element(screen.getByText("Couldn't load labels")).not.toBeInTheDocument()
  })

  it('shows a toast, not an unhandled rejection, when sign-in fails', async () => {
    vi.spyOn(bgMessager, 'sendMessage').mockRejectedValue(new Error('denied'))
    const error = vi.spyOn(toast, 'error').mockReturnValue('')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { screen } = await mount()
    await screen.getByRole('button', { name: 'Add account' }).click()
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Sign-in failed: denied'))
  })
})
