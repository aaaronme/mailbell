import { useEffect } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FolderInputIcon,
  InboxIcon,
  MailIcon,
  OctagonAlertIcon,
  StarIcon,
  TagIcon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react'
import { ThreadView } from '@/components/mail/ThreadView'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { openMailInWeb, parseThreadUrl } from '@/lib/api/gmail'
import { removesFromFolder, type ActionTarget, type MailAction } from '@/lib/mail/actions'
import { useMarkRead } from '@/lib/mail/markRead'
import { useLabels, useOpenThread, useThreadList } from '@/lib/mail/queries'
import { runUndoable } from '@/lib/mail/undo'
import { getSettings, isSettingsChange } from '@/lib/settings'

const route = getRouteApi('/mail')

const SETTINGS_KEY = ['settings']

// The bar acts on `targets`; `labelIds` is what each of them currently has.
interface Targets {
  targets: ActionTarget[]
  labelIds: string[][]
}

export function ReadingPane({
  checked,
  onCheckedChange,
}: {
  checked: Set<string>
  onCheckedChange: (next: Set<string>) => void
}) {
  const search = route.useSearch()
  const { thread: url, folder } = search
  const navigate = useNavigate({ from: '/mail' })
  const queryClient = useQueryClient()
  const { rows } = useThreadList(search)
  const open = useOpenThread(url)
  const parsed = url ? parseThreadUrl(url) : null
  const labels = useLabels(parsed?.account ?? '').data

  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings }).data
  useEffect(() => {
    // The popup's Settings page lives in another document.
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (isSettingsChange(changes, area)) void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY })
    }
    browser.storage.onChanged.addListener(onChanged)
    return () => browser.storage.onChanged.removeListener(onChanged)
  }, [queryClient])
  // Unknown until loaded: nothing is marked on a guess.
  const { engage } = useMarkRead(open.data, settings?.markRead ?? 'manual')

  if (!url || !parsed) {
    return (
      <div data-testid="reading-pane" className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-foreground/40">No conversation selected</p>
      </div>
    )
  }

  const here: ActionTarget = { ...parsed, url }
  const picked = rows.filter((it) => checked.has(it.url))
  const { targets, labelIds }: Targets = picked.length
    ? {
        targets: picked.map((it) => ({ account: it.account, threadId: it.threadId, url: it.url })),
        labelIds: picked.map((it) => it.labelIds),
      }
    : { targets: [here], labelIds: [open.data?.labelIds ?? []] }
  const everyHas = (id: string) => labelIds.every((it) => it.includes(id))

  // The next row after the open one leaves, by the list as it was before.
  const advance = (gone: Set<string>) => {
    const at = rows.findIndex((it) => it.url === url)
    const stays = (it: { url: string }) => !gone.has(it.url)
    const next = rows.slice(at + 1).find(stays) ?? rows.slice(0, Math.max(at, 0)).findLast(stays)
    void navigate({ search: (prev) => ({ ...prev, thread: next?.url }) })
  }

  const run = async (action: MailAction) => {
    const ok = await runUndoable(action, targets)
    if (!ok || !removesFromFolder(action, folder)) return
    if (picked.length) onCheckedChange(new Set())
    const gone = new Set(targets.map((it) => it.url))
    if (gone.has(url)) advance(gone)
  }

  const userLabels = (labels ?? []).filter((it) => it.type === 'user').sort((a, b) => a.name.localeCompare(b.name))
  const oneAccount = new Set(targets.map((it) => it.account)).size === 1
  const canMove = oneAccount && (folder === 'INBOX' || userLabels.some((it) => it.id === folder))
  const starred = everyHas('STARRED')

  return (
    <div data-testid="reading-pane" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-foreground/10 px-2">
        <BarButton title="Archive (e)" icon={ArchiveIcon} onClick={() => void run({ kind: 'archive' })} />
        {folder === 'TRASH' ? (
          <BarButton title="Restore" icon={ArchiveRestoreIcon} onClick={() => void run({ kind: 'restore' })} />
        ) : (
          <BarButton title="Delete (#)" icon={Trash2Icon} onClick={() => void run({ kind: 'trash' })} />
        )}
        {folder === 'SPAM' ? (
          <BarButton title="Not spam" icon={InboxIcon} onClick={() => void run({ kind: 'notSpam' })} />
        ) : (
          <BarButton title="Spam (!)" icon={OctagonAlertIcon} onClick={() => void run({ kind: 'spam' })} />
        )}
        <BarButton title="Mark unread (Shift+U)" icon={MailIcon} onClick={() => void run({ kind: 'unread' })} />
        <BarButton
          title={starred ? 'Unstar (s)' : 'Star (s)'}
          icon={StarIcon}
          onClick={() => void run({ kind: starred ? 'unstar' : 'star' })}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="Label as (l)" aria-label="Label as" disabled={!oneAccount}>
              <TagIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {userLabels.length === 0 && <p className="px-3 py-2 text-sm text-foreground/40">No labels</p>}
            {userLabels.map((it) => {
              const on = everyHas(it.id)
              return (
                <DropdownMenuItem
                  key={it.id}
                  onSelect={() => void run({ kind: on ? 'unlabel' : 'label', labelId: it.id, name: it.name })}
                >
                  <span className="size-4">{on && <CheckIcon />}</span>
                  {it.name}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="Move to (v)" aria-label="Move to" disabled={!canMove}>
              <FolderInputIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {[{ id: 'INBOX', name: 'Inbox' }, ...userLabels]
              .filter((it) => it.id !== folder)
              .map((it) => (
                <DropdownMenuItem
                  key={it.id}
                  onSelect={() => void run({ kind: 'move', labelId: it.id, name: it.name, from: folder })}
                >
                  {it.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="More" aria-label="More">
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => void openMailInWeb(url)}>
              <ExternalLinkIcon />
              Open in Gmail
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* The scroller engages on its own scroll too: ThreadView only hears
          scrolls of what it contains. */}
      <div data-testid="reading-scroll" className="min-h-0 flex-1 overflow-y-auto" onScroll={engage}>
        {open.data ? (
          <ThreadView thread={open.data} onEngage={engage} />
        ) : (
          <p className="px-4 py-6 text-sm text-foreground/40">
            {open.error ? "Couldn't load this conversation." : 'Loading'}
          </p>
        )}
      </div>
    </div>
  )
}

function BarButton({ title, icon: Icon, onClick }: { title: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" title={title} aria-label={title} onClick={onClick}>
      <Icon />
    </Button>
  )
}
