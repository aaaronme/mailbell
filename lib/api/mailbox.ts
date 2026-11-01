import {
  fetchInlineData,
  gmailBatchGet,
  gmailFetch,
  header,
  isApiError,
  mapLimit,
  parseAddressField,
  parseMailbox,
  threadToMail,
  threadUrl,
  type GmailThread,
  type ThreadMail,
} from './gmail'
import { CATEGORY_LABEL, type listQuery } from '../mail/folders'

export interface GmailLabel {
  id: string
  name: string
  type: 'system' | 'user'
  threadsUnread?: number
  threadsTotal?: number
  color?: { backgroundColor: string; textColor: string }
}

// labels.list carries no counts, so labels.get is only worth it for the ones
// shown with one.
const COUNTED_SYSTEM = new Set(['INBOX', 'SPAM', 'DRAFT', ...Object.values(CATEGORY_LABEL)])

export async function listLabels(account: string): Promise<GmailLabel[]> {
  const { labels = [] } = await gmailFetch<{ labels?: GmailLabel[] }>(account, '/labels')
  return mapLimit(labels, 4, (label) =>
    label.type === 'user' || COUNTED_SYSTEM.has(label.id)
      ? gmailFetch<GmailLabel>(account, `/labels/${encodeURIComponent(label.id)}`)
      : Promise.resolve(label),
  )
}

// A Map, so a sender's "&constructor;" can't reach Object.prototype.
const NAMED_ENTITIES = new Map(Object.entries({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }))

// Gmail's snippet is HTML-escaped text. Decoded in one pass, so "&amp;lt;"
// stays "&lt;"; never through the DOM.
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (whole, dec, hex, name) => {
    const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : undefined
    if (code === undefined) return NAMED_ENTITIES.get(String(name).toLowerCase()) ?? whole
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole
  })
}

export interface ThreadRow {
  url: string
  account: string
  threadId: string
  subject: string
  snippet: string
  from: { name: string; email: string }
  to: string[]
  // The newest message's time.
  date: string
  // Union over the thread's messages.
  labelIds: string[]
  messageCount: number
  hasAttachment: boolean
  // The newest message's first Authentication-Results.
  authResults?: string
}

const ROW_HEADERS = ['From', 'To', 'Subject', 'Authentication-Results', 'Content-Type']

const labelsOf = (thread: GmailThread) => [...new Set(thread.messages.flatMap((it) => it.labelIds ?? []))]

function threadToRow(account: string, thread: GmailThread): ThreadRow {
  const first = thread.messages[0]!
  const last = thread.messages.at(-1)!
  // A draft being written would otherwise move the thread up with every save.
  const dated = thread.messages.findLast((it) => !it.labelIds?.includes('DRAFT')) ?? last
  return {
    url: threadUrl(account, thread.id),
    account,
    threadId: thread.id,
    subject: header(first.payload, 'Subject') ?? '',
    snippet: decodeEntities(last.snippet ?? thread.snippet ?? ''),
    from: parseMailbox(header(last.payload, 'From') ?? ''),
    to: parseAddressField(header(last.payload, 'To') ?? ''),
    date: new Date(Number(dated.internalDate)).toISOString(),
    labelIds: labelsOf(thread),
    messageCount: thread.messages.length,
    // Metadata format has no parts; a mixed top level is how attachments show.
    hasAttachment: thread.messages.some((it) =>
      header(it.payload, 'Content-Type')?.toLowerCase().startsWith('multipart/mixed'),
    ),
    authResults: header(last.payload, 'Authentication-Results'),
  }
}

const CATEGORY_OF = new Map(Object.entries(CATEGORY_LABEL).map(([category, label]) => [label, category]))

export async function listThreadPage(
  account: string,
  query: ReturnType<typeof listQuery>,
  pageToken?: string,
  signal?: AbortSignal,
): Promise<{ rows: ThreadRow[]; nextPageToken?: string }> {
  // A short first page shows mail sooner; the list's sentinel asks for the
  // next one straight after.
  const params = new URLSearchParams({ maxResults: pageToken ? '50' : '15' })
  query.labelIds.forEach((it) => params.append('labelIds', it))
  // labelIds can only require labels; leaving some out takes a search.
  const excluded = query.excludeLabelIds?.map((label) => `-category:${CATEGORY_OF.get(label)}`)
  const q = [query.q, ...(excluded ?? [])].filter(Boolean).join(' ')
  if (q) params.set('q', q)
  if (query.includeSpamTrash) params.set('includeSpamTrash', 'true')
  if (pageToken) params.set('pageToken', pageToken)
  const list = await gmailFetch<{ threads?: { id: string }[]; nextPageToken?: string }>(
    account,
    `/threads?${params}`,
    { signal },
  )
  const ids = (list.threads ?? []).map((it) => it.id)
  const rows: ThreadRow[] = []
  // Each row costs its own 10-unit metadata fetch; a batch of 20 stays under
  // the 250 units a user gets per second.
  for (let at = 0; at < ids.length; at += 20) {
    const chunk = ids.slice(at, at + 20)
    const threads = await gmailBatchGet<GmailThread>(account, chunk.map(rowPath), signal)
    for (const thread of threads) {
      // Deleted between the list and its rows: just gone.
      if (isNotFound(thread)) continue
      if (isApiError(thread)) throw thread
      rows.push(threadToRow(account, thread))
    }
  }
  return { rows, nextPageToken: list.nextPageToken }
}

const ROW_METADATA = ROW_HEADERS.map((it) => `metadataHeaders=${it}`).join('&')
const rowPath = (threadId: string) => `/threads/${threadId}?format=metadata&${ROW_METADATA}`

export async function getThreadRow(account: string, threadId: string): Promise<ThreadRow> {
  return (await getThreadRowWithLabels(account, threadId)).row
}

// The row plus each message's own labels: a thread is in a folder when one of
// its messages is, which the row's union can't tell.
export async function getThreadRowWithLabels(
  account: string,
  threadId: string,
): Promise<{ row: ThreadRow; messageLabels: string[][] }> {
  const thread = await gmailFetch<GmailThread>(account, rowPath(threadId))
  return { row: threadToRow(account, thread), messageLabels: thread.messages.map((it) => it.labelIds ?? []) }
}

// gmailFetch's error carries the HTTP status.
export const isNotFound = (err: unknown): boolean => (err as { status?: unknown } | null)?.status === 404

export async function getProfile(account: string): Promise<{ historyId: string }> {
  return gmailFetch<{ historyId: string }>(account, '/profile')
}

interface HistoryMessage {
  message: { id: string; threadId: string; labelIds?: string[] }
}

// Only the fields live updates read.
export interface HistoryRecord {
  messagesAdded?: HistoryMessage[]
  messagesDeleted?: HistoryMessage[]
  labelsAdded?: (HistoryMessage & { labelIds: string[] })[]
  labelsRemoved?: (HistoryMessage & { labelIds: string[] })[]
}

const HISTORY_TYPES = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']

// Every change since startHistoryId. Gmail answers 404 for an id older than
// the history it keeps: 'expired', so the caller reloads instead.
export async function listHistory(
  account: string,
  startHistoryId: string,
): Promise<{ history: HistoryRecord[]; historyId: string } | 'expired'> {
  const history: HistoryRecord[] = []
  let pageToken: string | undefined
  try {
    for (;;) {
      const params = new URLSearchParams({ startHistoryId })
      HISTORY_TYPES.forEach((it) => params.append('historyTypes', it))
      if (pageToken) params.set('pageToken', pageToken)
      const page = await gmailFetch<{ history?: HistoryRecord[]; historyId: string; nextPageToken?: string }>(
        account,
        `/history?${params}`,
      )
      history.push(...(page.history ?? []))
      pageToken = page.nextPageToken
      if (!pageToken) return { history, historyId: page.historyId }
    }
  } catch (err) {
    if (isNotFound(err)) return 'expired'
    throw err
  }
}

export interface OpenThread extends ThreadMail {
  url: string
  account: string
  labelIds: string[]
}

export async function getOpenThread(account: string, threadId: string, signal?: AbortSignal): Promise<OpenThread> {
  const thread = await gmailFetch<GmailThread>(account, `/threads/${threadId}?format=full`, { signal })
  return {
    ...threadToMail(thread, await fetchInlineData(account, thread, signal)),
    url: threadUrl(account, threadId),
    account,
    labelIds: labelsOf(thread),
  }
}

export async function modifyThreads(account: string, ids: string[], add: string[], remove: string[]): Promise<void> {
  await mapLimit(ids, 4, (id) =>
    gmailFetch(account, `/threads/${id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    }),
  )
}

export async function trashThreads(account: string, ids: string[]): Promise<void> {
  await mapLimit(ids, 4, (id) => gmailFetch(account, `/threads/${id}/trash`, { method: 'POST' }))
}

export async function untrashThreads(account: string, ids: string[]): Promise<void> {
  await mapLimit(ids, 4, (id) => gmailFetch(account, `/threads/${id}/untrash`, { method: 'POST' }))
}
