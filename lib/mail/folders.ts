import type { GmailLabel } from '../api/mailbox'

export type SystemFolder = 'INBOX' | 'STARRED' | 'SENT' | 'DRAFT' | 'ALL' | 'SPAM' | 'TRASH' | 'IMPORTANT'

export const SYSTEM_FOLDERS: { id: SystemFolder; name: string }[] = [
  { id: 'INBOX', name: 'Inbox' },
  { id: 'STARRED', name: 'Starred' },
  { id: 'SENT', name: 'Sent' },
  { id: 'DRAFT', name: 'Drafts' },
  { id: 'ALL', name: 'All mail' },
  { id: 'SPAM', name: 'Spam' },
  { id: 'TRASH', name: 'Trash' },
  { id: 'IMPORTANT', name: 'Important' },
]

export type Category = 'primary' | 'social' | 'promotions' | 'updates' | 'forums'

export const CATEGORY_LABEL: Record<Category, string> = {
  primary: 'CATEGORY_PERSONAL',
  social: 'CATEGORY_SOCIAL',
  promotions: 'CATEGORY_PROMOTIONS',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS',
}

// A search covers the whole account, so a query replaces the folder's labels
// instead of narrowing them.
export function listQuery(
  folder: string,
  opts: { category?: Category; q?: string; unread?: boolean },
): { labelIds: string[]; q?: string; includeSpamTrash: boolean } {
  if (opts.q) return { labelIds: [], q: opts.q, includeSpamTrash: false }
  const labelIds = folder === 'ALL' ? [] : [folder]
  if (folder === 'INBOX' && opts.category) labelIds.push(CATEGORY_LABEL[opts.category])
  if (opts.unread) labelIds.push('UNREAD')
  return { labelIds, includeSpamTrash: folder === 'SPAM' || folder === 'TRASH' }
}

export interface LabelNode {
  // '' for a parent that exists only as a prefix of its children's names.
  id: string
  name: string
  path: string
  children: LabelNode[]
  color?: { backgroundColor: string; textColor: string }
}

export function labelTree(labels: GmailLabel[]): LabelNode[] {
  const roots: LabelNode[] = []
  const byPath = new Map<string, LabelNode>()
  const node = (path: string): LabelNode => {
    let found = byPath.get(path)
    if (found) return found
    const slash = path.lastIndexOf('/')
    found = { id: '', name: path.slice(slash + 1), path, children: [] }
    byPath.set(path, found)
    ;(slash < 0 ? roots : node(path.slice(0, slash)).children).push(found)
    return found
  }
  for (const label of labels.filter((it) => it.type === 'user')) {
    const n = node(label.name)
    n.id = label.id
    if (label.color) n.color = label.color
  }
  const sort = (nodes: LabelNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    nodes.forEach((it) => sort(it.children))
  }
  sort(roots)
  return roots
}
