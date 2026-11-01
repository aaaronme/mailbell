import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { fakeBrowser } from '@webext-core/fake-browser'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { answerBatches } from '@/lib/api/batch.testing'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)

const { createAppRouter } = await import('../router')
const { setTokenSource } = await import('@/lib/api/gmail')
const { rowDate } = await import('./ThreadListRow')
const { threadUrl } = await import('@/lib/api/gmail')

const A = 'a@example.com'

let labels: object[] = []
// Thread ids whose newest message says "Your code is 482913".
let codeThreads: string[] = []
// The thread whose Authentication-Results fail.
let failingAuth = ''
// Thread ids whose snippet carries an HTML-entity dash after the word "code".
let entityThreads: string[] = []
let emptyList = false
// Thread ids that come back unread.
let unreadThreads: string[] = []
// The second page repeats the first page's last thread, as after new mail.
let overlap = false
// The thread list answers once this settles.
let listGate: Promise<unknown> = Promise.resolve()
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
    messages: [{ id: `m${n}`, labelIds: unreadThreads.includes(id) ? ['INBOX', 'UNREAD'] : ['INBOX'], snippet, internalDate: String(Date.now()), payload: { headers } }],
  }
}

function stubFetch() {
  listRequests.length = 0
  actionRequests.length = 0
  vi.stubGlobal(
    'fetch',
    answerBatches(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      const path = url.pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
      if (init?.method === 'POST') {
        actionRequests.push(path)
        return json({})
      }
      if (path === '/threads') {
        listRequests.push(url)
        await listGate
        if (emptyList) return json({})
        const second = url.searchParams.has('pageToken')
        const [from, count] = second ? (overlap ? [49, 11] : [50, 10]) : [0, 50]
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
    unreadThreads = []
    listGate = Promise.resolve()
    overlap = false
    stubFetch()
  })

  it('renders rows and loads the next page on scroll', async () => {
    await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    document.querySelector('[data-testid="thread-sentinel"]')!.scrollIntoView()
    await vi.waitFor(() => expect(rows()).toHaveLength(60))
  })

  it('leaves freshness to live updates: focusing the tab refetches nothing', async () => {
    const calls = () => vi.mocked(fetch).mock.calls.length
    await mount(`account=${A}&folder=INBOX&thread=${encodeURIComponent(`https://mail.google.com/mail/?authuser=${encodeURIComponent(A)}#inbox/t1`)}&cat=primary`)
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    await new Promise((r) => setTimeout(r, 300))
    const before = calls()
    const lists = listRequests.length
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await new Promise((r) => setTimeout(r, 300))
    focusManager.setFocused(undefined)
    expect(listRequests.length).toBe(lists)
    expect(calls()).toBe(before)
  })

  const toFolder = (router: Awaited<ReturnType<typeof mount>>['router'], folder: string) =>
    router.navigate({ to: '/mail', search: (prev: object) => ({ ...prev, folder }) } as never)
  const listsOf = (label: string) => listRequests.filter((it) => it.searchParams.getAll('labelIds').includes(label))

  it('shows a folder it already loaded again without fetching it', async () => {
    const { router } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    await toFolder(router, 'SPAM')
    await vi.waitFor(() => expect(listsOf('SPAM')).toHaveLength(1))
    await toFolder(router, 'INBOX')
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    await new Promise((r) => setTimeout(r, 300))
    expect(listsOf('INBOX')).toHaveLength(1)
  })

  // Its requests would spend the quota the next folder needs.
  it('cancels the load of a folder left before it arrives', async () => {
    listGate = new Promise(() => {})
    const { router } = await mount()
    await vi.waitFor(() => expect(listsOf('INBOX')).toHaveLength(1))
    await toFolder(router, 'SPAM')
    const inbox = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('labelIds=INBOX'))!
    await vi.waitFor(() => expect(inbox[1]?.signal?.aborted).toBe(true))
  })

  it('shows a thread two pages both carry once', async () => {
    overlap = true
    await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    document.querySelector('[data-testid="thread-sentinel"]')!.scrollIntoView()
    await vi.waitFor(() => expect(document.querySelector('[data-row="t59"]')).not.toBeNull())
    expect(document.querySelectorAll('[data-row="t49"]')).toHaveLength(1)
    expect(rows()).toHaveLength(60)
  })

  it('unread switch', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    await expect
      .element(screen.getByRole('button', { name: 'All', exact: true }))
      .toHaveClass('bg-emphasis', 'text-emphasis-foreground')
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

  it('Unread back to All drops the UNREAD label, showing All as already loaded', async () => {
    const { screen, router } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    await screen.getByRole('button', { name: 'Unread', exact: true }).click()
    await vi.waitFor(() => expect(listRequests.at(-1)!.searchParams.getAll('labelIds')).toContain('UNREAD'))
    const lists = listRequests.length
    await screen.getByRole('button', { name: 'All', exact: true }).click()
    await vi.waitFor(() => expect(router.state.location.search).not.toHaveProperty('unread'))
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    expect(listRequests).toHaveLength(lists)
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

  it('bulk Restore untrashes in Trash, with no Delete or Archive', async () => {
    const { screen } = await mount(`account=${A}&folder=TRASH&cat=primary`)
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    document.querySelector<HTMLInputElement>('[aria-label="Select Subject 1"]')!.click()
    await expect.element(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument()
    const bar = screen.getByText('1 selected').element().parentElement!
    expect(bar.querySelector('[aria-label="Delete"], [aria-label="Archive"]')).toBeNull()
    await screen.getByRole('button', { name: 'Restore' }).click()
    await vi.waitFor(() => expect(actionRequests).toEqual(['/threads/t1/untrash']))
  })

  it('bulk Not spam in Spam, with no Spam or Archive', async () => {
    const { screen } = await mount(`account=${A}&folder=SPAM&cat=primary`)
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    document.querySelector<HTMLInputElement>('[aria-label="Select Subject 1"]')!.click()
    await expect.element(screen.getByRole('button', { name: 'Not spam' })).toBeInTheDocument()
    const bar = screen.getByText('1 selected').element().parentElement!
    expect(bar.querySelector('[aria-label="Spam"], [aria-label="Archive"]')).toBeNull()
    await screen.getByRole('button', { name: 'Not spam' }).click()
    await vi.waitFor(() => expect(actionRequests).toEqual(['/threads/t1/modify']))
  })

  it('keeps the selection when the bulk action fails', async () => {
    const { screen } = await mount()
    await vi.waitFor(() => expect(rows()).toHaveLength(50))
    const ok = globalThis.fetch
    vi.stubGlobal('fetch', answerBatches(async (input: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Response('no', { status: 500 }) : ok(input, init),
    ))
    document.querySelector<HTMLInputElement>('[aria-label="Select Subject 1"]')!.click()
    await screen.getByRole('button', { name: 'Delete' }).click()
    await new Promise((r) => setTimeout(r, 300))
    await expect.element(screen.getByText('1 selected')).toBeInTheDocument()
  })

  // The open thread is about to be marked read; a dot that lingers for the
  // delay only flickers.
  it('shows no unread dot on the open row, unless marked unread there', async () => {
    unreadThreads = ['t0', 't1']
    const { screen } = await mount(`account=${A}&folder=INBOX&thread=${encodeURIComponent(threadUrl(A, 't0'))}&cat=primary`)
    const dot = (id: string) => document.querySelector(`[data-row="${id}"] [aria-label="Unread"]`)
    await vi.waitFor(() => expect(dot('t1')).not.toBeNull())
    expect(dot('t0')).toBeNull()
    await screen.getByTitle('Mark unread (Shift+U)').click()
    await vi.waitFor(() => expect(dot('t0')).not.toBeNull())
  })

  it('shows the empty state', async () => {
    emptyList = true
    const { screen } = await mount()
    await expect.element(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('says it is loading until the first rows arrive', async () => {
    let open!: () => void
    listGate = new Promise<void>((resolve) => (open = resolve))
    const { screen } = await mount()
    await expect.element(screen.getByText('Loading…')).toBeInTheDocument()
    open()
    await expect.element(screen.getByText('Subject 0', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Loading…').elements()).toHaveLength(0)
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

describe('ThreadList in All inboxes', () => {
  const B = 'b@example.org'
  // Per account: thread id -> [sender, minutes ago]. A missing account fails its list call.
  let inboxes: Record<string, Record<string, [string, number]>>
  // Per account: the threads of its second page, if it has one.
  let later: Record<string, Record<string, [string, number]>>
  // The accounts whose list call carried a pageToken, in order.
  let pageTokenCalls: string[]
  // Per account: what labels.list and labels.get answer.
  let accountLabels: Record<string, ({ id: string } & Record<string, unknown>)[]>

  beforeEach(async () => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
    await browser.storage.local.set({
      oauthAccounts: [
        { email: A, refreshToken: 'r', accessToken: 't', expiresAt: 0 },
        { email: B, refreshToken: 'r', accessToken: 't', expiresAt: 0 },
      ],
      correspondents: { [B]: ['pal@paypal.com'] },
      correspondentsBootstrapped: [A, B],
    })
    setTokenSource(async (account) => account)
    labels = []
    later = {}
    pageTokenCalls = []
    accountLabels = {}
    vi.stubGlobal(
      'fetch',
      answerBatches(async (input: string, init?: RequestInit) => {
        const url = new URL(input)
        const path = url.pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
        const account = new Headers(init?.headers).get('Authorization')!.replace('Bearer ', '')
        if (path === '/threads') {
          const own = inboxes[account]
          if (!own) return new Response('no', { status: 500 })
          const second = url.searchParams.has('pageToken')
          if (second) pageTokenCalls.push(account)
          const ids = Object.keys(second ? later[account]! : own)
          return json({ threads: ids.map((id) => ({ id })), ...(!second && later[account] ? { nextPageToken: 'p2' } : {}) })
        }
        if (path.startsWith('/threads/')) {
          const id = path.slice('/threads/'.length)
          const [from, minutes] = (inboxes[account]![id] ?? later[account]![id])!
          const headers = [
            { name: 'From', value: `Pat <${from}>` },
            { name: 'Subject', value: `Subject ${id}` },
          ]
          return json({
            id,
            messages: [
              { id: `m${id}`, labelIds: ['INBOX'], internalDate: String(Date.now() - minutes * 60_000), payload: { headers } },
            ],
          })
        }
        const own = accountLabels[account] ?? []
        if (path === '/labels') return json({ labels: own })
        return json(own.find((it) => it.id === decodeURIComponent(path.replace('/labels/', ''))) ?? {})
      }),
    )
  })

  const order = () => [...rows()].map((it) => it.getAttribute('data-row'))

  it('shows the category tabs any account uses, with summed counts, under All inboxes', async () => {
    inboxes = { [A]: { a1: ['x@example.net', 5] }, [B]: { b1: ['x@example.net', 10] } }
    const social = (total: number, unread: number) => ({
      id: 'CATEGORY_SOCIAL',
      name: 'CATEGORY_SOCIAL',
      type: 'system',
      threadsTotal: total,
      threadsUnread: unread,
    })
    accountLabels = {
      [A]: [social(2, 1), { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system', threadsTotal: 0 }],
      [B]: [social(3, 2)],
    }
    const { screen } = await mount('account=all&folder=INBOX&cat=primary')
    await expect.element(screen.getByRole('heading', { name: 'All inboxes' })).toBeInTheDocument()
    await expect.element(screen.getByRole('tab', { name: /^Social/ })).toBeInTheDocument()
    expect(screen.getByRole('tab').elements().map((it) => it.textContent)).toEqual(['Primary', 'Social3'])
  })

  it('merges accounts newest first', async () => {
    inboxes = {
      [A]: { a1: ['x@example.net', 5], a2: ['x@example.net', 30] },
      [B]: { b1: ['x@example.net', 10], b2: ['x@example.net', 20] },
    }
    await mount('account=all&folder=INBOX&cat=primary')
    await vi.waitFor(() => expect(order()).toEqual(['a1', 'b1', 'b2', 'a2']))
  })

  it('pages the account that limits the cut, then shows the rows it held back', async () => {
    inboxes = {
      [A]: { a1: ['x@example.net', 5], a2: ['x@example.net', 30] },
      [B]: { b1: ['x@example.net', 10], b2: ['x@example.net', 60] },
    }
    later = { [A]: { a3: ['x@example.net', 40], a4: ['x@example.net', 50] } }
    await mount('account=all&folder=INBOX&cat=primary')
    await vi.waitFor(() => expect(order()).toEqual(['a1', 'b1', 'a2', 'a3', 'a4', 'b2']))
    expect(document.querySelector('[data-testid="thread-sentinel"]')).toBeNull()
  })

  it('with both accounts paged, only the limiting one is fetched each round', async () => {
    inboxes = {
      [A]: { a1: ['x@example.net', 5], a2: ['x@example.net', 30] },
      [B]: { b1: ['x@example.net', 10], b2: ['x@example.net', 20] },
    }
    later = { [A]: { a3: ['x@example.net', 40] }, [B]: { b3: ['x@example.net', 50] } }
    await mount('account=all&folder=INBOX&cat=primary')
    await vi.waitFor(() => expect(order()).toEqual(['a1', 'b1', 'b2', 'a2', 'a3', 'b3']))
    // B's oldest (20 minutes ago) is the newer, so B limits first; once B is exhausted A does.
    expect(pageTokenCalls).toEqual([B, A])
  })

  it('pages an account whose first page is empty but has a token before the rest', async () => {
    inboxes = { [A]: {}, [B]: { b1: ['x@example.net', 10] } }
    later = { [A]: { a1: ['x@example.net', 5] } }
    await mount('account=all&folder=INBOX&cat=primary')
    await vi.waitFor(() => expect(order()).toEqual(['a1', 'b1']))
    expect(pageTokenCalls).toEqual([A])
  })

  it('does not say Nothing here while more pages are coming', async () => {
    inboxes = { [A]: {}, [B]: { b1: ['x@example.net', 10] } }
    later = { [A]: { a1: ['x@example.net', 5] } }
    const { screen } = await mount('account=all&folder=INBOX&cat=primary')
    await vi.waitFor(() => expect(order()).toEqual(['a1', 'b1']))
    expect(screen.getByText('Nothing here').elements()).toHaveLength(0)
  })

  it('still shows the accounts that load when one fails', async () => {
    inboxes = { [A]: { a1: ['x@example.net', 5] } }
    await mount('account=all&folder=INBOX&cat=primary')
    await vi.waitFor(() => expect(order()).toEqual(['a1']))
  })

  it('shows an error when every account fails', async () => {
    inboxes = {}
    const { screen } = await mount('account=all&folder=INBOX&cat=primary')
    await expect.element(screen.getByText("Couldn't load mail")).toBeInTheDocument()
  })

  it("flags a lookalike against the row's own account's contacts", async () => {
    inboxes = {
      [A]: { a1: ['pal@paypa1.com', 5] },
      [B]: { b1: ['pal@paypa1.com', 10] },
    }
    await mount('account=all&folder=INBOX&cat=primary')
    await vi.waitFor(() => expect(order()).toEqual(['a1', 'b1']))
    await vi.waitFor(() => expect(document.querySelector('[data-row="b1"] [data-suspicious]')).not.toBeNull())
    expect(document.querySelector('[data-row="a1"] [data-suspicious]')).toBeNull()
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
