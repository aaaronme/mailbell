import { useEffect } from 'react'
import { getRouteApi } from '@tanstack/react-router'
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
import { ThreadView, type ReplyHandle } from '@/components/mail/ThreadView'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { openMailInWeb, parseThreadUrl } from '@/lib/api/gmail'
import { useLabels, useOpenThread } from '@/lib/mail/queries'
import type { MailActions } from './useMailActions'

export type LabelMenu = 'label' | 'move' | null

const route = getRouteApi('/mail')

const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'])

export function ReadingPane({
  actions,
  engage,
  labelMenu,
  onLabelMenuChange,
  replyRef,
  scrollRef,
}: {
  actions: MailActions
  engage: () => void
  labelMenu: LabelMenu
  onLabelMenuChange: (next: LabelMenu) => void
  replyRef: React.Ref<ReplyHandle>
  scrollRef: React.Ref<HTMLDivElement>
}) {
  const { thread: url, folder } = route.useSearch()
  const open = useOpenThread(url)
  const parsed = url ? parseThreadUrl(url) : null
  const { run, targets, everyHas, starred } = actions
  const labels = useLabels(targets[0]?.account ?? '').data

  const userLabels = (labels ?? []).filter((it) => it.type === 'user').sort((a, b) => a.name.localeCompare(b.name))
  const oneAccount = new Set(targets.map((it) => it.account)).size === 1
  const canMove = oneAccount && (folder === 'INBOX' || userLabels.some((it) => it.id === folder))
  // The keyboard can ask for a menu whose button is disabled; it stays shut.
  const menuOk = labelMenu === 'label' ? oneAccount : labelMenu === 'move' ? canMove : true
  useEffect(() => {
    if (!menuOk) onLabelMenuChange(null)
  }, [menuOk, onLabelMenuChange])

  if (!url || !parsed) {
    return (
      <div data-testid="reading-pane" className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-foreground/40">No conversation selected</p>
      </div>
    )
  }

  return (
    <div data-testid="reading-pane" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-foreground/10 px-2">
        <BarButton title="Archive (e)" icon={ArchiveIcon} onClick={() => void actions.archive()} />
        {folder === 'TRASH' ? (
          <BarButton title="Restore" icon={ArchiveRestoreIcon} onClick={() => void actions.trash()} />
        ) : (
          <BarButton title="Delete (#)" icon={Trash2Icon} onClick={() => void actions.trash()} />
        )}
        {folder === 'SPAM' ? (
          <BarButton title="Not spam" icon={InboxIcon} onClick={() => void actions.spam()} />
        ) : (
          <BarButton title="Spam (!)" icon={OctagonAlertIcon} onClick={() => void actions.spam()} />
        )}
        <BarButton title="Mark unread (Shift+U)" icon={MailIcon} onClick={() => void run({ kind: 'unread' })} />
        <BarButton
          title={starred ? 'Unstar (s)' : 'Star (s)'}
          icon={StarIcon}
          onClick={() => void actions.toggleStar()}
        />
        <DropdownMenu open={labelMenu === 'label' && oneAccount} onOpenChange={(on) => onLabelMenuChange(on ? 'label' : null)}>
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
        <DropdownMenu open={labelMenu === 'move' && canMove} onOpenChange={(on) => onLabelMenuChange(on ? 'move' : null)}>
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
      {/* Keyed by thread: each one starts at the top with its own collapse
          state. Only the reader's own input engages; a scroll event alone
          also fires when a shorter thread clamps the position. */}
      <div
        key={url}
        ref={scrollRef}
        tabIndex={-1}
        data-testid="reading-scroll"
        className="min-h-0 flex-1 overflow-y-auto outline-none"
        onWheel={engage}
        onPointerDown={engage}
        onKeyDown={(e) => SCROLL_KEYS.has(e.key) && engage()}
      >
        {open.data ? (
          <ThreadView thread={open.data} onEngage={engage} replyRef={replyRef} shortcuts={false} />
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
