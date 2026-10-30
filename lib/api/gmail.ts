import { parse } from 'parse5'
import { decodeHTML, escapeUTF8 } from 'entities'
import {
  getAttribute,
  getInnerHTML,
  getParentElement,
  getTextContent,
  querySelector,
  querySelectorAll,
  setAttribute,
} from '../domutils'
import { debugLog } from '../debugLog'
import { liftBackgroundImages } from '../emailBackground'
import { getAccessToken, getAccounts } from '../auth/oauth'
import { buildReply, toBase64Url, type Recipients } from '../reply'

export interface Feed {
  title: string
  summary: string
  // Identifies the thread everywhere (popup routes, actions, notifications):
  // a real Gmail link that also carries the account and thread id, see
  // threadUrl().
  url: string
  modified: string
  author: {
    name: string
    email: string
  }
  // The newest message's Gmail labels (IMPORTANT, CATEGORY_*), for the
  // notification filter. Absent on threads cached before it existed.
  labels?: string[]
}

export interface RSSInfo {
  email: string
  feeds: Feed[]
}

export interface Attachment {
  fileName: string
  mimeType: string
  size: number
  messageId: string
  attachmentId: string
}

interface Message {
  senderName: string // Sender name
  senderEmail: string // Sender email
  time: string // Send time
  to: string[] // Recipients
  cc: string[] // CC recipients
  replyTo?: string // Reply-to address
  contentHtml: string // Email body (HTML)
  contentText?: string // Email body (plain text, optional)
  attachments?: Attachment[] // Attachments (if any)
}

// Bumped whenever the ThreadMail produced from a thread changes in a way that
// makes an already-built one wrong: contentHtml carries decisions made at
// extraction time (the dark-mode background-image marker), so HTML produced by
// another version can render wrong even though the mail itself is unchanged.
// Stamped onto every ThreadMail; StateManager.fetchThreads drops threads from
// another version, and the thread cache below ignores them.
//
// Version 2: built from the Gmail API's MIME parts instead of the print view.
export const CURRENT_EXTRACT_VERSION = 2

export interface ThreadMail {
  subject: string
  messageCount: number
  messages: Message[]
  // CSS extracted from the messages' <style> tags, applied to each message's shadow root
  styles: string[]
  // Which version built this, see CURRENT_EXTRACT_VERSION.
  extractVersion: number
}

// --- Thread URLs -----------------------------------------------------------

// authuser picks the account in Gmail's web UI by address, so the link opens
// the right mailbox no matter in which order the user signed in there.
export function threadUrl(account: string, threadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#inbox/${threadId}`
}

export function parseThreadUrl(url: string): { account: string; threadId: string } | null {
  try {
    const u = new URL(url)
    const account = u.searchParams.get('authuser')
    const threadId = u.hash.split('/')[1]
    return account && threadId ? { account, threadId } : null
  } catch {
    return null
  }
}

function requireThread(url: string) {
  const info = parseThreadUrl(url)
  if (!info) throw new Error('not a thread url: ' + url)
  return info
}

export function inboxUrl(account: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#inbox`
}

export function composeUrl(account: string, params: Record<string, string> = {}): string {
  return `https://mail.google.com/mail/?${new URLSearchParams({ authuser: account, view: 'cm', fs: '1', ...params })}`
}

// --- REST client -----------------------------------------------------------

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

class GmailApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function gmailFetch<T>(account: string, path: string, init: RequestInit = {}): Promise<T> {
  const send = async (token: string) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  const token = await getAccessToken(account)
  let resp = await send(token)
  // The token can be revoked or expire early. A parallel request may already
  // have refreshed it; only force a refresh if the stored one is unchanged.
  if (resp.status === 401) {
    const stored = await getAccessToken(account)
    resp = await send(stored !== token ? stored : await getAccessToken(account, true))
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new GmailApiError(resp.status, `gmail ${init.method ?? 'GET'} ${path}: ${resp.status} ${text.slice(0, 200)}`)
  }
  return (resp.status === 204 ? undefined : await resp.json()) as T
}

// Runs fn over items with at most `limit` in flight; Gmail's per-user quota
// trips on a burst of 50 parallel thread fetches.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// --- Gmail API shapes (only the fields used) --------------------------------

interface GmailHeader {
  name: string
  value: string
}

export interface GmailPart {
  partId?: string
  mimeType: string
  filename?: string
  headers?: GmailHeader[]
  body?: { size: number; data?: string; attachmentId?: string }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate: string
  payload: GmailPart
}

export interface GmailThread {
  id: string
  historyId: string
  snippet?: string
  messages: GmailMessage[]
}

// --- MIME -> ThreadMail ------------------------------------------------------

function header(part: GmailPart, name: string): string | undefined {
  const lower = name.toLowerCase()
  return part.headers?.find((h) => h.name.toLowerCase() === lower)?.value
}

// The API's base64url, as the standard alphabet atob and data: URIs take.
const toBase64 = (data: string) => data.replace(/-/g, '+').replace(/_/g, '/')
const base64UrlToBytes = (data: string) => Uint8Array.from(atob(toBase64(data)), (c) => c.charCodeAt(0))

export function decodeBase64Url(data: string, charset = 'utf-8'): string {
  const bytes = base64UrlToBytes(data)
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    // Unknown charset label.
    return new TextDecoder().decode(bytes)
  }
}

function charsetOf(part: GmailPart): string {
  return header(part, 'Content-Type')?.match(/charset="?([^";\s]+)/i)?.[1] ?? 'utf-8'
}

function walk(part: GmailPart, visit: (part: GmailPart) => void) {
  visit(part)
  part.parts?.forEach((it) => walk(it, visit))
}

// "Name" <a@b.c> -> { name, email }; a bare address names itself.
export function parseMailbox(value: string): { name: string; email: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) {
    const email = m[2]!.trim()
    return { name: m[1]!.trim() || email, email }
  }
  const email = value.trim()
  return { name: email, email }
}

// An address header (To, Cc) as display strings: "Name <a@b.c>", or the bare
// address when there's no name worth showing. Splits only on commas outside
// quotes and angle brackets - "Doe, Jane" <j@x.com> is one recipient.
export function parseAddressField(value: string): string[] {
  const items: string[] = []
  let current = ''
  let quoted = false
  let angled = false
  for (const c of value) {
    if (c === '"') quoted = !quoted
    else if (c === '<' && !quoted) angled = true
    else if (c === '>' && !quoted) angled = false
    if (c === ',' && !quoted && !angled) {
      items.push(current)
      current = ''
    } else {
      current += c
    }
  }
  items.push(current)
  return items
    .filter((it) => it.trim())
    .map((it) => {
      const { name, email } = parseMailbox(it)
      return name === email ? email : `${name} <${email}>`
    })
}

function plainTextToHtml(text: string): string {
  return `<pre style="white-space: pre-wrap; font-family: inherit; margin: 0">${escapeUTF8(text)}</pre>`
}

// The body's markup without its document wrapper, the <style> sheets it
// carried, and its visible text.
function prepareHtml(html: string): { contentHtml: string; contentText: string; styles: string[] } {
  const doc = parse(html)
  const styles = querySelectorAll('style', doc)
    .map((style) => getTextContent(style)?.trim() || '')
    .filter(Boolean)
  const body = querySelector('body', doc)!
  querySelectorAll('style, script', body).forEach((node) => {
    const parent = getParentElement(node)
    if (parent) parent.childNodes = parent.childNodes.filter((it) => it !== node)
  })
  // Background images are painted by the element itself, so the only way
  // the dark-mode filter can reach them is to mark the element and render
  // it whole - see liftBackgroundImages.
  liftBackgroundImages(body)
  querySelectorAll('img[src]', body).forEach((img) => {
    if (getAttribute(img, 'height') === '1' && getAttribute(img, 'width') === '1') {
      return
    }
    const container = getParentElement(img)
    if (container) {
      setAttribute(container, 'style', (getAttribute(container, 'style') ?? '') + '; overflow-x: auto;')
    }
  })
  return {
    contentHtml: getInnerHTML(body)?.trim() ?? '',
    contentText: getTextContent(body)?.replace(/\s+/g, ' ').trim() ?? '',
    styles,
  }
}

// What a message needs fetched separately: inline images (cid:) whose bytes
// live behind an attachmentId.
interface InlineImage {
  contentId: string
  mimeType: string
  size: number
  attachmentId?: string
  data?: string
}

export function messageToMail(
  msg: GmailMessage,
  inlineData: Map<string, string> = new Map(),
): { message: Message; styles: string[] } {
  let html: GmailPart | undefined
  let text: GmailPart | undefined
  const attachments: Attachment[] = []
  walk(msg.payload, (part) => {
    const isAttachment = !!part.filename && (part.body?.attachmentId || part.body?.data)
    if (isAttachment) {
      // Inline images are shown in the body, not listed.
      if (!header(part, 'Content-ID') && part.body?.attachmentId) {
        attachments.push({
          fileName: part.filename!,
          mimeType: part.mimeType,
          size: part.body.size,
          messageId: msg.id,
          attachmentId: part.body.attachmentId,
        })
      }
      return
    }
    if (part.mimeType === 'text/html' && !html && part.body?.data) html = part
    if (part.mimeType === 'text/plain' && !text && part.body?.data) text = part
  })
  const decode = (part: GmailPart) => decodeBase64Url(part.body!.data!, charsetOf(part))
  let body: { contentHtml: string; contentText: string; styles: string[] }
  if (html) {
    let source = decode(html)
    for (const [cid, dataUri] of inlineData) {
      source = source.replaceAll(`cid:${cid}`, dataUri)
    }
    body = prepareHtml(source)
    if (text) body.contentText = decode(text).trim()
  } else if (text) {
    const plain = decode(text)
    body = { contentHtml: plainTextToHtml(plain), contentText: plain.trim(), styles: [] }
  } else {
    body = { contentHtml: '', contentText: decodeHTML(msg.snippet ?? ''), styles: [] }
  }
  const from = parseMailbox(header(msg.payload, 'From') ?? '')
  const message: Message = {
    senderName: from.name,
    senderEmail: from.email,
    time: new Date(Number(msg.internalDate)).toISOString(),
    to: parseAddressField(header(msg.payload, 'To') ?? ''),
    cc: parseAddressField(header(msg.payload, 'Cc') ?? ''),
    replyTo: header(msg.payload, 'Reply-To'),
    contentHtml: body.contentHtml,
    contentText: body.contentText,
  }
  if (attachments.length) message.attachments = attachments
  return { message, styles: body.styles }
}

function inlineImagesOf(msg: GmailMessage): InlineImage[] {
  const images: InlineImage[] = []
  walk(msg.payload, (part) => {
    const contentId = header(part, 'Content-ID')?.replace(/^<|>$/g, '')
    if (contentId && part.mimeType.startsWith('image/')) {
      images.push({
        contentId,
        mimeType: part.mimeType,
        size: part.body?.size ?? 0,
        attachmentId: part.body?.attachmentId,
        data: part.body?.data,
      })
    }
  })
  return images
}

// Drafts are part of a thread in the API but never of the conversation shown.
function visibleMessages(thread: GmailThread): GmailMessage[] {
  const messages = thread.messages.filter((it) => !it.labelIds?.includes('DRAFT'))
  return messages.length ? messages : thread.messages
}

export function threadToFeed(account: string, thread: GmailThread): Feed {
  const messages = visibleMessages(thread)
  const first = messages[0]!
  const last = messages.at(-1)!
  return {
    title: header(first.payload, 'Subject') ?? '',
    summary: decodeHTML(last.snippet ?? thread.snippet ?? ''),
    url: threadUrl(account, thread.id),
    modified: new Date(Number(last.internalDate)).toISOString(),
    author: parseMailbox(header(last.payload, 'From') ?? ''),
    labels: last.labelIds ?? [],
  }
}

export function threadToMail(thread: GmailThread, inlineData: Map<string, string> = new Map()): ThreadMail {
  const messages = visibleMessages(thread)
  const built = messages.map((msg) => messageToMail(msg, inlineData))
  return {
    subject: header(messages[0]!.payload, 'Subject') ?? '',
    messageCount: messages.length,
    messages: built.map((it) => it.message),
    styles: [...new Set(built.flatMap((it) => it.styles))],
    extractVersion: CURRENT_EXTRACT_VERSION,
  }
}

// Inline images bigger than this stay broken rather than bloat storage (and
// aren't downloaded at all).
const MAX_INLINE_IMAGE_BYTES = 1_000_000

async function fetchInlineData(account: string, thread: GmailThread): Promise<Map<string, string>> {
  const data = new Map<string, string>()
  for (const msg of visibleMessages(thread)) {
    for (const image of inlineImagesOf(msg)) {
      if (image.size > MAX_INLINE_IMAGE_BYTES) continue
      let b64 = image.data
      if (!b64 && image.attachmentId) {
        const att = await gmailFetch<{ data: string }>(
          account,
          `/messages/${msg.id}/attachments/${image.attachmentId}`,
        ).catch((err) => {
          void debugLog('inline image failed ->', image.contentId, err)
          return null
        })
        if (!att) continue
        b64 = att.data
      }
      if (b64) {
        data.set(image.contentId, `data:${image.mimeType};base64,${toBase64(b64)}`)
      }
    }
  }
  return data
}

// --- Polling ---------------------------------------------------------------

interface CachedThread {
  historyId: string
  feed: Feed
  mail: ThreadMail
}

interface InboxCache {
  // The mailbox's historyId when this was built: unchanged means nothing in
  // the mailbox changed, so the poll needs no further requests.
  historyId: string
  threads: Record<string, CachedThread>
  order: string[]
}

// Persisted because the background is suspended between polls: an in-memory
// cache would be empty on nearly every wake-up and re-download the inbox.
const inboxCacheKey = (account: string) => `inbox:${account}`

// Mirrored in memory for the life of the background: a fresh one reads each
// account's cache once instead of once per thread it builds.
const inboxCaches = new Map<string, InboxCache>()

async function readInboxCache(account: string): Promise<InboxCache | null> {
  const memo = inboxCaches.get(account)
  if (memo) return memo
  const key = inboxCacheKey(account)
  const { [key]: cache } = await browser.storage.local.get<Record<string, InboxCache>>(key)
  if (cache) inboxCaches.set(account, cache)
  return cache ?? null
}

async function writeInboxCache(account: string, cache: InboxCache) {
  // A poll still in flight when its account was removed must not bring the
  // cache back.
  if (!(await getAccounts()).some((it) => it.email === account)) return
  inboxCaches.set(account, cache)
  await browser.storage.local.set({ [inboxCacheKey(account)]: cache })
}

export async function clearInboxCache(account: string) {
  inboxCaches.delete(account)
  await browser.storage.local.remove(inboxCacheKey(account))
}

const MAX_THREADS = 50

async function fetchThread(account: string, id: string): Promise<GmailThread> {
  return gmailFetch<GmailThread>(account, `/threads/${id}?format=full`)
}

async function buildCachedThread(account: string, thread: GmailThread): Promise<CachedThread> {
  return {
    historyId: thread.historyId,
    feed: threadToFeed(account, thread),
    mail: threadToMail(thread, await fetchInlineData(account, thread)),
  }
}

async function getInbox(account: string): Promise<RSSInfo> {
  const profile = await gmailFetch<{ historyId: string }>(account, '/profile')
  const cache = await readInboxCache(account)
  const cacheUsable = cache?.order.every((id) => cache.threads[id]?.mail.extractVersion === CURRENT_EXTRACT_VERSION)
  if (cache && cacheUsable && cache.historyId === profile.historyId) {
    return { email: account, feeds: cache.order.map((id) => cache.threads[id]!.feed) }
  }
  const list = await gmailFetch<{ threads?: { id: string; historyId: string }[] }>(
    account,
    `/threads?labelIds=INBOX&labelIds=UNREAD&maxResults=${MAX_THREADS}`,
  )
  const listed = list.threads ?? []
  const entries = await mapLimit(listed, 5, async ({ id, historyId }) => {
    const cached = cache?.threads[id]
    if (cached && cached.historyId === historyId && cached.mail.extractVersion === CURRENT_EXTRACT_VERSION) {
      return [id, cached] as const
    }
    return [id, await buildCachedThread(account, await fetchThread(account, id))] as const
  })
  const next: InboxCache = {
    historyId: profile.historyId,
    threads: Object.fromEntries(entries),
    order: listed.map((it) => it.id),
  }
  await writeInboxCache(account, next)
  return { email: account, feeds: next.order.map((id) => next.threads[id]!.feed) }
}

export async function checkLoginStatus(): Promise<boolean> {
  return (await getAccounts()).some((it) => !it.needsReauth)
}

// Every signed-in account's unread inbox, in the order they were added.
// Promise.all, not allSettled: any account failing aborts the whole poll and
// leaves the previous state untouched, rather than treating it as gone. An
// account waiting for a fresh sign-in is left out instead - its mail can't be
// read until then.
export async function getAllRSS(): Promise<RSSInfo[]> {
  const accounts = (await getAccounts()).filter((it) => !it.needsReauth)
  if (accounts.length === 0) {
    throw new Error('getAllRSS: no signed-in account')
  }
  return Promise.all(accounts.map((it) => getInbox(it.email)))
}

export async function getThreadMail(url: string): Promise<ThreadMail> {
  const { account, threadId } = requireThread(url)
  const cached = (await readInboxCache(account))?.threads[threadId]
  if (cached?.mail.extractVersion === CURRENT_EXTRACT_VERSION) {
    return cached.mail
  }
  return (await buildCachedThread(account, await fetchThread(account, threadId))).mail
}

// --- Actions ---------------------------------------------------------------

async function modifyLabels(url: string, add: string[], remove: string[]) {
  const { account, threadId } = requireThread(url)
  await gmailFetch(account, `/threads/${threadId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  })
}

export async function markAsRead(url: string) {
  await modifyLabels(url, [], ['UNREAD'])
}

export async function markAsUnread(url: string) {
  await modifyLabels(url, ['UNREAD'], [])
}

export async function archiveMail(url: string) {
  await modifyLabels(url, [], ['INBOX'])
}

export async function markAsSpam(url: string) {
  await modifyLabels(url, ['SPAM'], ['INBOX'])
}

// Moves to Trash (recoverable for 30 days), like Gmail's delete button.
export async function deleteMail(url: string) {
  const { account, threadId } = requireThread(url)
  await gmailFetch(account, `/threads/${threadId}/trash`, { method: 'POST' })
}

// The newest message's headers as an RFC 822 header block, which is all
// planUnsubscribe reads from the raw source.
export async function getRawMessage(url: string): Promise<string> {
  const { account, threadId } = requireThread(url)
  const thread = await gmailFetch<GmailThread>(
    account,
    `/threads/${threadId}?format=metadata&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post`,
  )
  const last = visibleMessages(thread).at(-1)
  return (last?.payload.headers ?? []).map((h) => `${h.name}: ${h.value}`).join('\r\n') + '\r\n\r\n'
}

// Sends a plain-text reply into the thread. Subject and the threading
// headers come from Gmail, fresh, rather than from the cached mail.
export async function sendReply(url: string, recipients: Recipients, text: string) {
  const { account, threadId } = requireThread(url)
  const thread = await gmailFetch<GmailThread>(
    account,
    `/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`,
  )
  const last = visibleMessages(thread).at(-1)!.payload
  const messageId = header(last, 'Message-ID')
  const raw = buildReply({
    recipients,
    subject: header(last, 'Subject') ?? '',
    inReplyTo: messageId,
    references: [header(last, 'References'), messageId].filter(Boolean).join(' ') || undefined,
    text,
  })
  await gmailFetch(account, '/messages/send', { method: 'POST', body: JSON.stringify({ raw: toBase64Url(raw), threadId }) })
}

export async function getAttachmentBlob(account: string, attachment: Attachment): Promise<Blob> {
  const { data } = await gmailFetch<{ data: string }>(
    account,
    `/messages/${attachment.messageId}/attachments/${attachment.attachmentId}`,
  )
  return new Blob([base64UrlToBytes(data)], { type: attachment.mimeType })
}

// --- Opening Gmail ---------------------------------------------------------

// Thread and inbox urls are already Gmail links.
export async function openMailInWeb(url: string) {
  await browser.tabs.create({ url })
}

// The first account's inbox - the one the user added first.
export async function getActiveInboxUrl() {
  const [account] = await getAccounts()
  return account ? inboxUrl(account.email) : 'https://mail.google.com/mail/'
}

export async function newEmail() {
  const [account] = await getAccounts()
  const currentWindow = await browser.windows.getCurrent()
  const windowWidth = 800
  const windowHeight = 600
  let top = 0
  if (currentWindow.height) {
    top = Math.floor((currentWindow.height - windowHeight) / 2)
  }
  let left = 0
  if (currentWindow.width) {
    left = Math.floor((currentWindow.width - windowWidth) / 2)
  }

  await browser.windows.create({
    url: account ? composeUrl(account.email) : 'https://mail.google.com/mail/?view=cm&fs=1',
    type: 'popup',
    width: windowWidth,
    height: windowHeight,
    left,
    top,
    focused: true,
  })
}
