import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)
vi.mock('@/lib/mail/undo', () => ({
  runUndoable: vi.fn(async () => true),
  runSilent: vi.fn(async () => undefined),
  undoLatest: vi.fn(async () => undefined),
}))

const { createAppRouter } = await import('../router')
const { setTokenSource, threadUrl } = await import('@/lib/api/gmail')
const { runUndoable, runSilent } = await import('@/lib/mail/undo')

const A = 'a@example.com'
const B = 'b@example.com'
let threadLabels = ['INBOX', 'UNREAD']
let labels: object[] = []
// Thread id -> how many messages it has; one otherwise.
let sizes: Record<string, number> = {}

const json = (body: object) => new Response(JSON.stringify(body))

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const bearer = (init?.headers as Record<string, string> | undefined)?.Authorization
      const asB = bearer === `Bearer ${B}`
      const path = new URL(input).pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
      if (path === '/threads') return json({ threads: (asB ? ['b0', 'b1'] : ['t0', 't1', 't2', 't3']).map((id) => ({ id })) })
      if (path.startsWith('/threads/')) {
        const id = path.slice('/threads/'.length)
        return json({
          id,
          snippet: 's',
          messages: Array.from({ length: sizes[id] ?? 1 }, (_, n) => ({
            id: `m${id}-${n}`,
            labelIds: threadLabels,
            snippet: 's',
            internalDate: String(Date.now() - (10 - n) * 60_000),
            payload: { headers: [{ name: 'From', value: 'Bob <bob@example.org>' }, { name: 'Subject', value: id }] },
          })),
        })
      }
      if (path === '/labels') return json({ labels: asB ? [{ id: 'Label_B', name: 'Clients', type: 'user' }] : labels })
      if (path.startsWith('/labels/')) {
        const id = path.slice('/labels/'.length)
        return json([...labels, { id: 'Label_B', name: 'Clients', type: 'user' }].find((it) => (it as { id: string }).id === id) ?? {})
      }
      return json({})
    }),
  )
}

async function mount(search: string) {
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

const open = (id: string) => `thread=${encodeURIComponent(threadUrl(A, id))}`
// The runner appends a query to the hash, which must land on `cat`.
const at = (folder: string, id: string) => `account=${A}&folder=${folder}&${open(id)}&cat=primary`
const pane = () => document.querySelector('[data-testid="reading-pane"]') as HTMLElement
const rowCount = () => document.querySelectorAll('[data-testid="thread-list"] [data-row]').length

describe('ReadingPane', () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
    vi.mocked(runUndoable).mockClear()
    vi.mocked(runSilent).mockClear()
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
    await browser.storage.local.set({
      oauthAccounts: [A, B].map((email) => ({ email, refreshToken: 'r', accessToken: 't', expiresAt: 0 })),
    })
    setTokenSource(async (account) => account)
    threadLabels = ['INBOX', 'UNREAD']
    sizes = {}
    labels = [
      { id: 'INBOX', name: 'INBOX', type: 'system' },
      { id: 'Label_1', name: 'Work', type: 'user' },
    ]
    stubFetch()
  })

  it('shows the empty state without a thread', async () => {
    const { screen } = await mount(`account=${A}&folder=INBOX&cat=primary`)
    const empty = screen.getByText('No conversation selected')
    await expect.element(empty).toBeInTheDocument()
    expect(empty.element().className).toContain('text-foreground/40')
  })

  it('shows Restore, not Delete, in Trash', async () => {
    const { screen } = await mount(at('TRASH', 't1'))
    await expect.element(screen.getByTitle('Restore')).toBeInTheDocument()
    expect(pane().querySelector('[title^="Delete"]')).toBeNull()
  })

  it('has no Archive in Trash or Spam', async () => {
    for (const folder of ['TRASH', 'SPAM']) {
      document.body.innerHTML = ''
      await mount(at(folder, 't1'))
      await expect.element(page.getByTitle('Mark unread (Shift+U)')).toBeInTheDocument()
      expect(pane().querySelector('[title^="Archive"]')).toBeNull()
    }
  })

  it('shows Not spam in place of Spam in Spam', async () => {
    const { screen } = await mount(at('SPAM', 't1'))
    await expect.element(screen.getByTitle('Not spam')).toBeInTheDocument()
    expect(pane().querySelector('[title^="Spam"]')).toBeNull()
  })

  it('archives and selects the next row', async () => {
    const { screen, router } = await mount(at('INBOX', 't1'))
    await vi.waitFor(() => expect(rowCount()).toBe(4))
    await screen.getByTitle('Archive (e)').click()
    await vi.waitFor(() =>
      expect(runUndoable).toHaveBeenCalledWith({ kind: 'archive' }, [
        { account: A, threadId: 't1', url: threadUrl(A, 't1') },
      ]),
    )
    await vi.waitFor(() => expect(router.state.location.search.thread).toBe(threadUrl(A, 't2')))
  })

  it('selects the previous row at the end of the list', async () => {
    const { screen, router } = await mount(at('INBOX', 't3'))
    await vi.waitFor(() => expect(rowCount()).toBe(4))
    await screen.getByTitle('Archive (e)').click()
    await vi.waitFor(() => expect(router.state.location.search.thread).toBe(threadUrl(A, 't2')))
  })

  it('acts on the checked threads when there are any', async () => {
    await mount(at('INBOX', 't0'))
    await vi.waitFor(() => expect(rowCount()).toBe(4))
    const boxes = document.querySelectorAll<HTMLElement>('[data-testid="thread-list"] input[type="checkbox"]')
    expect(boxes.length).toBe(4)
    for (const box of [...boxes].slice(1)) box.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('3 selected'))
    pane().querySelector<HTMLElement>('[title="Archive (e)"]')!.click()
    await vi.waitFor(() => expect(runUndoable).toHaveBeenCalled())
    expect(vi.mocked(runUndoable).mock.calls.at(-1)![1]).toHaveLength(3)
  })

  it('reaches Gmail only through the overflow menu', async () => {
    const { screen } = await mount(at('INBOX', 't1'))
    await expect.element(screen.getByTitle('More')).toBeInTheDocument()
    expect(pane().querySelector('a[href^="https://mail.google.com"]')).toBeNull()
    const create = vi.spyOn(fakeBrowser.tabs, 'create')
    await screen.getByTitle('More').click()
    await page.getByRole('menuitem', { name: 'Open in Gmail' }).click()
    expect(create).toHaveBeenCalledWith({ url: threadUrl(A, 't1') })
  })

  it('shows Unstar when starred', async () => {
    threadLabels = ['INBOX', 'STARRED']
    const { screen } = await mount(at('INBOX', 't1'))
    await expect.element(screen.getByTitle('Unstar (s)')).toBeInTheDocument()
  })

  it('marks read when the reader wheels or keys through its scroll container', async () => {
    await browser.storage.local.set({ settings: { markRead: 'delay' } })
    const { router } = await mount(at('INBOX', 't1'))
    await vi.waitFor(() => expect(pane().textContent).toContain('Bob'))
    const scroller = () => pane().querySelector<HTMLElement>('[data-testid="reading-scroll"]')!
    // A scroll the reader didn't make (layout clamping, a remount) is not reading.
    scroller().dispatchEvent(new Event('scroll'))
    await new Promise((r) => setTimeout(r, 50))
    expect(runSilent).not.toHaveBeenCalled()
    scroller().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }))
    await vi.waitFor(() => expect(runSilent).toHaveBeenCalledWith({ kind: 'read' }, expect.any(Array)))
    vi.mocked(runSilent).mockClear()
    const first = scroller()
    await router.navigate({ to: '/mail', search: { account: A, folder: 'INBOX', cat: 'primary', thread: threadUrl(A, 't2') } })
    await vi.waitFor(() => expect(scroller() !== first && scroller().textContent!.includes('Bob')).toBe(true))
    scroller().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'PageDown' }))
    await vi.waitFor(() =>
      expect(runSilent).toHaveBeenCalledWith({ kind: 'read' }, [{ account: A, threadId: 't2', url: threadUrl(A, 't2') }]),
    )
  })

  it('starts every cached thread afresh: newest expanded, at the top, unread', async () => {
    await browser.storage.local.set({ settings: { markRead: 'delay' } })
    sizes = { t1: 6, t2: 3 }
    await page.viewport(1200, 800)
    window.location.hash = `#/mail?${at('INBOX', 't1')}`
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = createAppRouter([`/mail?${at('INBOX', 't1')}`], { popout: true })
    await render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const go = (id: string) =>
      router.navigate({ to: '/mail', search: { account: A, folder: 'INBOX', cat: 'primary', thread: threadUrl(A, id) } })
    const messages = () => [...pane().querySelectorAll('[data-testid="mail-message"]')]
    const scroller = () => pane().querySelector<HTMLElement>('[data-testid="reading-scroll"]')!
    await vi.waitFor(() => expect(client.getQueryData(['mail', 'thread', A, 't2'])).toBeDefined())
    const started = Date.now()
    for (const [id, shown] of [['t1', 3], ['t2', 3], ['t1', 3], ['t2', 3]] as const) {
      await go(id)
      await vi.waitFor(() => expect(messages()).toHaveLength(shown))
      // The newest message is open, not a collapsed row or a group stub.
      expect(messages().at(-1)!.getAttribute('role')).toBeNull()
      expect(!!pane().querySelector('[data-testid="collapsed-indicator"]')).toBe(id === 't1')
      expect(scroller().scrollTop).toBe(0)
      // Scrolled down before leaving, so a kept position would show.
      // Inline, as the tests run without the stylesheet.
      Object.assign(scroller().style, { maxHeight: '100px', overflowY: 'auto' })
      scroller().scrollTop = scroller().scrollHeight
      expect(scroller().scrollTop).toBeGreaterThan(0)
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    expect(Date.now() - started).toBeLessThan(2000)
    expect(runSilent).not.toHaveBeenCalled()
  })

  it('labels checked rows with their own account labels in All inboxes', async () => {
    const { screen } = await mount(
      `account=all&folder=INBOX&thread=${encodeURIComponent(threadUrl(A, 't1'))}&cat=primary`,
    )
    await vi.waitFor(() => expect(document.querySelector('[data-row="b0"]')).not.toBeNull())
    for (const id of ['b0', 'b1']) document.querySelector<HTMLElement>(`[data-row="${id}"] input`)!.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('2 selected'))
    await screen.getByTitle('Label as (l)').click()
    await vi.waitFor(() => expect(document.querySelector('[role="menuitem"]')?.textContent).toBe('Clients'))
    await page.getByRole('menuitem', { name: 'Clients' }).click()
    expect(runUndoable).toHaveBeenCalledWith(
      { kind: 'label', labelId: 'Label_B', name: 'Clients' },
      ['b0', 'b1'].map((id) => ({ account: B, threadId: id, url: threadUrl(B, id) })),
    )
  })

  it('does not move the selection if the user opened another thread meanwhile', async () => {
    const gate = Promise.withResolvers<boolean>()
    vi.mocked(runUndoable).mockImplementationOnce(() => gate.promise)
    const { screen, router } = await mount(at('INBOX', 't1'))
    await vi.waitFor(() => expect(rowCount()).toBe(4))
    await screen.getByTitle('Archive (e)').click()
    await router.navigate({ to: '/mail', search: { account: A, folder: 'INBOX', cat: 'primary', thread: threadUrl(A, 't3') } })
    gate.resolve(true)
    await new Promise((r) => setTimeout(r, 50))
    expect(router.state.location.search.thread).toBe(threadUrl(A, 't3'))
  })
})
