import {
  fetchInlineData,
  gmailFetch,
  header,
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

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

// Gmail's snippet is HTML-escaped text. Decoded in one pass, so "&amp;lt;"
// stays "&lt;"; never through the DOM.
export function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (whole, dec, hex, name) => {
    const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : undefined
    if (code === undefined) return NAMED_ENTITIES[String(name).toLowerCase()] ?? whole
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
  return {
    url: threadUrl(account, thread.id),
    account,
    threadId: thread.id,
    subject: header(first.payload, 'Subject') ?? '',
    snippet: decodeEntities(last.snippet ?? thread.snippet ?? ''),
    from: parseMailbox(header(last.payload, 'From') ?? ''),
    to: parseAddressField(header(last.payload, 'To') ?? ''),
    date: new Date(Number(last.internalDate)).toISOString(),
    labelIds: labelsOf(thread),
    messageCount: thread.messages.length,
    // Metadata format has no parts; a mixed top level is how attachments show.
    hasAttachment: thread.messages.some((it) =>
      header(it.payload, 'Content-Type')?.toLowerCase().startsWith('multipart/mixed'),
    ),
    authResults: header(last.payload, 'Authentication-Results'),
  }
}

export async function listThreadPage(
  account: string,
  query: ReturnType<typeof listQuery>,
  pageToken?: string,
): Promise<{ rows: ThreadRow[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ maxResults: '50' })
  query.labelIds.forEach((it) => params.append('labelIds', it))
  if (query.q) params.set('q', query.q)
  if (query.includeSpamTrash) params.set('includeSpamTrash', 'true')
  if (pageToken) params.set('pageToken', pageToken)
  const list = await gmailFetch<{ threads?: { id: string }[]; nextPageToken?: string }>(
    account,
    `/threads?${params}`,
  )
  const meta = ROW_HEADERS.map((it) => `metadataHeaders=${it}`).join('&')
  const rows = await mapLimit(list.threads ?? [], 4, async ({ id }) =>
    threadToRow(account, await gmailFetch<GmailThread>(account, `/threads/${id}?format=metadata&${meta}`)),
  )
  return { rows, nextPageToken: list.nextPageToken }
}

export interface OpenThread extends ThreadMail {
  url: string
  account: string
  labelIds: string[]
}

export async function getOpenThread(account: string, threadId: string): Promise<OpenThread> {
  const thread = await gmailFetch<GmailThread>(account, `/threads/${threadId}?format=full`)
  return {
    ...threadToMail(thread, await fetchInlineData(account, thread)),
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
