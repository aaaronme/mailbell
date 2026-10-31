import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken } from '../auth/oauth'
import { setTokenSource } from '../api/gmail'
import type { HistoryRecord, ThreadRow } from '../api/mailbox'

vi.mock('@/lib/messager', () => ({ bgMessager: { sendMessage: vi.fn(async () => undefined) } }))

const ME = 'me@gmail.com'
const INBOX_Q = { labelIds: ['INBOX'], includeSpamTrash: false }
const STARRED_Q = { labelIds: ['STARRED'], includeSpamTrash: false }

const row = (threadId: string, labelIds: string[], date: string, account = ME) =>
  ({ account, threadId, url: 'u' + threadId, labelIds, date }) as ThreadRow

// Thread metadata as Gmail returns it, for the row fetch.
const metadata = (id: string, labelIds: string[], date: number) => ({
  id,
  historyId: '1',
  messages: [
    {
      id: 'm' + id,
      threadId: id,
      labelIds,
      snippet: 'snip',
      internalDate: String(date),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'Ann <a@x.com>' },
          { name: 'Subject', value: 'Subject ' + id },
        ],
      },
    },
  ],
})

const msg = (threadId: string, labelIds: string[] = []) => ({ message: { id: 'm' + threadId, threadId, labelIds } })

describe('live updates', () => {
  let live: typeof import('./live')
  let queryClient: typeof import('../queryClient').queryClient
  let mailKeys: typeof import('./queries').mailKeys
  let fetchMock: ReturnType<typeof vi.fn>
  let threads: Record<string, unknown>
  const inboxKey = () => mailKeys.list(ME, 'INBOX', INBOX_Q)
  const starredKey = () => mailKeys.list(ME, 'STARRED', STARRED_Q)
  const seed = (key: readonly unknown[], rows: ThreadRow[]) =>
    queryClient.setQueryData(key, { pages: [{ rows }], pageParams: [undefined] })
  const rowsOf = (key: readonly unknown[]) =>
    (queryClient.getQueryData<{ pages: { rows: ThreadRow[] }[] }>(key)?.pages ?? []).flatMap((p) => p.rows)
  const ids = (key: readonly unknown[]) => rowsOf(key).map((r) => r.threadId)

  beforeEach(async () => {
    live = await import('./live')
    ;({ queryClient } = await import('../queryClient'))
    queryClient.clear()
    ;({ mailKeys } = await import('./queries'))
    setTokenSource(async () => 'T')
    threads = {}
    fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname.split('/users/me')[1]!
      const thread = threads[path.replace('/threads/', '')]
      if (path.startsWith('/threads/')) return thread ? Response.json(thread) : new Response('', { status: 404 })
      return Response.json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    seed(inboxKey(), [row('A', ['INBOX', 'UNREAD', 'STARRED'], '2026-10-30T00:00:00Z'), row('B', ['INBOX'], '2026-10-29T00:00:00Z')])
    seed(starredKey(), [row('A', ['INBOX', 'UNREAD', 'STARRED'], '2026-10-30T00:00:00Z')])
  })
  afterEach(() => {
    setTokenSource(getAccessToken)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('applyHistory', () => {
    it('drops a row that lost INBOX from Inbox lists only', async () => {
      const result = await live.applyHistory(ME, [{ labelsRemoved: [{ ...msg('A'), labelIds: ['INBOX'] }] }])
      expect(result).toBe('patched')
      expect(ids(inboxKey())).toEqual(['B'])
      expect(ids(starredKey())).toEqual(['A'])
      expect(rowsOf(starredKey())[0]!.labelIds).not.toContain('INBOX')
    })

    it('a starred row joins the Starred list', async () => {
      threads.B = metadata('B', ['INBOX', 'STARRED'], Date.parse('2026-10-29T00:00:00Z'))
      await live.applyHistory(ME, [{ labelsAdded: [{ ...msg('B'), labelIds: ['STARRED'] }] }])
      expect(ids(starredKey())).toEqual(['A', 'B'])
      expect(rowsOf(inboxKey()).find((r) => r.threadId === 'B')!.labelIds).toContain('STARRED')
    })

    it('a new thread goes to the top of the lists it belongs in', async () => {
      threads.C = metadata('C', ['INBOX', 'UNREAD'], Date.parse('2026-10-31T00:00:00Z'))
      await live.applyHistory(ME, [{ messagesAdded: [msg('C', ['INBOX', 'UNREAD'])] }])
      expect(ids(inboxKey())).toEqual(['C', 'A', 'B'])
      expect(rowsOf(inboxKey())[0]!.subject).toBe('Subject C')
      expect(ids(starredKey())).toEqual(['A'])
    })

    it('a new message moves its thread to the top, replacing the old row', async () => {
      threads.B = metadata('B', ['INBOX', 'UNREAD'], Date.parse('2026-10-31T00:00:00Z'))
      await live.applyHistory(ME, [{ messagesAdded: [msg('B', ['INBOX', 'UNREAD'])] }])
      expect(ids(inboxKey())).toEqual(['B', 'A'])
      expect(rowsOf(inboxKey())[0]!.labelIds).toContain('UNREAD')
    })

    it('a read row loses UNREAD', async () => {
      await live.applyHistory(ME, [{ labelsRemoved: [{ ...msg('A'), labelIds: ['UNREAD'] }] }])
      expect(rowsOf(inboxKey())[0]!.labelIds).not.toContain('UNREAD')
      expect(rowsOf(starredKey())[0]!.labelIds).not.toContain('UNREAD')
    })

    it('a trashed row leaves every list but Trash', async () => {
      const trashKey = mailKeys.list(ME, 'TRASH', { labelIds: ['TRASH'], includeSpamTrash: true })
      seed(trashKey, [])
      await live.applyHistory(ME, [{ labelsAdded: [{ ...msg('A'), labelIds: ['TRASH'] }] }])
      expect(ids(inboxKey())).toEqual(['B'])
      expect(ids(starredKey())).toEqual([])
      expect(ids(trashKey)).toEqual(['A'])
    })

    it('removes a thread whose last message was deleted', async () => {
      await live.applyHistory(ME, [{ messagesDeleted: [msg('B')] }])
      expect(ids(inboxKey())).toEqual(['A'])
    })

    it('patches All inboxes rows, and a new thread joins its own account', async () => {
      const { allInboxesKey } = await import('./queries')
      const key = allInboxesKey(INBOX_Q, [ME, 'b@x.com'])
      queryClient.setQueryData(key, {
        pages: [
          {
            rows: [row('A', ['INBOX'], '2026-10-30T00:00:00Z'), row('X', ['INBOX'], '2026-10-30T00:00:00Z', 'b@x.com')],
            tokens: { [ME]: null, 'b@x.com': null },
          },
        ],
        pageParams: [{}],
      })
      threads.C = metadata('C', ['INBOX'], Date.parse('2026-10-31T00:00:00Z'))
      await live.applyHistory(ME, [
        { labelsRemoved: [{ ...msg('A'), labelIds: ['INBOX'] }] },
        { messagesAdded: [msg('C', ['INBOX'])] },
      ])
      expect(rowsOf(key).map((r) => `${r.account}/${r.threadId}`)).toEqual([`${ME}/C`, 'b@x.com/X'])
    })

    it('invalidates search lists instead of matching them', async () => {
      const searchKey = mailKeys.list(ME, 'INBOX', { labelIds: [], q: 'hello', includeSpamTrash: false })
      seed(searchKey, [row('A', ['INBOX'], '2026-10-30T00:00:00Z')])
      await live.applyHistory(ME, [{ labelsRemoved: [{ ...msg('A'), labelIds: ['INBOX'] }] }])
      expect(queryClient.getQueryState(searchKey)!.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(inboxKey())!.isInvalidated).toBe(false)
    })

    it('patches the open thread', async () => {
      const key = mailKeys.thread(ME, 'A')
      queryClient.setQueryData(key, { labelIds: ['INBOX', 'UNREAD'] })
      await live.applyHistory(ME, [{ labelsRemoved: [{ ...msg('A'), labelIds: ['UNREAD'] }] }])
      expect(queryClient.getQueryData<{ labelIds: string[] }>(key)!.labelIds).toEqual(['INBOX'])
    })

    it('asks for a reload past 50 records', async () => {
      const records: HistoryRecord[] = Array.from({ length: 51 }, () => ({
        labelsRemoved: [{ ...msg('A'), labelIds: ['UNREAD'] }],
      }))
      expect(await live.applyHistory(ME, records)).toBe('reload')
      expect(rowsOf(inboxKey())[0]!.labelIds).toContain('UNREAD')
    })
  })

  describe('checkNow', () => {
    let profileId: string
    let historyStatus: number
    const historyCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/history'))

    beforeEach(() => {
      profileId = '100'
      historyStatus = 200
      fetchMock.mockImplementation(async (url: string) => {
        const path = new URL(url).pathname.split('/users/me')[1]!
        if (path === '/profile') return Response.json({ historyId: profileId })
        if (path === '/history')
          return historyStatus === 200
            ? Response.json({ history: [], historyId: profileId })
            : new Response('', { status: historyStatus })
        return Response.json({})
      })
    })

    it('makes no history request while the profile historyId is unchanged', async () => {
      const { checkNow } = live.createLiveChecker(() => [ME])
      await checkNow()
      await checkNow()
      expect(historyCalls()).toEqual([])
    })

    it('asks for history since the last id when it changed', async () => {
      const { checkNow } = live.createLiveChecker(() => [ME])
      await checkNow()
      profileId = '105'
      await checkNow()
      expect(historyCalls()).toHaveLength(1)
      expect(new URL(historyCalls()[0]!).searchParams.get('startHistoryId')).toBe('100')
      await checkNow()
      expect(historyCalls()).toHaveLength(1)
    })

    it('reloads the account on an expired history id, and moves on to the new one', async () => {
      const { checkNow } = live.createLiveChecker(() => [ME])
      const other = mailKeys.list('b@x.com', 'INBOX', INBOX_Q)
      seed(other, [])
      await checkNow()
      profileId = '200'
      historyStatus = 404
      await checkNow()
      expect(queryClient.getQueryState(inboxKey())!.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(other)!.isInvalidated).toBe(false)
      await checkNow()
      expect(historyCalls()).toHaveLength(1)
    })

    it('folds a call made while one runs into it', async () => {
      const { checkNow } = live.createLiveChecker(() => [ME])
      await Promise.all([checkNow(), checkNow()])
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/profile'))).toHaveLength(1)
    })
  })
})
