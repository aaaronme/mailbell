import type { listQuery, Category } from './folders'

// Every list key carries its folder at index 3; optimistic patching in
// actions.ts relies on that.
export const mailKeys = {
  labels: (account: string) => ['mail', 'labels', account] as const,
  list: (account: string, folder: string, query: ReturnType<typeof listQuery>) =>
    ['mail', 'list', account, folder, query] as const,
  all: (cat: Category | undefined, unread: boolean | undefined, q: string | undefined) =>
    ['mail', 'list', 'all', 'INBOX', { cat, unread, q }] as const,
  thread: (account: string, threadId: string) => ['mail', 'thread', account, threadId] as const,
}
