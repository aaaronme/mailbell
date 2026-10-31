import { CATEGORY_LABEL, type Category } from '@/lib/mail/folders'
import type { MailSearch } from '@/lib/mail/search'

export type { MailSearch }

// The router JSON-parses search values, so a pasted `?q=2024` arrives as a number.
const str = (v: unknown) => {
  if (typeof v === 'number') return String(v)
  return typeof v === 'string' && v !== '' ? v : undefined
}

export function validateMailSearch(raw: Record<string, unknown>): MailSearch {
  const folder = str(raw.folder) ?? 'INBOX'
  const cat = str(raw.cat)
  const validCat = cat && Object.hasOwn(CATEGORY_LABEL, cat) ? (cat as Category) : undefined
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
