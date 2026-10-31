import { CATEGORY_LABEL, type Category } from '@/lib/mail/folders'

export interface MailSearch {
  // An address, or 'all'.
  account: string
  // A SystemFolder or a label id.
  folder: string
  cat?: Category
  q?: string
  unread?: boolean
  // A threadUrl().
  thread?: string
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined)

export function validateMailSearch(raw: Record<string, unknown>): MailSearch {
  const folder = str(raw.folder) ?? 'INBOX'
  const cat = str(raw.cat) as Category | undefined
  const validCat = cat && cat in CATEGORY_LABEL ? cat : undefined
  const out: MailSearch = {
    account: str(raw.account) ?? 'all',
    folder,
    // Categories only exist inside the inbox; a missing one means Primary.
    cat: folder === 'INBOX' ? (validCat ?? 'primary') : undefined,
  }
  const q = str(raw.q)
  if (q) out.q = q
  if (raw.unread === true || raw.unread === 'true') out.unread = true
  const thread = str(raw.thread)
  if (thread) out.thread = thread
  return out
}
