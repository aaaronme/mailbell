import { useMemo } from 'react'
import { queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getOpenThread, listLabels, listThreadPage, type ThreadRow } from '../api/mailbox'
import { parseThreadUrl } from '../api/gmail'
import type { MailSearch } from './search'
import { listQuery, type Category } from './folders'

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

const NO_ROWS: ThreadListResult = { rows: [], hasNextPage: false, fetchNextPage: () => {}, isFetchingNextPage: false, isPending: false, error: null }

export function useThreadList(search: MailSearch): ThreadListResult {
  const { account, folder, cat, q, unread } = search
  const query = listQuery(folder, { category: cat, q, unread })
  // Hooks can't be conditional, so the all-accounts case disables this one.
  const result = useInfiniteQuery({
    queryKey: mailKeys.list(account, folder, query),
    queryFn: ({ pageParam }) => listThreadPage(account, query, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken,
    enabled: account !== 'all',
  })
  const rows = useMemo(() => result.data?.pages.flatMap((it) => it.rows) ?? [], [result.data])
  if (account === 'all') return NO_ROWS
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
