import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { parseThreadUrl } from '@/lib/api/gmail'
import { removesFromFolder, type ActionTarget, type MailAction } from '@/lib/mail/actions'
import { useOpenThread, useThreadList } from '@/lib/mail/queries'
import { runUndoable } from '@/lib/mail/undo'

const route = getRouteApi('/mail')

// What the reading pane's buttons and the keyboard both act on: the checked
// threads when there are any, else the open one.
export function useMailActions({
  checked,
  onCheckedChange,
  keepUnread,
}: {
  checked: Set<string>
  onCheckedChange: (next: Set<string>) => void
  keepUnread: () => void
}) {
  const search = route.useSearch()
  const { thread: url, folder } = search
  const navigate = useNavigate({ from: '/mail' })
  const router = useRouter()
  const { rows } = useThreadList(search)
  const open = useOpenThread(url)
  const parsed = url ? parseThreadUrl(url) : null

  const here: ActionTarget[] = url && parsed ? [{ ...parsed, url }] : []
  const picked = rows.filter((it) => checked.has(it.url))
  const targets: ActionTarget[] = picked.length
    ? picked.map((it) => ({ account: it.account, threadId: it.threadId, url: it.url }))
    : here
  // What each of the targets currently has.
  const labelIds: string[][] = picked.length ? picked.map((it) => it.labelIds) : [open.data?.labelIds ?? []]
  const everyHas = (id: string) => labelIds.every((it) => it.includes(id))
  const starred = everyHas('STARRED')

  // The next row after the open one leaves, by the list as it was before.
  const advance = (from: string, gone: Set<string>) => {
    const at = rows.findIndex((it) => it.url === from)
    const stays = (it: { url: string }) => !gone.has(it.url)
    const next = rows.slice(at + 1).find(stays) ?? rows.slice(0, Math.max(at, 0)).findLast(stays)
    void navigate({ search: (prev) => ({ ...prev, thread: next?.url }) })
  }

  const run = async (action: MailAction) => {
    if (!targets.length) return
    if (action.kind === 'unread' && targets.some((it) => it.url === url)) keepUnread()
    const ok = await runUndoable(action, targets)
    if (!ok || !removesFromFolder(action, folder)) return
    if (picked.length) onCheckedChange(new Set())
    const gone = new Set(targets.map((it) => it.url))
    // Only while the acted-on thread is still the open one.
    if (url && gone.has(url) && router.state.location.search.thread === url) advance(url, gone)
  }

  return {
    run,
    targets,
    everyHas,
    starred,
    archive: () => run({ kind: 'archive' }),
    trash: () => run({ kind: folder === 'TRASH' ? 'restore' : 'trash' }),
    spam: () => run({ kind: folder === 'SPAM' ? 'notSpam' : 'spam' }),
    toggleStar: () => run({ kind: starred ? 'unstar' : 'star' }),
  }
}

export type MailActions = ReturnType<typeof useMailActions>
