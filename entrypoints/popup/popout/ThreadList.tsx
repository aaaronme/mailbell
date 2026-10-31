import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  InboxIcon,
  MailCheckIcon,
  MailIcon,
  OctagonAlertIcon,
  Trash2Icon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { PageTitle } from '@/components/extra/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ThreadRow } from '@/lib/api/mailbox'
import { CATEGORY_LABEL, SYSTEM_FOLDERS, type Category } from '@/lib/mail/folders'
import { registrableDomain } from '@/lib/mail/identity'
import { useQueries } from '@tanstack/react-query'
import { correspondentsOptions } from '@/lib/mail/correspondents'
import { useAccounts } from '@/lib/useAccounts'
import { useLabels, useThreadList } from '@/lib/mail/queries'
import { cn } from '@/lib/utils'
import { ThreadListRow } from './ThreadListRow'
import type { MailActions } from './useMailActions'

const route = getRouteApi('/mail')

const NO_DOMAINS = new Set<string>()

const CATEGORY_NAME: Record<Category, string> = {
  primary: 'Primary',
  social: 'Social',
  promotions: 'Promotions',
  updates: 'Updates',
  forums: 'Forums',
}
const OPTIONAL_CATEGORIES = (['social', 'promotions', 'updates', 'forums'] as const)

// The same folder-aware actions as the reading pane and the keys; they act
// on the checked threads whenever there are any.
function bulkButtons(actions: MailActions, folder: string): { label: string; icon: LucideIcon; run: () => unknown }[] {
  return [
    ...(actions.canArchive ? [{ label: 'Archive', icon: ArchiveIcon, run: actions.archive }] : []),
    folder === 'TRASH'
      ? { label: 'Restore', icon: ArchiveRestoreIcon, run: actions.trash }
      : { label: 'Delete', icon: Trash2Icon, run: actions.trash },
    folder === 'SPAM'
      ? { label: 'Not spam', icon: InboxIcon, run: actions.spam }
      : { label: 'Spam', icon: OctagonAlertIcon, run: actions.spam },
    { label: 'Read', icon: MailCheckIcon, run: () => actions.run({ kind: 'read' }) },
    { label: 'Unread', icon: MailIcon, run: () => actions.run({ kind: 'unread' }) },
  ]
}

export function ThreadList({
  actions,
  checked,
  onCheckedChange,
  searchRef,
}: {
  actions: MailActions
  checked: Set<string>
  onCheckedChange: (next: Set<string>) => void
  searchRef: React.RefObject<HTMLInputElement | null>
}) {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const { account, folder, cat, q, unread, thread } = search
  const { rows, hasNextPage, fetchNextPage, isFetchingNextPage, isPending, error } = useThreadList(search)
  const labels = useLabels(account).data
  const accounts = useAccounts().data
  const mailboxes = useMemo(
    () => (account === 'all' ? (accounts ?? []).map((it) => it.email) : [account]),
    [account, accounts],
  )
  // Each row is checked against the contacts of the account it arrived in.
  // A stable combine keeps the Sets, and so every row's memo, from changing on each render.
  const combine = useCallback(
    (results: { data?: Set<string> }[]) =>
      new Map(mailboxes.map((it, i) => [it, new Set([...(results[i]?.data ?? [])].map((e) => registrableDomain(e)))])),
    [mailboxes],
  )
  const knownDomains = useQueries({
    queries: mailboxes.map(correspondentsOptions),
    combine,
  })

  const setSearch = (patch: Partial<typeof search>) => navigate({ search: (prev) => ({ ...prev, ...patch }) })

  // The selection belongs to the list it was made in.
  const latest = useRef({ checked, onCheckedChange })
  latest.current = { checked, onCheckedChange }
  // The url of the row last toggled; indexes go stale as pages arrive.
  const anchor = useRef<string | null>(null)
  useEffect(() => {
    anchor.current = null
    if (latest.current.checked.size) latest.current.onCheckedChange(new Set())
  }, [account, folder, q, cat, unread])

  const sentinel = useRef<HTMLDivElement>(null)
  const next = useRef(fetchNextPage)
  next.current = fetchNextPage
  // Re-armed whenever a page finishes: a sentinel that stays in view fires nothing more.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((it) => it.isIntersecting)) next.current()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, rows.length])

  const [draft, setDraft] = useState(q ?? '')
  useEffect(() => setDraft(q ?? ''), [q])

  // Rows that have left the list (a refetch, an action elsewhere) no longer count.
  const targets: ThreadRow[] = rows.filter((it) => checked.has(it.url))
  useEffect(() => {
    if (!isPending && targets.length !== checked.size) onCheckedChange(new Set(targets.map((it) => it.url)))
  })

  const toggle = (index: number, shift: boolean) => {
    const url = rows[index]!.url
    const out = new Set(checked)
    const from = anchor.current === null || !checked.size ? -1 : rows.findIndex((it) => it.url === anchor.current)
    if (shift && from >= 0) {
      const [lo, hi] = [from, index].sort((a, b) => a - b)
      rows.slice(lo, hi! + 1).forEach((it) => out.add(it.url))
    } else if (out.has(url)) out.delete(url)
    else out.add(url)
    anchor.current = url
    onCheckedChange(out)
  }

  const showTabs =
    folder === 'INBOX' &&
    !q &&
    OPTIONAL_CATEGORIES.some((it) => (labels?.find((l) => l.id === CATEGORY_LABEL[it])?.threadsTotal ?? 0) > 0)
  const folderName =
    SYSTEM_FOLDERS.find((it) => it.id === folder)?.name ??
    labels?.find((it) => it.id === folder)?.name.split('/').at(-1) ??
    folder

  return (
    <div data-testid="thread-list" className="flex min-h-0 flex-1 flex-col">
      {targets.length > 0 ? (
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-foreground/10 px-2">
          <span className="min-w-0 flex-1 truncate px-2 text-sm">{targets.length} selected</span>
          {bulkButtons(actions, folder).map((it) => (
            <Button
              key={it.label}
              variant="ghost"
              size="icon"
              title={it.label}
              aria-label={it.label}
              onClick={() => void it.run()}
            >
              <it.icon />
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => onCheckedChange(new Set())}>
            Clear
          </Button>
        </div>
      ) : (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-foreground/10 px-4">
          <div className="min-w-0 flex-1">
            <PageTitle>{q ? `Results for “${q}”` : folderName}</PageTitle>
          </div>
          <div className="flex shrink-0 border border-foreground/15 text-xs">
            {[
              { label: 'All', on: !unread },
              { label: 'Unread', on: !!unread },
            ].map((it) => (
              <button
                key={it.label}
                type="button"
                aria-pressed={it.on}
                onClick={() => setSearch({ unread: it.label === 'Unread' ? true : undefined })}
                className={cn(
                  'h-7 cursor-pointer px-2.5 transition-colors',
                  it.on ? 'bg-foreground/10 text-foreground' : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground',
                )}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative shrink-0 border-b border-foreground/10 p-2">
        <Input
          ref={searchRef}
          type="search"
          aria-label="Search mail"
          placeholder="Search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            const value = draft.trim()
            void setSearch({ q: value || undefined })
          }}
          className="pr-8 [&::-webkit-search-cancel-button]:hidden"
        />
        {(q || draft) && (
          <Button
            variant="ghost"
            size="icon"
            title="Clear search"
            aria-label="Clear search"
            className="absolute top-2 right-2 size-8"
            onClick={() => {
              setDraft('')
              void setSearch({ q: undefined })
            }}
          >
            <XIcon />
          </Button>
        )}
      </div>
      {showTabs && (
        <div role="tablist" className="flex shrink-0 overflow-x-auto border-b border-foreground/10 px-2">
          {(['primary', ...OPTIONAL_CATEGORIES] as const)
            .filter((it) => it === 'primary' || (labels?.find((l) => l.id === CATEGORY_LABEL[it])?.threadsTotal ?? 0) > 0)
            .map((it) => {
              const count = labels?.find((l) => l.id === CATEGORY_LABEL[it])?.threadsUnread
              return (
                <button
                  key={it}
                  type="button"
                  role="tab"
                  aria-selected={cat === it}
                  onClick={() => setSearch({ cat: it })}
                  className={cn(
                    'h-9 shrink-0 cursor-pointer border-b-2 px-3 text-sm transition-colors',
                    cat === it
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-foreground/60 hover:text-foreground',
                  )}
                >
                  {CATEGORY_NAME[it]}
                  {!!count && <span className="ml-1.5 text-xs text-foreground/40 tabular-nums">{count}</span>}
                </button>
              )
            })}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row, index) => (
          <ThreadListRow
            key={row.url}
            row={row}
            selected={row.url === thread}
            checked={checked.has(row.url)}
            anyChecked={targets.length > 0}
            showAccount={account === 'all'}
            folder={folder}
            knownDomains={knownDomains.get(row.account) ?? NO_DOMAINS}
            onSelect={() => setSearch({ thread: row.url })}
            onCheck={(shift) => toggle(index, shift)}
          />
        ))}
        {hasNextPage && <div ref={sentinel} data-testid="thread-sentinel" className="h-px" />}
        {!isPending && !rows.length && !hasNextPage && (
          <p className="p-6 text-center text-sm text-foreground/40">{error ? "Couldn't load mail" : 'Nothing here'}</p>
        )}
      </div>
    </div>
  )
}
