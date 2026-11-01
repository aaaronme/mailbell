import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { answerBatches } from '@/lib/api/batch.testing'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)
vi.mock('@/lib/mail/undo', () => ({
  runUndoable: vi.fn(async () => true),
  runSilent: vi.fn(async () => undefined),
  undoLatest: vi.fn(async () => undefined),
}))

const { createAppRouter } = await import('../router')
const { setTokenSource, threadUrl } = await import('@/lib/api/gmail')
const { runUndoable, undoLatest } = await import('@/lib/mail/undo')

const A = 'a@example.com'
const B = 'b@example.com'
const json = (body: object) => new Response(JSON.stringify(body))
const url = (id: string) => threadUrl(A, id)

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    answerBatches(async (input: string, init?: RequestInit) => {
      const asB = (init?.headers as Record<string, string> | undefined)?.Authorization === `Bearer ${B}`
      const path = new URL(input).pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
      if (path === '/threads') return json({ threads: (asB ? ['X'] : ['A', 'B', 'C']).map((id) => ({ id })) })
      if (path.startsWith('/threads/')) {
        const id = path.slice('/threads/'.length)
        return json({
          id,
          snippet: 's',
          messages: [
            {
              id: `m${id}`,
              labelIds: ['INBOX'],
              snippet: 's',
              internalDate: String(Date.now()),
              payload: { headers: [{ name: 'From', value: 'Bob <bob@example.org>' }, { name: 'Subject', value: id }] },
            },
          ],
        })
      }
      if (path === '/labels') return json({ labels: [] })
      return json({})
    }),
  )
}

async function mount(search: string, rowCount = 3) {
  await page.viewport(1200, 800)
  window.location.hash = `#/mail?${search}`
  const router = createAppRouter([`/mail?${search}`], { popout: true })
  const screen = await render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  await vi.waitFor(() => expect(document.querySelectorAll('[data-testid="thread-list"] [data-row]').length).toBe(rowCount))
  return { router, screen }
}

const base = `account=${A}&folder=INBOX&cat=primary`
// The runner appends a query to the hash, which must land on `cat`.
const open = (id: string) => `account=${A}&folder=INBOX&thread=${encodeURIComponent(url(id))}&cat=primary`
const selected = (router: { state: { location: { search: { thread?: string } } } }) => router.state.location.search.thread

describe('popout shortcuts', () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
    vi.mocked(runUndoable).mockClear()
    vi.mocked(undoLatest).mockClear()
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
    await browser.storage.local.set({
      oauthAccounts: [{ email: A, refreshToken: 'r', accessToken: 't', expiresAt: 0 }],
    })
    setTokenSource(async (account) => account)
    stubFetch()
  })

  it('j selects the next row, from none the first, and stays put at the ends', async () => {
    const { router } = await mount(base)
    await userEvent.keyboard('j')
    await vi.waitFor(() => expect(selected(router)).toBe(url('A')))
    await userEvent.keyboard('jjj')
    await vi.waitFor(() => expect(selected(router)).toBe(url('C')))
    await userEvent.keyboard('kk')
    await vi.waitFor(() => expect(selected(router)).toBe(url('A')))
    await userEvent.keyboard('k')
    expect(selected(router)).toBe(url('A'))
  })

  it('e archives the selected row and selects the next', async () => {
    const { router } = await mount(base)
    await userEvent.keyboard('jj')
    await vi.waitFor(() => expect(selected(router)).toBe(url('B')))
    await userEvent.keyboard('e')
    await vi.waitFor(() =>
      expect(runUndoable).toHaveBeenCalledWith({ kind: 'archive' }, [{ account: A, threadId: 'B', url: url('B') }]),
    )
    await vi.waitFor(() => expect(selected(router)).toBe(url('C')))
  })

  it('does nothing without a selection or checks', async () => {
    await mount(base)
    await userEvent.keyboard('ex')
    expect(runUndoable).not.toHaveBeenCalled()
  })

  it('z undoes', async () => {
    await mount(base)
    await userEvent.keyboard('z')
    await vi.waitFor(() => expect(undoLatest).toHaveBeenCalled())
  })

  it('# trashes the checked threads', async () => {
    await mount(open('B'))
    const boxes = document.querySelectorAll<HTMLElement>('[data-testid="thread-list"] input[type="checkbox"]')
    boxes[0]!.click()
    boxes[2]!.click()
    await userEvent.keyboard('#')
    await vi.waitFor(() =>
      expect(runUndoable).toHaveBeenCalledWith({ kind: 'trash' }, [
        { account: A, threadId: 'A', url: url('A') },
        { account: A, threadId: 'C', url: url('C') },
      ]),
    )
  })

  it('e does nothing in Trash or Spam', async () => {
    for (const folder of ['TRASH', 'SPAM']) {
      document.body.innerHTML = ''
      await mount(`account=${A}&folder=${folder}&thread=${encodeURIComponent(url('B'))}&cat=primary`)
      await userEvent.keyboard('e')
      await new Promise((r) => setTimeout(r, 50))
      expect(runUndoable).not.toHaveBeenCalled()
    }
  })

  it('# restores in Trash', async () => {
    await mount(`account=${A}&folder=TRASH&thread=${encodeURIComponent(url('B'))}&cat=primary`)
    await userEvent.keyboard('#')
    await vi.waitFor(() => expect(runUndoable).toHaveBeenCalledWith({ kind: 'restore' }, expect.anything()))
  })

  it('x toggles the selected row', async () => {
    await mount(open('B'))
    await userEvent.keyboard('x')
    await vi.waitFor(() => {
      const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-testid="thread-list"] input[type="checkbox"]')]
      expect(boxes.map((it) => it.checked)).toEqual([false, true, false])
    })
  })

  it('g then s goes to Starred', async () => {
    const { router } = await mount(base)
    await userEvent.keyboard('gs')
    await vi.waitFor(() => expect(router.state.location.search.folder).toBe('STARRED'))
  })

  it('g goes to the inbox of all accounts in All inboxes', async () => {
    const { router } = await mount('account=all&folder=STARRED')
    await userEvent.keyboard('gt')
    await vi.waitFor(() => expect(router.state.location.search).toMatchObject({ account: 'all', folder: 'INBOX' }))
  })

  it('/ focuses search, and typing there triggers nothing', async () => {
    await mount(open('B'))
    await userEvent.keyboard('/')
    const input = document.querySelector('input[aria-label="Search mail"]')
    await vi.waitFor(() => expect(document.activeElement).toBe(input))
    await userEvent.keyboard('e')
    expect(runUndoable).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('e')
  })

  it('Enter focuses the reading pane', async () => {
    await mount(open('B'))
    await vi.waitFor(() => expect(document.querySelector('[data-testid="reading-scroll"]')).not.toBeNull())
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-testid="reading-scroll"]')))
  })

  it('r opens the reply box', async () => {
    const { screen } = await mount(open('B'))
    await expect.element(screen.getByTitle('Reply (r)')).toBeInTheDocument()
    await userEvent.keyboard('r')
    await expect.element(screen.getByLabelText('Reply')).toBeInTheDocument()
  })

  it('l opens the label menu', async () => {
    const { screen } = await mount(open('B'))
    await expect.element(screen.getByTitle('Label as (l)')).toBeInTheDocument()
    await userEvent.keyboard('l')
    await expect.element(screen.getByText('No labels')).toBeInTheDocument()
  })

  it('? opens the shortcut sheet, which suspends the keys and Escape closes', async () => {
    const { screen } = await mount(open('B'))
    await userEvent.keyboard('?')
    await expect.element(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    await userEvent.keyboard('e')
    expect(runUndoable).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })

  it('Enter on a focused control activates it instead of opening the thread', async () => {
    const { screen } = await mount(open('B'))
    const star = screen.getByTitle('Star (s)').element() as HTMLElement
    star.focus()
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(runUndoable).toHaveBeenCalledWith({ kind: 'star' }, expect.anything()))
    expect(document.activeElement).toBe(star)
  })

  it('l does not open the label menu for threads of two accounts', async () => {
    await browser.storage.local.set({
      oauthAccounts: [A, B].map((email) => ({ email, refreshToken: 'r', accessToken: 't', expiresAt: 0 })),
    })
    await mount(`account=all&folder=INBOX&thread=${encodeURIComponent(url('A'))}&cat=primary`, 4)
    for (const subject of ['A', 'X']) document.querySelector<HTMLElement>(`input[aria-label="Select ${subject}"]`)!.click()
    await userEvent.keyboard('l')
    expect(document.querySelector('[role=menu]')).toBeNull()
  })

  it('v does not open the move menu outside the inbox and labels', async () => {
    await mount(`account=${A}&folder=SENT&thread=${encodeURIComponent(url('B'))}&cat=primary`)
    await userEvent.keyboard('v')
    expect(document.querySelector('[role=menu]')).toBeNull()
  })

  it('g followed by an unmapped key does not run that key alone', async () => {
    await mount(open('B'))
    await userEvent.keyboard('gx')
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-testid="thread-list"] input[type="checkbox"]')]
    expect(boxes.some((it) => it.checked)).toBe(false)
  })

  it('U marks unread and ignores a capital without Shift', async () => {
    await mount(open('B'))
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'U', bubbles: true, cancelable: true }))
    expect(runUndoable).not.toHaveBeenCalled()
    await userEvent.keyboard('{Shift>}U{/Shift}')
    await vi.waitFor(() => expect(runUndoable).toHaveBeenCalledWith({ kind: 'unread' }, expect.anything()))
  })

  it('! reports spam, and not spam in Spam', async () => {
    await mount(open('B'))
    await userEvent.keyboard('!')
    await vi.waitFor(() => expect(runUndoable).toHaveBeenCalledWith({ kind: 'spam' }, expect.anything()))
  })

  it('! says not spam in Spam', async () => {
    await mount(`account=${A}&folder=SPAM&thread=${encodeURIComponent(url('B'))}&cat=primary`)
    await userEvent.keyboard('!')
    await vi.waitFor(() => expect(runUndoable).toHaveBeenCalledWith({ kind: 'notSpam' }, expect.anything()))
  })

  it('Backspace trashes and s stars', async () => {
    await mount(open('B'))
    await userEvent.keyboard('{Backspace}')
    await vi.waitFor(() => expect(runUndoable).toHaveBeenCalledWith({ kind: 'trash' }, expect.anything()))
    await userEvent.keyboard('s')
    await vi.waitFor(() => expect(runUndoable).toHaveBeenCalledWith({ kind: 'star' }, expect.anything()))
  })

  it('typing e in the reply box does not archive', async () => {
    const { screen } = await mount(open('B'))
    await expect.element(screen.getByTitle('Reply (r)')).toBeInTheDocument()
    await userEvent.keyboard('r')
    await expect.element(screen.getByLabelText('Reply')).toBeInTheDocument()
    await userEvent.keyboard('e')
    expect(runUndoable).not.toHaveBeenCalled()
  })
})
