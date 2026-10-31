import type { InfiniteData } from '@tanstack/react-query'
import { modifyThreads, trashThreads, untrashThreads, type ThreadRow } from '../api/mailbox'
import { bgMessager } from '../messager'
import { queryClient } from '../queryClient'
import { mailKeys } from './queries'

export type MailAction =
  | { kind: 'archive' | 'trash' | 'restore' | 'spam' | 'notSpam' | 'read' | 'unread' | 'star' | 'unstar' }
  | { kind: 'label'; labelId: string; name: string }
  | { kind: 'unlabel'; labelId: string; name: string }
  // Adds labelId and removes `from`, the label of the folder the thread is in.
  | { kind: 'move'; labelId: string; name: string; from: string }

export interface ActionTarget {
  account: string
  threadId: string
  url: string
}

type Page = { rows: ThreadRow[]; nextPageToken?: string }
export type ListData = InfiniteData<Page, string | undefined>

export function labelOps(a: MailAction): { add: string[]; remove: string[] } | 'trash' | 'untrash' {
  switch (a.kind) {
    case 'archive':
      return { add: [], remove: ['INBOX'] }
    case 'trash':
      return 'trash'
    case 'restore':
      return 'untrash'
    case 'spam':
      return { add: ['SPAM'], remove: ['INBOX'] }
    case 'notSpam':
      return { add: ['INBOX'], remove: ['SPAM'] }
    case 'read':
      return { add: [], remove: ['UNREAD'] }
    case 'unread':
      return { add: ['UNREAD'], remove: [] }
    case 'star':
      return { add: ['STARRED'], remove: [] }
    case 'unstar':
      return { add: [], remove: ['STARRED'] }
    case 'label':
      return { add: [a.labelId], remove: [] }
    case 'unlabel':
      return { add: [], remove: [a.labelId] }
    case 'move':
      return { add: [a.labelId], remove: [a.from] }
  }
}

export function inverse(a: MailAction): MailAction {
  switch (a.kind) {
    case 'archive':
      return { kind: 'label', labelId: 'INBOX', name: 'Inbox' }
    case 'trash':
      return { kind: 'restore' }
    case 'restore':
      return { kind: 'trash' }
    case 'spam':
      return { kind: 'notSpam' }
    case 'notSpam':
      return { kind: 'spam' }
    case 'read':
      return { kind: 'unread' }
    case 'unread':
      return { kind: 'read' }
    case 'star':
      return { kind: 'unstar' }
    case 'unstar':
      return { kind: 'star' }
    case 'label':
      return { kind: 'unlabel', labelId: a.labelId, name: a.name }
    case 'unlabel':
      return { kind: 'label', labelId: a.labelId, name: a.name }
    // The folder's display name isn't known here; it only reaches toast text.
    case 'move':
      return { kind: 'move', labelId: a.from, name: a.from, from: a.labelId }
  }
}

// Past-tense toast text and the imperative for the error toast, side by side.
const ACTION_WORDS: Record<MailAction['kind'], (a: MailAction) => { text: string; verb: string }> = {
  archive: () => ({ text: 'Archived', verb: 'archive' }),
  trash: () => ({ text: 'Moved to Trash', verb: 'delete' }),
  restore: () => ({ text: 'Restored', verb: 'restore' }),
  spam: () => ({ text: 'Marked as spam', verb: 'mark as spam' }),
  notSpam: () => ({ text: 'Moved to Inbox', verb: 'move to Inbox' }),
  read: () => ({ text: 'Marked as read', verb: 'mark as read' }),
  unread: () => ({ text: 'Marked as unread', verb: 'mark as unread' }),
  star: () => ({ text: 'Starred', verb: 'star' }),
  unstar: () => ({ text: 'Unstarred', verb: 'unstar' }),
  label: (a) => ({ text: `Labeled "${nameOf(a)}"`, verb: 'label' }),
  unlabel: (a) => ({ text: `Removed "${nameOf(a)}"`, verb: 'remove the label' }),
  move: (a) => ({ text: `Moved to "${nameOf(a)}"`, verb: 'move' }),
}

const nameOf = (a: MailAction) => ('name' in a ? a.name : '')

export function ACTION_TEXT(a: MailAction, count: number): string {
  const { text } = ACTION_WORDS[a.kind](a)
  return count > 1 ? `${text} · ${count} conversations` : text
}

export const actionVerb = (a: MailAction): string => ACTION_WORDS[a.kind](a).verb

export function removesFromFolder(a: MailAction, folder: string): boolean {
  if (folder === 'ALL') return false
  switch (a.kind) {
    case 'archive':
      return true
    case 'trash':
      return folder !== 'TRASH'
    case 'spam':
      return folder !== 'SPAM'
    case 'restore':
      return folder === 'TRASH'
    case 'notSpam':
      return folder === 'SPAM'
    case 'move':
      return folder !== a.labelId
    default:
      return false
  }
}

// What a row that stays in its list should show afterwards.
function cacheOps(a: MailAction): { add: string[]; remove: string[] } {
  if (a.kind === 'trash') return { add: ['TRASH'], remove: ['INBOX'] }
  if (a.kind === 'restore') return { add: ['INBOX'], remove: ['TRASH'] }
  return labelOps(a) as { add: string[]; remove: string[] }
}

export interface LabelOps {
  add: string[]
  remove: string[]
}

export const patchLabels = (labelIds: string[], { add, remove }: LabelOps) => [
  ...new Set([...labelIds.filter((it) => !remove.includes(it)), ...add]),
]

export const LIST = ['mail', 'list'] as const

// What patchCache changed, per list key, for the action's own rows only, so
// rollback and undo never touch rows another action has since changed.
interface RowRecord {
  row: ThreadRow
  removed?: { page: number; index: number }
}
export interface Patch {
  lists: [readonly unknown[], RowRecord[]][]
  threads: [readonly unknown[], unknown][]
}

export const idOf = (it: { account: string; threadId: string }) => `${it.account}\n${it.threadId}`

// Applies ops to the cached rows in ids, in every list and in the open
// threads, dropping each row from the lists `drops` says it left (given the
// patched row and the list's key). Shared with live updates.
export function patchRows(
  ids: Set<string>,
  ops: LabelOps,
  drops: (row: ThreadRow, key: readonly unknown[]) => boolean,
): Patch['lists'] {
  const lists: Patch['lists'] = []
  for (const [key, data] of queryClient.getQueriesData<ListData>({ queryKey: LIST })) {
    if (!data) continue
    const records: RowRecord[] = []
    const pages = data.pages.map((page, p) => ({
      ...page,
      rows: page.rows.flatMap((r, index) => {
        if (!ids.has(idOf(r))) return [r]
        const next = { ...r, labelIds: patchLabels(r.labelIds, ops) }
        const remove = drops(next, key)
        records.push(remove ? { row: r, removed: { page: p, index } } : { row: r })
        return remove ? [] : [next]
      }),
    }))
    if (!records.length) continue
    lists.push([key, records])
    queryClient.setQueryData<ListData>(key, { ...data, pages })
  }
  for (const [key, open] of queryClient.getQueriesData<{ labelIds: string[] }>({ queryKey: ['mail', 'thread'] })) {
    if (open && ids.has(idOf({ account: String(key[2]), threadId: String(key[3]) }))) {
      queryClient.setQueryData(key, { ...open, labelIds: patchLabels(open.labelIds, ops) })
    }
  }
  return lists
}

function patchCache(a: MailAction, targets: ActionTarget[]): Patch {
  const threads = targets.flatMap((it) =>
    queryClient.getQueriesData({ queryKey: mailKeys.thread(it.account, it.threadId) }),
  )
  const lists = patchRows(new Set(targets.map(idOf)), cacheOps(a), (_, key) => removesFromFolder(a, String(key[3])))
  return { lists, threads }
}

// Puts the recorded rows back as they were, leaving every other row alone.
function restorePatch(patch: Patch) {
  for (const [key, records] of patch.lists) {
    const data = queryClient.getQueryData<ListData>(key)
    if (!data) continue
    const pages = data.pages.map((page) => ({ ...page, rows: [...page.rows] }))
    const present = new Set(pages.flatMap((page) => page.rows.map(idOf)))
    for (const { row, removed } of records) {
      if (!removed) {
        for (const page of pages) {
          page.rows = page.rows.map((r) => (idOf(r) === idOf(row) ? { ...r, labelIds: row.labelIds } : r))
        }
      } else if (!present.has(idOf(row)) && pages.length) {
        const page = pages[Math.min(removed.page, pages.length - 1)]!
        page.rows.splice(Math.min(removed.index, page.rows.length), 0, row)
      }
    }
    queryClient.setQueryData<ListData>(key, { ...data, pages })
  }
  for (const [key, data] of patch.threads) queryClient.setQueryData(key, data)
}

async function callApi(a: MailAction, targets: ActionTarget[]) {
  const ops = labelOps(a)
  await Promise.all(
    [...Map.groupBy(targets, (it) => it.account)].map(([account, group]) => {
      const ids = group.map((it) => it.threadId)
      if (ops === 'trash') return trashThreads(account, ids)
      if (ops === 'untrash') return untrashThreads(account, ids)
      return modifyThreads(account, ids, ops.add, ops.remove)
    }),
  )
}

// Some threads may already have changed server-side, so refetch the truth.
function invalidateFor(targets: ActionTarget[]) {
  void queryClient.invalidateQueries({ queryKey: LIST })
  for (const it of targets) {
    void queryClient.invalidateQueries({ queryKey: mailKeys.thread(it.account, it.threadId) })
  }
}

const poll = () => bgMessager.sendMessage('poll').catch(() => {})

// Like applyAction, but returns what it changed in the cache so undo can put
// those rows back.
export async function applyWithPatch(a: MailAction, targets: ActionTarget[]): Promise<Patch> {
  const patch = patchCache(a, targets)
  try {
    await callApi(a, targets)
  } catch (err) {
    restorePatch(patch)
    invalidateFor(targets)
    throw err
  }
  void poll()
  return patch
}

export async function applyAction(a: MailAction, targets: ActionTarget[]): Promise<void> {
  await applyWithPatch(a, targets)
}

// Reverses a successful action. Rows come back immediately; if the inverse
// call fails the action's effect is put back so the cache matches the server.
export async function revertAction(a: MailAction, targets: ActionTarget[], patch: Patch): Promise<void> {
  restorePatch(patch)
  try {
    await callApi(inverse(a), targets)
  } catch (err) {
    patchCache(a, targets)
    invalidateFor(targets)
    throw err
  }
  // inverse(archive) re-adds INBOX even where it was never set, so lists are
  // refetched rather than trusted.
  invalidateFor(targets)
  void poll()
}
