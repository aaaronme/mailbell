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
type ListData = InfiniteData<Page, string | undefined>

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

const patchLabels = (labelIds: string[], { add, remove }: { add: string[]; remove: string[] }) => [
  ...new Set([...labelIds.filter((it) => !remove.includes(it)), ...add]),
]

const LIST = ['mail', 'list'] as const

type Snapshot = [readonly unknown[], unknown][]

function patchCache(a: MailAction, targets: ActionTarget[]): Snapshot {
  const ids = new Set(targets.map((it) => `${it.account}\n${it.threadId}`))
  const ops = cacheOps(a)
  const snapshot: Snapshot = [
    ...queryClient.getQueriesData({ queryKey: LIST }),
    ...targets.flatMap((it) => queryClient.getQueriesData({ queryKey: mailKeys.thread(it.account, it.threadId) })),
  ]
  for (const [key, data] of queryClient.getQueriesData<ListData>({ queryKey: LIST })) {
    if (!data) continue
    const remove = removesFromFolder(a, String(key[3]))
    queryClient.setQueryData<ListData>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        rows: remove
          ? page.rows.filter((r) => !ids.has(`${r.account}\n${r.threadId}`))
          : page.rows.map((r) =>
              ids.has(`${r.account}\n${r.threadId}`) ? { ...r, labelIds: patchLabels(r.labelIds, ops) } : r,
            ),
      })),
    })
  }
  for (const it of targets) {
    queryClient.setQueryData<{ labelIds: string[] }>(mailKeys.thread(it.account, it.threadId), (open) =>
      open ? { ...open, labelIds: patchLabels(open.labelIds, ops) } : open,
    )
  }
  return snapshot
}

async function callApi(a: MailAction, account: string, ids: string[]) {
  const ops = labelOps(a)
  if (ops === 'trash') return trashThreads(account, ids)
  if (ops === 'untrash') return untrashThreads(account, ids)
  return modifyThreads(account, ids, ops.add, ops.remove)
}

export async function applyAction(a: MailAction, targets: ActionTarget[]): Promise<void> {
  const byAccount = Map.groupBy(targets, (it) => it.account)
  const snapshot = patchCache(a, targets)
  try {
    await Promise.all(
      [...byAccount].map(([account, group]) =>
        callApi(
          a,
          account,
          group.map((it) => it.threadId),
        ),
      ),
    )
  } catch (err) {
    for (const [key, data] of snapshot) queryClient.setQueryData(key, data)
    // Some threads may already have changed server-side, so refetch the truth.
    void queryClient.invalidateQueries({ queryKey: LIST })
    for (const it of targets) {
      void queryClient.invalidateQueries({ queryKey: mailKeys.thread(it.account, it.threadId) })
    }
    throw err
  }
  bgMessager.sendMessage('poll').catch(() => {})
}
