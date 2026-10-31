import { useMemo } from 'react'
import { queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getOpenThread, listLabels, listThreadPage, type ThreadRow } from '../api/mailbox'
import { parseThreadUrl } from '../api/gmail'
import type { MailSearch } from './search'
import { listQuery, type Category } from './folders'
import { useAccounts } from '../useAccounts'
import { mergeInboxes, toAccountPages, type AllInboxesPage } from './merge'

// Every list key carries its folder at index 3; optimistic patching in
// actions.ts relies on that.
export const mailKeys = {
  labels: (account: string) => ['mail', 'labels', account] as const,
  list: (account: string, folder: string, query: ReturnType<typeof listQuery>) =>
    ['mail', 'list', account, folder, query] as const,
  all: (cat: Category | undefined, unread: boolean | undefined, q: string | undefined) =>
    ['mail', 'list', 'all', 'INBOX', { cat, unread, q }] as const,
  thread: (account: string, threadId: string) => ['mail', 'thread', account, threadId] as const,
}

export const labelsOptions = (account: string) =>
  queryOptions({
    queryKey: mailKeys.labels(account),
    queryFn: () => listLabels(account),
    enabled: account !== 'all',
    staleTime: 60_000,
  })

export const useLabels = (account: string) => useQuery(labelsOptions(account))

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
  const result = useInfiniteQuery({
    queryKey: allInboxesKey(query, accounts),
    queryFn: async ({ pageParam }): Promise<AllInboxesPage> => {
      const asked = accounts.filter((it) => pageParam[it] !== null)
      const settled = await Promise.allSettled(asked.map((it) => listThreadPage(it, query, pageParam[it] ?? undefined)))
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
      const next = limiting.length ? limiting : open
      return Object.fromEntries(
        accounts.map((account) => [
          account,
          next.includes(account) ? pages.findLast((it) => it.tokens[account])!.tokens[account] : null,
        ]),
      )
    },
    select: (data) => mergeInboxes(toAccountPages(data.pages, accounts)).rows,
    enabled: enabled && accountsQuery.isSuccess,
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
    queryFn: ({ pageParam }) => listThreadPage(account, query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken,
    enabled: account !== 'all',
  })
  const rows = useMemo(() => result.data?.pages.flatMap((it) => it.rows) ?? [], [result.data])
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

export function useOpenThread(url?: string) {
  const parsed = url ? parseThreadUrl(url) : null
  return useQuery({
    queryKey: mailKeys.thread(parsed?.account ?? '', parsed?.threadId ?? ''),
    queryFn: () => getOpenThread(parsed!.account, parsed!.threadId),
    enabled: !!parsed,
    staleTime: 60_000,
  })
}
