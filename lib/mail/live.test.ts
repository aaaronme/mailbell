import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { getAccessToken, OAuthError } from '../auth/oauth'
import { setTokenSource } from '../api/gmail'
import { debugLog } from '../debugLog'
import { FAST_POLL_MS } from '../fastPoll'
import type { HistoryRecord, ThreadRow } from '../api/mailbox'

vi.mock('../debugLog', () => ({ debugLog: vi.fn(async () => undefined) }))
vi.mock('@/lib/messager', () => ({ bgMessager: { sendMessage: vi.fn(async () => undefined) } }))

const ME = 'me@gmail.com'
const INBOX_Q = { labelIds: ['INBOX'], includeSpamTrash: false }
const STARRED_Q = { labelIds: ['STARRED'], includeSpamTrash: false }
const TRASH_Q = { labelIds: ['TRASH'], includeSpamTrash: true }

const row = (threadId: string, labelIds: string[], date: string, account = ME) =>
  ({ account, threadId, url: 'u' + threadId, labelIds, date }) as ThreadRow

// Thread metadata as Gmail returns it, one [labels, date] per message.
const metadata = (id: string, messages: [string[], string][]) => ({
  id,
  historyId: '1',
  messages: messages.map(([labelIds, date], i) => ({
    id: `m${id}${i}`,
    threadId: id,
    labelIds,
    snippet: 'snip',
    internalDate: String(Date.parse(date)),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Ann <a@x.com>' },
        { name: 'Subject', value: 'Subject ' + id },
      ],
    },
  })),
})

const msg = (threadId: string, labelIds: string[] = []) => ({ message: { id: 'm' + threadId, threadId, labelIds } })

const D30 = '2026-10-30T00:00:00Z'
const D29 = '2026-10-29T00:00:00Z'
const D31 = '2026-10-31T00:00:00Z'

describe('live updates', () => {
  let live: typeof import('./live')
  let queryClient: typeof import('../queryClient').queryClient
  let mailKeys: typeof import('./queries').mailKeys
  let fetchMock: ReturnType<typeof vi.fn>
  let threads: Record<string, unknown>
  const inboxKey = () => mailKeys.list(ME, 'INBOX', INBOX_Q)
  const starredKey = () => mailKeys.list(ME, 'STARRED', STARRED_Q)
  const trashKey = () => mailKeys.list(ME, 'TRASH', TRASH_Q)
  const seed = (key: readonly unknown[], rows: ThreadRow[]) =>
    queryClient.setQueryData(key, { pages: [{ rows }], pageParams: [undefined] })
  const rowsOf = (key: readonly unknown[]) =>
    (queryClient.getQueryData<{ pages: { rows: ThreadRow[] }[] }>(key)?.pages ?? []).flatMap((p) => p.rows)
  const ids = (key: readonly unknown[]) => rowsOf(key).map((r) => r.threadId)
  const threadFetches = (id?: string) =>
    fetchMock.mock.calls
      .map((c) => new URL(String(c[0])).pathname)
      .filter((p) => (id ? p.endsWith(`/threads/${id}`) : p.includes('/threads/')))

  beforeEach(async () => {
    live = await import('./live')
    ;({ queryClient } = await import('../queryClient'))
    queryClient.clear()
    ;({ mailKeys } = await import('./queries'))
    setTokenSource(async () => 'T')
    threads = {
      A: metadata('A', [[['INBOX', 'UNREAD', 'STARRED'], D30]]),
      B: metadata('B', [[['INBOX'], D29]]),
    }
    fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname.split('/users/me')[1]!
      const thread = threads[path.replace('/threads/', '')]
      if (path.startsWith('/threads/')) return thread ? Response.json(thread) : new Response('', { status: 404 })
      return Response.json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    seed(inboxKey(), [row('A', ['INBOX', 'UNREAD', 'STARRED'], D30), row('B', ['INBOX'], D29)])
    seed(starredKey(), [row('A', ['INBOX', 'UNREAD', 'STARRED'], D30)])
  })
  afterEach(() => {
    setTokenSource(getAccessToken)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('applyHistory', () => {
    it('drops a row that lost INBOX from Inbox lists only', async () => {
      threads.A = metadata('A', [[['UNREAD', 'STARRED'], D30]])
      const result = await live.applyHistory(ME, [{ labelsRemoved: [{ ...msg('A'), labelIds: ['INBOX'] }] }])
      expect(result).toBe('patched')
      expect(ids(inboxKey())).toEqual(['B'])
      expect(ids(starredKey())).toEqual(['A'])
      expect(rowsOf(starredKey())[0]!.labelIds).not.toContain('INBOX')
    })

    it('a starred row is fetched and joins the Starred list', async () => {
      threads.B = metadata('B', [[['INBOX', 'STARRED'], D29]])
      await live.applyHistory(ME, [{ labelsAdded: [{ ...msg('B'), labelIds: ['STARRED'] }] }])
      expect(threadFetches('B')).toHaveLength(1)
      expect(ids(starredKey())).toEqual(['A', 'B'])
      expect(rowsOf(inboxKey()).find((r) => r.threadId === 'B')!.labelIds).toContain('STARRED')
    })

    it('a new thread goes to the top of the lists it belongs in', async () => {
      threads.C = metadata('C', [[['INBOX', 'UNREAD'], D31]])
      await live.applyHistory(ME, [{ messagesAdded: [msg('C', ['INBOX', 'UNREAD'])] }])
      expect(ids(inboxKey())).toEqual(['C', 'A', 'B'])
      expect(rowsOf(inboxKey())[0]!.subject).toBe('Subject C')
      expect(ids(starredKey())).toEqual(['A'])
    })

    it('a new message moves its thread to the top, replacing the old row', async () => {
      threads.B = metadata('B', [
        [['INBOX'], D29],
        [['INBOX', 'UNREAD'], D31],
      ])
      await live.applyHistory(ME, [{ messagesAdded: [msg('B', ['INBOX', 'UNREAD'])] }])
      expect(ids(inboxKey())).toEqual(['B', 'A'])
      expect(rowsOf(inboxKey())[0]!.labelIds).toContain('UNREAD')
    })

    it('a read row loses UNREAD', async () => {
      threads.A = metadata('A', [[['INBOX', 'STARRED'], D30]])
      await live.applyHistory(ME, [{ labelsRemoved: [{ ...msg('A'), labelIds: ['UNREAD'] }] }])
      expect(rowsOf(inboxKey())[0]!.labelIds).not.toContain('UNREAD')
      expect(rowsOf(starredKey())[0]!.labelIds).not.toContain('UNREAD')
    })

    it('a trashed thread leaves every list but Trash', async () => {
      seed(trashKey(), [])
      threads.A = metadata('A', [[['TRASH', 'UNREAD', 'STARRED'], D30]])
      await live.applyHistory(ME, [{ labelsAdded: [{ ...msg('A'), labelIds: ['TRASH'] }] }])
      expect(ids(inboxKey())).toEqual(['B'])
      expect(ids(starredKey())).toEqual([])
      expect(ids(trashKey())).toEqual(['A'])
    })

    it('a thread that still has INBOX on another message stays in Inbox', async () => {
      threads.B = metadata('B', [
        [[], D29],
        [['INBOX'], D30],
      ])
      await live.applyHistory(ME, [{ labelsRemoved: [{ ...msg('B'), labelIds: ['INBOX'] }] }])
      expect(ids(inboxKey())).toEqual(['A', 'B'])
    })

    it('one trashed message keeps the thread in Inbox and adds it to Trash', async () => {
      seed(trashKey(), [])
      threads.B = metadata('B', [
        [['TRASH'], D29],
        [['INBOX'], D29],
      ])
      await live.applyHistory(ME, [{ labelsAdded: [{ ...msg('B'), labelIds: ['TRASH'] }] }])
      expect(ids(inboxKey())).toEqual(['A', 'B'])
      expect(ids(trashKey())).toEqual(['B'])
    })

    it('a reply on a thread with a trashed message keeps it in Inbox', async () => {
      threads.B = metadata('B', [
        [['TRASH'], D29],
        [['INBOX', 'UNREAD'], D31],
      ])
      await live.applyHistory(ME, [{ messagesAdded: [msg('B', ['INBOX', 'UNREAD'])] }])
      expect(ids(inboxKey())).toEqual(['B', 'A'])
    })

    it('an untrash puts the thread back in Inbox and takes it out of Trash', async () => {
      queryClient.removeQueries({ queryKey: inboxKey() })
      seed(inboxKey(), [row('A', ['INBOX'], D30)])
      seed(trashKey(), [row('B', ['INBOX', 'TRASH'], D29)])
      await live.applyHistory(ME, [{ labelsRemoved: [{ ...msg('B'), labelIds: ['TRASH'] }] }])
      expect(ids(inboxKey())).toEqual(['A', 'B'])
      expect(ids(trashKey())).toEqual([])
    })

    it('removes a thread whose last message was deleted', async () => {
      delete threads.B
      await live.applyHistory(ME, [{ messagesDeleted: [msg('B')] }])
      expect(ids(inboxKey())).toEqual(['A'])
    })

    it('a deleted message with others left replaces the row in place', async () => {
      threads.A = metadata('A', [[['INBOX', 'UNREAD', 'STARRED'], D29]])
      await live.applyHistory(ME, [{ messagesDeleted: [msg('A')] }])
      expect(ids(inboxKey())).toEqual(['A', 'B'])
      expect(rowsOf(inboxKey())[0]!.date).toBe(new Date(D29).toISOString())
    })

    it('fetches a thread once however many records name it', async () => {
      await live.applyHistory(ME, [
        { messagesAdded: [msg('A', ['INBOX'])] },
        { labelsRemoved: [{ ...msg('A'), labelIds: ['UNREAD'] }] },
        { labelsAdded: [{ ...msg('A'), labelIds: ['STARRED'] }] },
        { messagesDeleted: [msg('A')] },
      ])
      expect(threadFetches()).toEqual([expect.stringMatching(/\/threads\/A$/)])
    })

    it('a draft only refreshes Drafts lists', async () => {
      const draftsKey = mailKeys.list(ME, 'DRAFT', { labelIds: ['DRAFT'], includeSpamTrash: false })
      seed(draftsKey, [])
      const open = mailKeys.thread(ME, 'B')
      queryClient.setQueryData(open, { labelIds: ['INBOX'] })
      await live.applyHistory(ME, [{ messagesAdded: [msg('B', ['DRAFT'])] }, { messagesDeleted: [msg('B', ['DRAFT'])] }])
      expect(threadFetches()).toEqual([])
      expect(ids(inboxKey())).toEqual(['A', 'B'])
      expect(queryClient.getQueryState(open)!.isInvalidated).toBe(false)
      expect(queryClient.getQueryState(draftsKey)!.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(inboxKey())!.isInvalidated).toBe(false)
    })

    it('patches All inboxes rows, and a new thread joins its own account by date', async () => {
      const { allInboxesKey } = await import('./queries')
      const key = allInboxesKey(INBOX_Q, [ME, 'b@x.com'])
      queryClient.setQueryData(key, {
        pages: [
          {
            rows: [row('A', ['INBOX'], D30), row('X', ['INBOX'], D30, 'b@x.com')],
            tokens: { [ME]: null, 'b@x.com': null },
          },
        ],
        pageParams: [{}],
      })
      threads.A = metadata('A', [[[], D30]])
      threads.C = metadata('C', [[['INBOX'], D31]])
      await live.applyHistory(ME, [
        { labelsRemoved: [{ ...msg('A'), labelIds: ['INBOX'] }] },
        { messagesAdded: [msg('C', ['INBOX'])] },
      ])
      // All inboxes sorts its rows on read; only which rows are cached counts.
      expect(rowsOf(key).map((r) => `${r.account}/${r.threadId}`).sort()).toEqual(['b@x.com/X', `${ME}/C`])
    })

    it('in All inboxes, an old thread waits for its page while the account has more', async () => {
      const { allInboxesKey } = await import('./queries')
      const key = allInboxesKey(INBOX_Q, [ME, 'b@x.com'])
      queryClient.setQueryData(key, {
        pages: [{ rows: [row('A', ['INBOX'], D30)], tokens: { [ME]: 'more', 'b@x.com': null } }],
        pageParams: [{}],
      })
      threads.C = metadata('C', [[['INBOX'], '2026-01-01T00:00:00Z']])
      await live.applyHistory(ME, [{ labelsAdded: [{ ...msg('C'), labelIds: ['INBOX'] }] }])
      expect(ids(key)).toEqual(['A'])
    })

    it('invalidates search lists instead of matching them', async () => {
      threads.A = metadata('A', [[[], D30]])
      const searchKey = mailKeys.list(ME, 'INBOX', { labelIds: [], q: 'hello', includeSpamTrash: false })
      seed(searchKey, [row('A', ['INBOX'], D30)])
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
    const calls = (part: string) => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes(part))

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
      expect(calls('/history')).toEqual([])
    })

    it('asks for history since the last id when it changed, and refreshes the counts', async () => {
      const { checkNow } = live.createLiveChecker(() => [ME])
      queryClient.setQueryData(mailKeys.labels(ME), [])
      await checkNow()
      expect(queryClient.getQueryState(mailKeys.labels(ME))!.isInvalidated).toBe(false)
      profileId = '105'
      await checkNow()
      expect(calls('/history')).toHaveLength(1)
      expect(new URL(calls('/history')[0]!).searchParams.get('startHistoryId')).toBe('100')
      expect(queryClient.getQueryState(mailKeys.labels(ME))!.isInvalidated).toBe(true)
      await checkNow()
      expect(calls('/history')).toHaveLength(1)
    })

    it('reloads the account on an expired history id, and moves on to the new one', async () => {
      const { checkNow } = live.createLiveChecker(() => [ME])
      const { allInboxesKey } = await import('./queries')
      const other = mailKeys.list('b@x.com', 'INBOX', INBOX_Q)
      const otherAll = allInboxesKey(INBOX_Q, ['b@x.com'])
      const mineAll = allInboxesKey(INBOX_Q, [ME, 'b@x.com'])
      seed(other, [])
      seed(otherAll, [])
      seed(mineAll, [])
      await checkNow()
      profileId = '200'
      historyStatus = 404
      await checkNow()
      expect(queryClient.getQueryState(inboxKey())!.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(mineAll)!.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(other)!.isInvalidated).toBe(false)
      expect(queryClient.getQueryState(otherAll)!.isInvalidated).toBe(false)
      await checkNow()
      expect(calls('/history')).toHaveLength(1)
    })

    it('refreshes an account\'s counts at most every 30 s, catching up after', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const { checkNow } = live.createLiveChecker(() => [ME])
        const counts = () => queryClient.getQueryState(mailKeys.labels(ME))!.isInvalidated
        queryClient.setQueryData(mailKeys.labels(ME), [])
        await checkNow()
        profileId = '105'
        await checkNow()
        expect(counts()).toBe(true)
        queryClient.setQueryData(mailKeys.labels(ME), [])
        vi.advanceTimersByTime(5_000)
        profileId = '110'
        await checkNow()
        profileId = '115'
        await checkNow()
        expect(counts()).toBe(false)
        vi.advanceTimersByTime(24_000)
        expect(counts()).toBe(false)
        vi.advanceTimersByTime(1_000)
        expect(counts()).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('logs a repeated failure once until the account succeeds again', async () => {
      vi.mocked(debugLog).mockClear()
      const { checkNow } = live.createLiveChecker(() => [ME])
      const ok = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async () => {
        throw new TypeError('Failed to fetch')
      })
      await checkNow()
      await checkNow()
      await checkNow()
      expect(debugLog).toHaveBeenCalledTimes(1)
      fetchMock.mockImplementation(ok)
      await checkNow()
      fetchMock.mockImplementation(async () => {
        throw new TypeError('Failed to fetch')
      })
      await checkNow()
      expect(debugLog).toHaveBeenCalledTimes(2)
    })

    it('runs once more after a run that calls arrived during, not once per call', async () => {
      const { checkNow } = live.createLiveChecker(() => [ME])
      await Promise.all([checkNow(), checkNow(), checkNow()])
      expect(calls('/profile')).toHaveLength(2)
    })
  })
  describe('useLiveUpdates', () => {
    const profileCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/profile')).length
    const visibility = (state: DocumentVisibilityState) =>
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
    const settled = () => vi.waitFor(() => expect(profileCalls()).toBeGreaterThan(0))

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      vi.mocked(debugLog).mockClear()
      fetchMock.mockImplementation(async () => Response.json({ historyId: '100' }))
    })
    afterEach(() => vi.useRealTimers())

    it('checks on the interval only while the document is visible', async () => {
      visibility('visible')
      await renderHook(() => live.useLiveUpdates([ME]))
      await settled()
      const seeded = profileCalls()
      vi.advanceTimersByTime(FAST_POLL_MS)
      await vi.waitFor(() => expect(profileCalls()).toBe(seeded + 1))
      visibility('hidden')
      vi.advanceTimersByTime(FAST_POLL_MS * 3)
      await new Promise((r) => setTimeout(r, 50))
      expect(profileCalls()).toBe(seeded + 1)
    })

    it('checks when the window gains focus', async () => {
      visibility('visible')
      await renderHook(() => live.useLiveUpdates([ME]))
      await settled()
      const seeded = profileCalls()
      window.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(profileCalls()).toBe(seeded + 1))
    })

    it('stops the interval and the focus listener on unmount', async () => {
      visibility('visible')
      const view = await renderHook(() => live.useLiveUpdates([ME]))
      await settled()
      view.unmount()
      const before = profileCalls()
      vi.advanceTimersByTime(FAST_POLL_MS * 3)
      window.dispatchEvent(new Event('focus'))
      await new Promise((r) => setTimeout(r, 50))
      expect(profileCalls()).toBe(before)
    })

    it('stays silent for a signed-out account', async () => {
      const { toast } = await import('sonner')
      const error = vi.spyOn(toast, 'error')
      setTokenSource(async () => {
        throw new OAuthError('invalid_grant')
      })
      visibility('visible')
      await renderHook(() => live.useLiveUpdates([ME]))
      await new Promise((r) => setTimeout(r, 50))
      expect(error).not.toHaveBeenCalled()
      expect(debugLog).not.toHaveBeenCalled()
      expect(profileCalls()).toBe(0)
    })
  })
})
