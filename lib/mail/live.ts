import { useEffect, useRef } from 'react'
import type { Query } from '@tanstack/react-query'
import { mapLimit } from '../api/gmail'
import {
  getProfile,
  getThreadRowWithLabels,
  listHistory,
  isNotFound,
  type HistoryRecord,
  type ThreadRow,
} from '../api/mailbox'
import { OAuthError } from '../auth/oauth'
import { debugLog } from '../debugLog'
import { FAST_POLL_MS } from '../fastPoll'
import { queryClient } from '../queryClient'
import { idOf, LIST, patchRows, type ListData } from './actions'
import { listQuery } from './folders'
import { toAccountPages, type AllInboxesPage } from './merge'
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

// Gmail lists a thread under a query when one of its messages matches it, so
// membership is judged per message: one trashed reply doesn't take a thread
// out of the Inbox.
const belongs = (messageLabels: string[][], query: ListQuery) =>
  messageLabels.some(
    (labels) =>
      query.labelIds.every((it) => labels.includes(it)) &&
      (query.includeSpamTrash || !labels.some((it) => TRASH_SPAM.includes(it))),
  )

// Whether a row already in a list may stay: it is still in the list's folder,
// though perhaps no longer unread or in the category it was filtered by.
const inFolder = (messageLabels: string[][], folder: string) => belongs(messageLabels, listQuery(folder, {}))

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

// A row joins in date order among its account's loaded rows, so new mail lands
// on top. One older than all of them waits for its page while the account has
// more to load.
function inserted(key: readonly unknown[], data: ListData, row: ThreadRow): ListData | undefined {
  const all = isAllInboxes(key)
  const pages = data.pages.map((page) => ({ ...page, rows: [...page.rows] }))
  const time = Date.parse(row.date)
  for (const page of pages) {
    const at = page.rows.findIndex((r) => r.account === row.account && Date.parse(r.date) <= time)
    if (at >= 0) {
      page.rows.splice(at, 0, row)
      return { ...data, pages }
    }
  }
  const allPages = pages as unknown as AllInboxesPage[]
  const more = all ? !toAccountPages(allPages, [row.account])[0]!.exhausted : !!pages.at(-1)?.nextPageToken
  const last = all ? pages[allPages.findLastIndex((it) => row.account in it.tokens)] : pages.at(-1)
  if (!last || more) return undefined
  last.rows.push(row)
  return { ...data, pages }
}

// Puts a row from the server into each list: a new message moves its thread
// up; otherwise the row is updated where it is, joins the lists it now
// belongs in, and leaves the folders it left.
function place(row: ThreadRow, messageLabels: string[][], moved: boolean) {
  const id = idOf(row)
  for (const [key, data] of listsOf(row.account)) {
    const present = contains(data, id)
    let next: ListData | undefined
    if (belongs(messageLabels, queryOf(key) as ListQuery) && (moved || !present)) {
      next = inserted(key, without(data, id), row)
    } else if (present) {
      next = inFolder(messageLabels, String(key[3])) ? replaced(data, row) : without(data, id)
    }
    if (next) queryClient.setQueryData(key, next)
  }
}

function forget(account: string, threadId: string) {
  const id = idOf({ account, threadId })
  for (const [key, data] of listsOf(account)) {
    if (contains(data, id)) queryClient.setQueryData(key, without(data, id))
  }
}

const fetchRow = (account: string, threadId: string) =>
  getThreadRowWithLabels(account, threadId).catch((err) => {
    if (isNotFound(err)) return null
    throw err
  })

const isDraft = ({ message }: { message: { labelIds?: string[] } }) => !!message.labelIds?.includes('DRAFT')

// Replays an account's history onto the cached lists and open threads.
export async function applyHistory(account: string, records: HistoryRecord[]): Promise<'patched' | 'reload'> {
  if (records.length > MAX_RECORDS) return 'reload'
  // Every changed thread is refetched once: only its messages' own labels say
  // which lists it is in. The label patch below is just what shows meanwhile.
  const refetch = new Set<string>()
  const added = new Set<string>()
  const contentChanged = new Set<string>()
  let drafts = false
  const relabel = (threadId: string, ops: { add: string[]; remove: string[] }) =>
    patchRows(new Set([idOf({ account, threadId })]), ops, () => false)
  for (const record of records) {
    const changes = [
      ...(record.messagesAdded ?? []).map((it) => ({ ...it, kind: 'added' as const })),
      ...(record.messagesDeleted ?? []).map((it) => ({ ...it, kind: 'deleted' as const })),
      ...(record.labelsAdded ?? []).map((it) => ({ ...it, kind: 'labelAdded' as const })),
      ...(record.labelsRemoved ?? []).map((it) => ({ ...it, kind: 'labelRemoved' as const })),
    ]
    for (const change of changes) {
      // Saving a draft adds and deletes a message each time; it only matters
      // to Drafts.
      if (isDraft(change)) {
        drafts = true
        continue
      }
      const { threadId } = change.message
      refetch.add(threadId)
      if (change.kind === 'added') added.add(threadId)
      if (change.kind === 'added' || change.kind === 'deleted') contentChanged.add(threadId)
      if (change.kind === 'labelAdded') relabel(threadId, { add: change.labelIds, remove: [] })
      if (change.kind === 'labelRemoved') relabel(threadId, { add: [], remove: change.labelIds })
    }
  }
  const lists = (match: (key: readonly unknown[]) => boolean) =>
    void queryClient.invalidateQueries({
      predicate: ({ queryKey: key }) =>
        key[0] === 'mail' && key[1] === 'list' && showsAccount(key, account) && match(key),
    })
  if (refetch.size) lists(isSearch)
  if (drafts) lists((key) => key[3] === 'DRAFT')
  await mapLimit([...refetch], 4, async (threadId) => {
    const fetched = await fetchRow(account, threadId)
    if (contentChanged.has(threadId)) {
      void queryClient.invalidateQueries({ queryKey: mailKeys.thread(account, threadId) })
    }
    if (fetched) place(fetched.row, fetched.messageLabels, added.has(threadId))
    else forget(account, threadId)
  })
  return 'patched'
}

// Every cached mail query of the account, its share of All inboxes included.
// Open threads too: history that can't be replayed may have changed them.
const ofAccount = (account: string) => (q: Query) =>
  q.queryKey[0] === 'mail' &&
  (q.queryKey[1] === 'list' ? showsAccount(q.queryKey, account) : q.queryKey[2] === account)

// Keeps the cached lists current from each account's history. At most one
// check runs at a time; calls made during one share a single run after it.
export function createLiveChecker(accounts: () => string[]) {
  const lastHistoryId = new Map<string, string>()
  let running: Promise<void> | undefined
  let queued: Promise<void> | undefined

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
    if (running) {
      queued ??= running.then(() => {
        queued = undefined
        return checkNow()
      })
      return queued
    }
    running = Promise.all(
      accounts().map((account) =>
        check(account).catch(async (err) => {
          // A signed-out account waits for Reconnect; anything else for the
          // next check.
          if (!(err instanceof OAuthError)) await debugLog('live update failed', account, err)
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
