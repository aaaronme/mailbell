import { useMemo } from 'react'
import dayjs from 'dayjs'
import { PaperclipIcon, StarIcon, TriangleAlertIcon } from 'lucide-react'
import type { ThreadRow } from '@/lib/api/mailbox'
import { senderIdentity } from '@/lib/mail/identity'
import { suspicionOf } from '@/lib/mail/suspicion'
import { runUndoable } from '@/lib/mail/undo'
import { extractCode } from '@/lib/otp'
import { cn } from '@/lib/utils'

// Today as a time, this week as a weekday, otherwise day and month.
function rowDate(iso: string): string {
  const date = dayjs(iso)
  const days = dayjs().startOf('day').diff(date.startOf('day'), 'day')
  if (days <= 0) return date.format('HH:mm')
  return date.format(days < 7 ? 'ddd' : 'D MMM')
}

export function ThreadListRow({
  row,
  selected,
  checked,
  anyChecked,
  showAccount,
  folder,
  knownDomains,
  onSelect,
  onCheck,
}: {
  row: ThreadRow
  selected: boolean
  checked: boolean
  // Keeps every checkbox visible once a selection has started.
  anyChecked?: boolean
  showAccount: boolean
  folder: string
  knownDomains: Set<string>
  onSelect(): void
  onCheck(shift: boolean): void
}) {
  const unread = row.labelIds.includes('UNREAD')
  const starred = row.labelIds.includes('STARRED')
  const sentView = folder === 'SENT' || folder === 'DRAFT'

  const suspicious = useMemo(
    () =>
      suspicionOf({
        labelIds: row.labelIds,
        identity: senderIdentity(
          row.authResults ? [{ name: 'Authentication-Results', value: row.authResults }] : [],
          row.from.email,
        ),
        senderName: row.from.name,
        senderEmail: row.from.email,
        knownDomains,
      }).length > 0,
    [row, knownDomains],
  )
  const code = suspicious ? null : extractCode(row.subject, row.snippet)

  return (
    <div
      data-row={row.threadId}
      onClick={onSelect}
      className={cn(
        'group flex cursor-pointer items-start gap-2 border-b border-foreground/10 px-3 py-2 text-sm transition-colors hover:bg-foreground/5',
        selected && 'bg-foreground/10',
      )}
    >
      <div className="flex w-4 shrink-0 flex-col items-center gap-1 pt-0.5">
        <input
          type="checkbox"
          aria-label={`Select ${row.subject}`}
          checked={checked}
          onClick={(e) => {
            e.stopPropagation()
            onCheck(e.shiftKey)
          }}
          onChange={() => {}}
          className={cn(
            'size-4 cursor-pointer accent-foreground',
            !checked && !anyChecked && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
          )}
        />
        {unread && !checked && <span aria-label="Unread" className="size-1.5 rounded-full bg-foreground group-hover:hidden" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {showAccount && (
            <span
              title={row.account}
              className="grid size-4 shrink-0 place-items-center bg-foreground/10 text-[10px] leading-none uppercase"
            >
              {row.account[0]}
            </span>
          )}
          <span className={cn('min-w-0 flex-1 truncate', unread && 'font-medium')}>
            {sentView ? `To: ${row.to.join(', ')}` : row.from.name || row.from.email}
          </span>
          {suspicious && (
            <span data-suspicious title="Suspicious sender" className="shrink-0 text-foreground/70">
              <TriangleAlertIcon className="size-3.5" />
            </span>
          )}
          <span className="shrink-0 text-xs text-foreground/40 tabular-nums">{rowDate(row.date)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate', unread ? 'font-medium' : 'text-foreground/70')}>
            {row.subject}
          </span>
          {code && <span className="shrink-0 font-mono text-xs text-bell">{code}</span>}
          {row.hasAttachment && <PaperclipIcon aria-label="Has attachment" className="size-3.5 shrink-0 text-foreground/40" />}
          <button
            type="button"
            title={starred ? 'Unstar' : 'Star'}
            aria-label={starred ? 'Unstar' : 'Star'}
            onClick={(e) => {
              e.stopPropagation()
              void runUndoable({ kind: starred ? 'unstar' : 'star' }, [row])
            }}
            className="shrink-0 cursor-pointer text-foreground/40 transition-colors hover:text-foreground"
          >
            <StarIcon className={cn('size-3.5', starred && 'fill-current text-foreground')} />
          </button>
        </div>
        <div className="truncate text-xs text-foreground/50">{row.snippet}</div>
      </div>
    </div>
  )
}
