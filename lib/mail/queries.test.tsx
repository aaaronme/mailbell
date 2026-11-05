import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { createElement, type ReactNode } from 'react'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ThreadRow } from '../api/mailbox'
import { setTokenSource } from '../api/gmail'
import { listQuery } from './folders'
import { allInboxesKey, mailKeys, useThreadList } from './queries'

vi.stubGlobal('browser', fakeBrowser)

const A = 'a@example.com'
const B = 'b@example.com'
const QUERY = listQuery('INBOX', {})
const row = (account: string, threadId: string, minutes: number) =>
  ({ account, threadId, url: `${account}/${threadId}`, date: new Date(Date.now() - minutes * 60_000).toISOString() }) as ThreadRow
const urls = (rows: ThreadRow[]) => rows.map((it) => it.url)

describe('useThreadList', () => {
  beforeEach(async () => {
    fakeBrowser.reset()
    await browser.storage.local.set({
      oauthAccounts: [
        { email: A, refreshToken: 'r', accessToken: 't', expiresAt: 0 },
        { email: B, refreshToken: 'r', accessToken: 't', expiresAt: 0 },
      ],
    })
    setTokenSource(async () => 'T')
    // Never answers: what shows is what was already known.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  const mount = (client: QueryClient, account: string) =>
    renderHook(() => useThreadList({ account, folder: 'INBOX' } as Parameters<typeof useThreadList>[0]), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
    })

  it("shows an account's rows from All inboxes straight away when going to that account", async () => {
    const client = new QueryClient()
    client.setQueryData(allInboxesKey(QUERY, [A, B]), {
      pages: [{ rows: [row(A, 'a1', 1), row(B, 'b1', 2), row(A, 'a2', 3)], tokens: { [A]: 'more', [B]: null } }],
      pageParams: [{}],
    })
    const { result } = await mount(client, A)
    await vi.waitFor(() => expect(urls(result.current.rows)).toEqual([`${A}/a1`, `${A}/a2`]))
    expect(result.current.isPending).toBe(false)
    // The real list decides what follows; a token from another list isn't used.
    expect(result.current.hasNextPage).toBe(false)
  })

  it("shows All inboxes from the accounts' lists straight away", async () => {
    const client = new QueryClient()
    client.setQueryData(mailKeys.list(A, 'INBOX', QUERY), {
      pages: [{ rows: [row(A, 'a1', 3)], nextPageToken: 'more' }],
      pageParams: [undefined],
    })
    client.setQueryData(mailKeys.list(B, 'INBOX', QUERY), {
      pages: [{ rows: [row(B, 'b1', 1)] }],
      pageParams: [undefined],
    })
    const { result } = await mount(client, 'all')
    await vi.waitFor(() => expect(urls(result.current.rows)).toEqual([`${B}/b1`, `${A}/a1`]))
    expect(result.current.isPending).toBe(false)
    expect(result.current.hasNextPage).toBe(false)
  })

  it('has nothing to show when it has seen nothing', async () => {
    const { result } = await mount(new QueryClient(), A)
    await vi.waitFor(() => expect(result.current.isPending).toBe(true))
    expect(result.current.rows).toEqual([])
  })
})
