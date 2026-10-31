import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken } from '../auth/oauth'
import { setTokenSource } from '../api/gmail'
import type { ThreadRow } from '../api/mailbox'

vi.mock('@/lib/messager', () => ({ bgMessager: { sendMessage: vi.fn(async () => undefined) } }))

const row = (threadId: string, account = 'me@gmail.com', labelIds = ['INBOX', 'UNREAD']) =>
  ({ account, threadId, url: 'u' + threadId, labelIds }) as ThreadRow

const target = (threadId: string, account = 'me@gmail.com') => ({ account, threadId, url: 'u' + threadId })

describe('actions', () => {
  let mod: typeof import('./actions')
  let queryClient: typeof import('../queryClient').queryClient
  let mailKeys: typeof import('./queries').mailKeys
  let fetchMock: ReturnType<typeof vi.fn>
  const listKey = () => mailKeys.list('me@gmail.com', 'INBOX', { labelIds: ['INBOX'], includeSpamTrash: false })
  const seed = (rows: ThreadRow[], key: readonly unknown[] = listKey()) =>
    queryClient.setQueryData(key, { pages: [{ rows }], pageParams: [undefined] })
  const cachedIds = (key: readonly unknown[] = listKey()) =>
    (queryClient.getQueryData<{ pages: { rows: ThreadRow[] }[] }>(key)?.pages ?? []).flatMap((p) =>
      p.rows.map((r) => r.threadId),
    )

  beforeEach(async () => {
    mod = await import('./actions')
    ;({ queryClient } = await import('../queryClient'))
    queryClient.clear()
    ;({ mailKeys } = await import('./queries'))
    setTokenSource(async () => 'T')
    fetchMock = vi.fn(async () => Response.json({}))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    setTokenSource(getAccessToken)
    vi.unstubAllGlobals()
  })

  it('maps actions to label operations', () => {
    expect(mod.labelOps({ kind: 'spam' })).toEqual({ add: ['SPAM'], remove: ['INBOX'] })
    expect(mod.labelOps({ kind: 'notSpam' })).toEqual({ add: ['INBOX'], remove: ['SPAM'] })
    expect(mod.labelOps({ kind: 'trash' })).toBe('trash')
    expect(mod.labelOps({ kind: 'restore' })).toBe('untrash')
    expect(mod.labelOps({ kind: 'move', labelId: 'L', name: 'L', from: 'INBOX' })).toEqual({
      add: ['L'],
      remove: ['INBOX'],
    })
  })

  it('inverts each action', () => {
    expect(mod.labelOps(mod.inverse({ kind: 'archive' }))).toEqual({ add: ['INBOX'], remove: [] })
    expect(mod.inverse({ kind: 'trash' })).toEqual({ kind: 'restore' })
    expect(mod.inverse({ kind: 'restore' })).toEqual({ kind: 'trash' })
    expect(mod.inverse({ kind: 'spam' })).toEqual({ kind: 'notSpam' })
    expect(mod.inverse({ kind: 'notSpam' })).toEqual({ kind: 'spam' })
    expect(mod.inverse({ kind: 'read' })).toEqual({ kind: 'unread' })
    expect(mod.inverse({ kind: 'unread' })).toEqual({ kind: 'read' })
    expect(mod.inverse({ kind: 'star' })).toEqual({ kind: 'unstar' })
    expect(mod.inverse({ kind: 'unstar' })).toEqual({ kind: 'star' })
    expect(mod.inverse({ kind: 'label', labelId: 'L', name: 'X' })).toEqual({ kind: 'unlabel', labelId: 'L', name: 'X' })
    expect(mod.inverse({ kind: 'unlabel', labelId: 'L', name: 'X' })).toEqual({ kind: 'label', labelId: 'L', name: 'X' })
    expect(mod.inverse({ kind: 'move', labelId: 'L', name: 'X', from: 'INBOX' })).toEqual({
      kind: 'move',
      labelId: 'INBOX',
      name: 'INBOX',
      from: 'L',
    })
  })

  it('words the toast', () => {
    expect(mod.ACTION_TEXT({ kind: 'archive' }, 1)).toBe('Archived')
    expect(mod.ACTION_TEXT({ kind: 'trash' }, 3)).toBe('Moved to Trash · 3 conversations')
    expect(mod.ACTION_TEXT({ kind: 'label', labelId: 'L', name: 'X' }, 1)).toBe('Labeled "X"')
    expect(mod.ACTION_TEXT({ kind: 'move', labelId: 'L', name: 'X', from: 'INBOX' }, 1)).toBe('Moved to "X"')
  })

  it('knows which actions remove a row from a folder', () => {
    expect(mod.removesFromFolder({ kind: 'archive' }, 'INBOX')).toBe(true)
    expect(mod.removesFromFolder({ kind: 'archive' }, 'ALL')).toBe(false)
    expect(mod.removesFromFolder({ kind: 'trash' }, 'TRASH')).toBe(false)
    expect(mod.removesFromFolder({ kind: 'spam' }, 'SPAM')).toBe(false)
    expect(mod.removesFromFolder({ kind: 'restore' }, 'TRASH')).toBe(true)
    expect(mod.removesFromFolder({ kind: 'read' }, 'INBOX')).toBe(false)
    expect(mod.removesFromFolder({ kind: 'star' }, 'INBOX')).toBe(false)
  })

  it('removes the row optimistically before the API answers', async () => {
    seed([row('A'), row('B')])
    let release!: (r: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>((res) => (release = res)))
    const done = mod.applyAction({ kind: 'archive' }, [target('A')])
    await vi.waitFor(() => expect(cachedIds()).toEqual(['B']))
    release(Response.json({}))
    await done
    expect(cachedIds()).toEqual(['B'])
  })

  it('edits labelIds in place when the row stays', async () => {
    seed([row('A')])
    await mod.applyAction({ kind: 'read' }, [target('A')])
    const data = queryClient.getQueryData<{ pages: { rows: ThreadRow[] }[] }>(listKey())!
    expect(data.pages[0]!.rows[0]!.labelIds).toEqual(['INBOX'])
  })

  it('patches the open thread too', async () => {
    const key = mailKeys.thread('me@gmail.com', 'A')
    queryClient.setQueryData(key, { labelIds: ['INBOX'] })
    await mod.applyAction({ kind: 'star' }, [target('A')])
    expect(queryClient.getQueryData<{ labelIds: string[] }>(key)!.labelIds).toEqual(['INBOX', 'STARRED'])
  })

  it('rolls back and rejects on failure', async () => {
    seed([row('A'), row('B')])
    fetchMock.mockResolvedValue(new Response('no', { status: 500 }))
    await expect(mod.applyAction({ kind: 'archive' }, [target('A')])).rejects.toThrow()
    expect(cachedIds()).toEqual(['A', 'B'])
  })

  it('refetches true state after a partial failure', async () => {
    seed([row('A'), row('B')])
    let n = 0
    fetchMock.mockImplementation(async () => (n++ === 0 ? Response.json({}) : new Response('no', { status: 500 })))
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await expect(mod.applyAction({ kind: 'archive' }, [target('A'), target('B')])).rejects.toThrow()
    expect(cachedIds()).toEqual(['A', 'B'])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mail', 'list'] })
  })

  it('makes one call per account', async () => {
    await mod.applyAction({ kind: 'trash' }, [target('A'), target('B', 'other@gmail.com')])
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.filter((u) => u.includes('/trash'))).toHaveLength(2)
  })
})
