import { useCallback, useMemo } from 'react'
import { queryOptions, type InfiniteData, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { getOpenThread, listLabels, listThreadPage, type GmailLabel, type ThreadRow } from '../api/mailbox'
import { parseThreadUrl } from '../api/gmail'
import type { MailSearch } from './search'
import { listQuery } from './folders'
import { useAccounts } from '../useAccounts'
import { mergeInboxes, toAccountPages, uniqueRows, type AllInboxesPage } from './merge'

// Every list key carries its folder at index 3; optimistic patching in
// actions.ts relies on that.
export const mailKeys = {
  labels: (account: string) => ['mail', 'labels', account] as const,
  list: (account: string, folder: string, query: ReturnType<typeof listQuery>) =>
    ['mail', 'list', account, folder, query] as const,
  thread: (account: string, threadId: string) => ['mail', 'thread', account, threadId] as const,
}

// Live updates keep these fresh; a refetch on every tab focus would re-list
// each loaded page (a metadata GET per row) for nothing.
const LIVE = { refetchOnWindowFocus: false } as const
// A list also stays fresh when returned to: refetching would re-list every
// page loaded, while the folder being opened waits for the quota.
const LIVE_LIST = { ...LIVE, staleTime: Infinity } as const

export const labelsOptions = (account: string) =>
  queryOptions({
    queryKey: mailKeys.labels(account),
    queryFn: () => listLabels(account),
    enabled: account !== 'all',
    staleTime: 60_000,
    ...LIVE,
  })

export const useLabels = (account: string) => useQuery(labelsOptions(account))

// What All inboxes counts by: each system label's counts summed over the
// accounts. User label ids are per account, so they don't add up.
function sumSystemLabels(results: { data?: GmailLabel[] }[]): GmailLabel[] {
  const byId = new Map<string, GmailLabel>()
  for (const label of results.flatMap((it) => it.data ?? [])) {
    if (label.type !== 'system') continue
    const had = byId.get(label.id)
    byId.set(
      label.id,
      had
        ? {
            ...had,
            threadsTotal: (had.threadsTotal ?? 0) + (label.threadsTotal ?? 0),
            threadsUnread: (had.threadsUnread ?? 0) + (label.threadsUnread ?? 0),
          }
        : label,
    )
  }
  return [...byId.values()]
}

export const useSummedLabels = (accounts: string[]) =>
  useQueries({ queries: accounts.map(labelsOptions), combine: sumSystemLabels })

export interface ThreadListResult {
  rows: ThreadRow[]
  hasNextPage: boolean
  fetchNextPage(): void
  isFetchingNextPage: boolean
  isPending: boolean
  error: unknown
}

// Per account: a token to continue from, undefined for its first page, null to
// leave it out of this round.
type AllPageParam = Record<string, string | null | undefined>

// The accounts ride along in the key so a sign-in or sign-out refetches; index
// 3 stays the folder, which optimistic patching reads.
export const allInboxesKey = (query: ReturnType<typeof listQuery>, accounts: string[]) =>
  [...mailKeys.list('all', 'INBOX', query), accounts] as const

// Search in All inboxes searches every account. A failed account counts as
// exhausted so the others still show, unless none answer at all.
function useAllInboxes(search: MailSearch, enabled: boolean): ThreadListResult {
  const query = listQuery('INBOX', { category: search.cat, q: search.q, unread: search.unread })
  const accountsQuery = useAccounts()
  const accounts = useMemo(() => (accountsQuery.data ?? []).map((it) => it.email), [accountsQuery.data])
  const select = useCallback(
    (data: InfiniteData<AllInboxesPage, AllPageParam>) => mergeInboxes(toAccountPages(data.pages, accounts)).rows,
    [accounts],
  )
  const result = useInfiniteQuery({
    queryKey: allInboxesKey(query, accounts),
    queryFn: async ({ pageParam, signal }): Promise<AllInboxesPage> => {
      const asked = accounts.filter((it) => pageParam[it] !== null)
      const settled = await Promise.allSettled(
        asked.map((it) => listThreadPage(it, query, pageParam[it] ?? undefined, signal)),
      )
      if (asked.length && settled.every((it) => it.status === 'rejected') && !Object.keys(pageParam).length) {
        throw (settled[0] as PromiseRejectedResult).reason
      }
      return {
        rows: settled.flatMap((it) => (it.status === 'fulfilled' ? it.value.rows : [])),
        tokens: Object.fromEntries(
          asked.map((it, i) => {
            const page = settled[i]!
            return [it, page.status === 'fulfilled' ? (page.value.nextPageToken ?? null) : null]
          }),
        ),
      }
    },
    initialPageParam: {} as AllPageParam,
    getNextPageParam: (_last, pages): AllPageParam | undefined => {
      const merged = toAccountPages(pages, accounts)
      const open = merged.filter((it) => !it.exhausted).map((it) => it.account)
      if (!open.length) return undefined
      const { limiting } = mergeInboxes(merged)
      // limiting is empty only when a date is unparseable (NaN never equals the cutoff); page everything open rather than stall.
      const next = limiting.length ? limiting : open
      return Object.fromEntries(
        accounts.map((account) => [
          account,
          next.includes(account) ? pages.findLast((it) => it.tokens[account])!.tokens[account] : null,
        ]),
      )
    },
    select,
    enabled: enabled && accountsQuery.isSuccess,
    ...LIVE_LIST,
  })
  return {
    rows: result.data ?? NO_LIST,
    hasNextPage: result.hasNextPage,
    fetchNextPage: () => void result.fetchNextPage(),
    isFetchingNextPage: result.isFetchingNextPage,
    isPending: result.isPending,
    error: result.error,
  }
}

const NO_LIST: ThreadRow[] = []

export function useThreadList(search: MailSearch): ThreadListResult {
  const { account, folder, cat, q, unread } = search
  const query = listQuery(folder, { category: cat, q, unread })
  // Hooks can't be conditional, so each source is enabled only for its own case.
  const all = useAllInboxes(search, account === 'all')
  const result = useInfiniteQuery({
    queryKey: mailKeys.list(account, folder, query),
    queryFn: ({ pageParam, signal }) => listThreadPage(account, query, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken,
    enabled: account !== 'all',
    ...LIVE_LIST,
  })
  const rows = useMemo(() => uniqueRows(result.data?.pages.flatMap((it) => it.rows) ?? []), [result.data])
  if (account === 'all') return all
  return {
    rows,
    hasNextPage: result.hasNextPage,
    fetchNextPage: () => void result.fetchNextPage(),
    isFetchingNextPage: result.isFetchingNextPage,
    isPending: result.isPending,
    error: result.error,
  }
}

// Shared with usePreload so a preloaded thread lands under the key the open
// view reads.
export const threadOptions = (url?: string) => {
  const parsed = url ? parseThreadUrl(url) : null
  return queryOptions({
    queryKey: mailKeys.thread(parsed?.account ?? '', parsed?.threadId ?? ''),
    queryFn: ({ signal }) => getOpenThread(parsed!.account, parsed!.threadId, signal),
    enabled: !!parsed,
    staleTime: 60_000,
    ...LIVE,
  })
}

export const useOpenThread = (url?: string) => useQuery(threadOptions(url))
