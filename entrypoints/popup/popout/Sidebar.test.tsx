import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

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
  },
  [B]: {
    INBOX: { id: 'INBOX', name: 'INBOX', type: 'system', threadsUnread: 2 },
    SPAM: { id: 'SPAM', name: 'SPAM', type: 'system', threadsUnread: 0 },
  },
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const account = (init.headers as Record<string, string>).Authorization!.replace('Bearer ', '')
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
    await expect.element(screen.getByRole('button', { name: /^All inboxes\s*5$/ })).toBeInTheDocument()
  })

  it('nests child labels under their parent', async () => {
    const { screen } = await mount()
    await expect.element(screen.getByRole('button', { name: 'Work', exact: true })).toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: /^Clients\s*4$/ })).toBeInTheDocument()
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
    await expect.element(screen.getByRole('button', { name: /^Clients\s*4$/ })).toBeInTheDocument()
    await screen.getByRole('button', { name: 'Reconnect' }).click()
    expect(send).toHaveBeenCalledWith('addAccount', B)
  })
})
