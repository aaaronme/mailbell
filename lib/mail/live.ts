import { useEffect, useRef } from 'react'
import type { Query } from '@tanstack/react-query'
import { mapLimit } from '../api/gmail'
import {
  getProfile,
  getThreadRow,
  isNotFound,
  listHistory,
  type HistoryRecord,
  type ThreadRow,
} from '../api/mailbox'
import { OAuthError } from '../auth/oauth'
import { FAST_POLL_MS } from '../fastPoll'
import { queryClient } from '../queryClient'
import { idOf, LIST, patchLabels, patchRows, type LabelOps, type ListData } from './actions'
import type { listQuery } from './folders'
import type { AllInboxesPage } from './merge'
import { mailKeys } from './queries'

// Past this, refetching is cheaper than replaying.
const MAX_RECORDS = 50

const TRASH_SPAM = ['TRASH', 'SPAM']

type ListQuery = ReturnType<typeof listQuery>

const queryOf = (key: readonly unknown[]) => key[4] as Partial<ListQuery> | undefined
const isAllInboxes = (key: readonly unknown[]) => key[2] === 'all'
// A search list can't be matched against labels; it is refetched instead.
const isSearch = (key: readonly unknown[]) => !Array.isArray(queryOf(key)?.labelIds) || !!queryOf(key)?.q

const showsAccount = (key: readonly unknown[], account: string) =>
  isAllInboxes(key) ? ((key[5] as string[] | undefined)?.includes(account) ?? false) : key[2] === account

// Whether a row with these labels still belongs in the folder's list.
function inFolder(labelIds: string[], folder: string): boolean {
  if (TRASH_SPAM.includes(folder)) return labelIds.includes(folder)
  if (labelIds.some((it) => TRASH_SPAM.includes(it))) return false
  return folder === 'ALL' || labelIds.includes(folder)
}

// Whether a row not yet in the list should join it: it has every label the
// list asks for.
function belongs(row: ThreadRow, query: ListQuery): boolean {
  return (
    query.labelIds.every((it) => row.labelIds.includes(it)) &&
    (query.includeSpamTrash || !row.labelIds.some((it) => TRASH_SPAM.includes(it)))
  )
}

// The account's cached lists that can be matched locally.
function* listsOf(account: string) {
  for (const [key, data] of queryClient.getQueriesData<ListData>({ queryKey: LIST })) {
    if (data && showsAccount(key, account) && !isSearch(key)) yield [key, data] as const
  }
}

const contains = (data: ListData, id: string) => data.pages.some((page) => page.rows.some((r) => idOf(r) === id))

const without = (data: ListData, id: string): ListData => ({
  ...data,
  pages: data.pages.map((page) => ({ ...page, rows: page.rows.filter((r) => idOf(r) !== id) })),
})

const replaced = (data: ListData, row: ThreadRow): ListData => ({
  ...data,
  pages: data.pages.map((page) => ({ ...page, rows: page.rows.map((r) => (idOf(r) === idOf(row) ? row : r)) })),
})

// A row joins in date order among the loaded rows, so new mail lands on top;
// one older than all of them waits for its page, unless every page is loaded.
// All inboxes sorts rows itself: there it joins the first page that asked its
// account.
function inserted(key: readonly unknown[], data: ListData, row: ThreadRow): ListData | undefined {
  const pages = data.pages.map((page) => ({ ...page, rows: [...page.rows] }))
  if (isAllInboxes(key)) {
    const page = pages.find((it) => row.account in ((it as unknown as AllInboxesPage).tokens ?? {}))
    if (!page) return undefined
    page.rows.unshift(row)
    return { ...data, pages }
  }
  const time = Date.parse(row.date)
  for (const page of pages) {
    const at = page.rows.findIndex((r) => Date.parse(r.date) <= time)
    if (at >= 0) {
      page.rows.splice(at, 0, row)
      return { ...data, pages }
    }
  }
  const last = pages.at(-1)
  if (!last || last.nextPageToken) return undefined
  last.rows.push(row)
  return { ...data, pages }
}

// Puts a row from the server into each list: a new message moves its thread
// to the top; otherwise the row is updated where it is, joins the lists it
// now belongs in, and leaves the folders it left.
function place(row: ThreadRow, moved: boolean) {
  const id = idOf(row)
  for (const [key, data] of listsOf(row.account)) {
    const present = contains(data, id)
    const query = queryOf(key) as ListQuery
    let next: ListData | undefined
    if (belongs(row, query) && (moved || !present)) next = inserted(key, without(data, id), row)
    else if (present) next = inFolder(row.labelIds, String(key[3])) ? replaced(data, row) : without(data, id)
    if (next) queryClient.setQueryData(key, next)
  }
}

function forget(account: string, threadId: string) {
  const id = idOf({ account, threadId })
  for (const [key, data] of listsOf(account)) {
    if (contains(data, id)) queryClient.setQueryData(key, without(data, id))
  }
}

function cachedRow(account: string, threadId: string): ThreadRow | undefined {
  const id = idOf({ account, threadId })
  for (const [, data] of listsOf(account)) {
    for (const page of data.pages) {
      const found = page.rows.find((r) => idOf(r) === id)
      if (found) return found
    }
  }
}

// Patches the thread's cached rows and remembers it as patched in `known`,
// even after it has left every list, so a list it joins later in the same
// history (Trash) can still take it.
function relabel(account: string, threadId: string, ops: LabelOps, known: Map<string, ThreadRow>) {
  const before = cachedRow(account, threadId) ?? known.get(threadId)
  patchRows(
    new Set([idOf({ account, threadId })]),
    ops,
    (row, key) => !isSearch(key) && !inFolder(row.labelIds, String(key[3])),
  )
  if (before) known.set(threadId, { ...before, labelIds: patchLabels(before.labelIds, ops) })
}

const fetchRow = (account: string, threadId: string) =>
  getThreadRow(account, threadId).catch((err) => {
    if (isNotFound(err)) return null
    throw err
  })

// Replays an account's history onto the cached lists and open threads.
export async function applyHistory(account: string, records: HistoryRecord[]): Promise<'patched' | 'reload'> {
  if (records.length > MAX_RECORDS) return 'reload'
  const added = new Set<string>()
  const deleted = new Set<string>()
  const labeled = new Set<string>()
  const known = new Map<string, ThreadRow>()
  for (const record of records) {
    for (const { message } of record.messagesAdded ?? []) added.add(message.threadId)
    for (const { message } of record.messagesDeleted ?? []) deleted.add(message.threadId)
    for (const { message, labelIds } of record.labelsAdded ?? []) {
      relabel(account, message.threadId, { add: labelIds, remove: [] }, known)
      labeled.add(message.threadId)
    }
    for (const { message, labelIds } of record.labelsRemoved ?? []) {
      relabel(account, message.threadId, { add: [], remove: labelIds }, known)
    }
  }
  if (records.length) {
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[1] === 'list' && isSearch(q.queryKey) && showsAccount(q.queryKey, account),
    })
  }
  const refetch = [...new Set([...added, ...deleted])]
  await mapLimit(refetch, 4, async (threadId) => {
    const row = await fetchRow(account, threadId)
    void queryClient.invalidateQueries({ queryKey: mailKeys.thread(account, threadId) })
    if (row) place(row, added.has(threadId))
    else forget(account, threadId)
  })
  // A label can bring a row into a list it wasn't in.
  await mapLimit(
    [...labeled].filter((it) => !refetch.includes(it)),
    4,
    async (threadId) => {
      const row = known.get(threadId) ?? (await fetchRow(account, threadId))
      if (row) place(row, false)
    },
  )
  return 'patched'
}

// Every cached mail query of the account, All inboxes included.
const ofAccount = (account: string) => (q: Query) =>
  q.queryKey[0] === 'mail' && (q.queryKey[2] === account || (q.queryKey[1] === 'list' && isAllInboxes(q.queryKey)))

// Keeps the cached lists current from each account's history. At most one
// check runs at a time; a call while one runs gets that one.
export function createLiveChecker(accounts: () => string[]) {
  const lastHistoryId = new Map<string, string>()
  let running: Promise<void> | undefined

  async function check(account: string) {
    const { historyId } = await getProfile(account)
    const last = lastHistoryId.get(account)
    if (last === undefined || last === historyId) {
      lastHistoryId.set(account, historyId)
      return
    }
    const history = await listHistory(account, last)
    const outcome = history === 'expired' ? 'reload' : await applyHistory(account, history.history)
    if (outcome === 'reload') void queryClient.invalidateQueries({ predicate: ofAccount(account) })
    void queryClient.invalidateQueries({ queryKey: mailKeys.labels(account) })
    lastHistoryId.set(account, history === 'expired' ? historyId : history.historyId)
  }

  function checkNow(): Promise<void> {
    running ??= Promise.all(
      accounts().map((account) =>
        check(account).catch((err) => {
          // A signed-out account waits for Reconnect; anything else for the
          // next check.
          if (!(err instanceof OAuthError)) console.warn('live update failed', account, err)
        }),
      ),
    ).then(() => {
      running = undefined
    })
    return running
  }
  return { checkNow }
}

// While the view is visible: checks every FAST_POLL_MS and on focus. Returns
// checkNow for callers that know something changed.
export function useLiveUpdates(accounts: string[]): () => Promise<void> {
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const checker = useRef<ReturnType<typeof createLiveChecker>>(undefined)
  checker.current ??= createLiveChecker(() => accountsRef.current)
  const { checkNow } = checker.current
  const key = accounts.join('\n')
  useEffect(() => {
    // Seeds the history ids of accounts not seen yet.
    void checkNow()
    const tick = () => {
      if (document.visibilityState === 'visible') void checkNow()
    }
    const timer = setInterval(tick, FAST_POLL_MS)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [checkNow, key])
  return checkNow
}
