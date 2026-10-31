import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)

const { createAppRouter } = await import('../router')
const { setTokenSource } = await import('@/lib/api/gmail')
const { rowDate } = await import('./ThreadListRow')

const A = 'a@example.com'

let labels: object[] = []
// Thread ids whose newest message says "Your code is 482913".
let codeThreads: string[] = []
// The thread whose Authentication-Results fail.
let failingAuth = ''
// Thread ids whose snippet carries an HTML-entity dash after the word "code".
let entityThreads: string[] = []
let emptyList = false
const listRequests: URL[] = []
const actionRequests: string[] = []

const json = (body: object) => new Response(JSON.stringify(body))

function threadBody(id: string) {
  const n = Number(id.slice(1))
  const snippet = codeThreads.includes(id)
    ? 'Your code is 482913'
    : entityThreads.includes(id)
      ? 'Verification code &#8211; welcome'
      : `Snippet ${n}`
  const headers = [
    { name: 'From', value: 'Bob <bob@example.org>' },
    { name: 'To', value: A },
    { name: 'Subject', value: `Subject ${n}` },
    ...(id === failingAuth
      ? [{ name: 'Authentication-Results', value: 'mx.google.com; dkim=fail header.d=example.org' }]
      : []),
  ]
  return {
    id,
    snippet,
    messages: [{ id: `m${n}`, labelIds: ['INBOX'], snippet, internalDate: String(Date.now()), payload: { headers } }],
  }
}

function stubFetch() {
  listRequests.length = 0
  actionRequests.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const path = url.pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
      if (init?.method === 'POST') {
        actionRequests.push(path)
        return json({})
      }
      if (path === '/threads') {
        listRequests.push(url)
        if (emptyList) return json({})
        const second = url.searchParams.has('pageToken')
        const [from, count] = second ? [50, 10] : [0, 50]
        return json({
          threads: Array.from({ length: count }, (_, i) => ({ id: `t${from + i}` })),
          ...(second ? {} : { nextPageToken: 'p2' }),
        })
      }
      if (path.startsWith('/threads/')) return json(threadBody(path.slice('/threads/'.length)))
      if (path === '/labels') return json({ labels })
      const id = decodeURIComponent(path.replace('/labels/', ''))
      return json(labels.find((it) => (it as { id: string }).id === id) ?? {})
    }),
  )
}

// The test runner appends its own query to the hash, which lands on the last
// param; `cat` is the one that tolerates it.
async function mount(search = `account=${A}&folder=INBOX&cat=primary`) {
  await page.viewport(1200, 800)
  window.location.hash = `#/mail?${search}`
  const router = createAppRouter([`/mail?${search}`], { popout: true })
  const screen = await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, screen }
}

const rows = () => document.querySelectorAll('[data-testid="thread-list"] [data-row]')

describe('ThreadList', () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
    await browser.storage.local.set({
      oauthAccounts: [{ email: A, refreshToken: 'r', accessToken: 't', expiresAt: 0 }],
    })
    setTokenSource(async (account) => account)
    labels = [{ id: 'INBOX', name: 'INBOX', type: 'system', threadsUnread: 3 }]
    codeThreads = []
    failingAuth = ''
    entityThreads = []
    emptyList = false
    stubFetch()
  })

  it('renders rows and loads the next page on scroll', async () => {
    await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    document.querySelector('[data-testid="thread-sentinel"]')!.scrollIntoView()
    await vi.waitFor(() => expect(rows()).toHaveLength(60))
  })

  it('unread switch', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    await screen.getByRole('button', { name: 'Unread', exact: true }).click()
    await vi.waitFor(() => expect(listRequests.at(-1)!.searchParams.getAll('labelIds')).toContain('UNREAD'))
  })

  it('category tabs only for used categories', async () => {
    labels = [
      { id: 'INBOX', name: 'INBOX', type: 'system' },
      { id: 'CATEGORY_PERSONAL', name: 'CATEGORY_PERSONAL', type: 'system', threadsTotal: 9 },
      { id: 'CATEGORY_SOCIAL', name: 'CATEGORY_SOCIAL', type: 'system', threadsTotal: 4, threadsUnread: 2 },
      { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system', threadsTotal: 0 },
    ]
    const { screen } = await mount()
    await expect.element(screen.getByRole('tab', { name: /^Social/ })).toBeInTheDocument()
    await expect.element(screen.getByRole('tab', { name: /^Primary/ })).toBeInTheDocument()
    expect(screen.getByRole('tab').elements()).toHaveLength(2)
  })

  it('search sets q', async () => {
    const { screen, router } = await mount()
    await screen.getByRole('searchbox', { name: 'Search mail' }).fill('from:bob')
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'from:bob' }))
    await expect.element(screen.getByRole('heading', { name: 'Results for “from:bob”' })).toBeInTheDocument()
  })

  it('shift-click checks a range', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    const box = (n: number) => document.querySelector<HTMLInputElement>(`[aria-label="Select Subject ${n}"]`)!
    box(2).click()
    box(5).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
    await expect.element(screen.getByText('4 selected')).toBeInTheDocument()
  })

  it('suspicious row hides the code', async () => {
    failingAuth = 't1'
    codeThreads = ['t1']
    await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    expect(document.querySelector('[data-testid="thread-list"] .text-bell')).toBeNull()
    expect(document.querySelector('[data-row="t1"] [data-suspicious]')).not.toBeNull()
  })

  it('shows the code on a trustworthy row', async () => {
    codeThreads = ['t3']
    await mount()
    await vi.waitFor(() => expect(document.querySelector('.text-bell')?.textContent).toBe('482913'))
  })

  it('a shift-click after Clear does not use the old anchor', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    const box = (n: number) => document.querySelector<HTMLInputElement>(`[aria-label="Select Subject ${n}"]`)!
    box(2).click()
    await screen.getByRole('button', { name: 'Clear' }).click()
    box(5).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
    await expect.element(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('Unread back to All drops the UNREAD label', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    await screen.getByRole('button', { name: 'Unread', exact: true }).click()
    await vi.waitFor(() => expect(listRequests.at(-1)!.searchParams.getAll('labelIds')).toContain('UNREAD'))
    await screen.getByRole('button', { name: 'All', exact: true }).click()
    await vi.waitFor(() => expect(listRequests.at(-1)!.searchParams.getAll('labelIds')).not.toContain('UNREAD'))
  })

  it('clearing the search removes q', async () => {
    const { screen, router } = await mount(`account=${A}&q=hello&folder=INBOX&cat=primary`)
    await expect.element(screen.getByRole('heading', { name: 'Results for “hello”' })).toBeInTheDocument()
    await screen.getByRole('button', { name: 'Clear search' }).click()
    await vi.waitFor(() => expect(router.state.location.search).not.toHaveProperty('q'))
  })

  it('bulk Delete trashes every checked thread and clears the selection', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    const box = (n: number) => document.querySelector<HTMLInputElement>(`[aria-label="Select Subject ${n}"]`)!
    box(1).click()
    box(2).click()
    await screen.getByRole('button', { name: 'Delete' }).click()
    await vi.waitFor(() => expect(actionRequests.sort()).toEqual(['/threads/t1/trash', '/threads/t2/trash']))
    await expect.element(screen.getByText('2 selected')).not.toBeInTheDocument()
  })

  it('keeps the selection when the bulk action fails', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    const ok = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('no', { status: 500 }) : ok(input, init),
    ))
    document.querySelector<HTMLInputElement>('[aria-label="Select Subject 1"]')!.click()
    await screen.getByRole('button', { name: 'Delete' }).click()
    await new Promise((r) => setTimeout(r, 300))
    await expect.element(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    emptyList = true
    const { screen } = await mount()
    await expect.element(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('an entity in the snippet is not read as a code', async () => {
    entityThreads = ['t4']
    await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    expect(document.querySelector('.text-bell')).toBeNull()
    expect(document.querySelector('[data-row="t4"]')!.textContent).toContain('Verification code – welcome')
  })

  it('keeps loading after a page that adds no rows', async () => {
    await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    document.querySelector('[data-testid="thread-sentinel"]')!.scrollIntoView()
    await vi.waitFor(() => expect(rows()).toHaveLength(60))
    expect(document.querySelector('[data-testid="thread-sentinel"]')).toBeNull()
  })
})

describe('rowDate', () => {
  const now = new Date(2026, 9, 31, 15, 0) // Saturday
  it('shows the time today, the weekday within 6 days, the date from 7', () => {
    expect(rowDate(new Date(2026, 9, 31, 9, 5).toISOString(), now)).toBe('09:05')
    expect(rowDate(new Date(2026, 9, 25, 23, 0).toISOString(), now)).toBe('Sun')
    expect(rowDate(new Date(2026, 9, 24, 9, 0).toISOString(), now)).toBe('24 Oct')
  })
})
