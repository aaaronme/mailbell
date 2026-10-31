import type { Category } from './folders'

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
