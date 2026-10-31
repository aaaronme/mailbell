import { useEffect, useMemo, useRef, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { XIcon } from 'lucide-react'
import { PageTitle } from '@/components/extra/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ThreadRow } from '@/lib/api/mailbox'
import { CATEGORY_LABEL, SYSTEM_FOLDERS, type Category } from '@/lib/mail/folders'
import { registrableDomain } from '@/lib/mail/identity'
import { useCorrespondents } from '@/lib/mail/correspondents'
import { useLabels, useThreadList } from '@/lib/mail/queries'
import type { MailAction } from '@/lib/mail/actions'
import { runUndoable } from '@/lib/mail/undo'
import { cn } from '@/lib/utils'
import { ThreadListRow } from './ThreadListRow'

const route = getRouteApi('/mail')

const CATEGORY_NAME: Record<Category, string> = {
  primary: 'Primary',
  social: 'Social',
  promotions: 'Promotions',
  updates: 'Updates',
  forums: 'Forums',
}
const OPTIONAL_CATEGORIES = (['social', 'promotions', 'updates', 'forums'] as const)

const BULK: { label: string; action: MailAction; removes: boolean }[] = [
  { label: 'Archive', action: { kind: 'archive' }, removes: true },
  { label: 'Delete', action: { kind: 'trash' }, removes: true },
  { label: 'Spam', action: { kind: 'spam' }, removes: true },
  { label: 'Read', action: { kind: 'read' }, removes: false },
  { label: 'Unread', action: { kind: 'unread' }, removes: false },
]

export function ThreadList({
  checked,
  onCheckedChange,
  searchRef,
}: {
  checked: Set<string>
  onCheckedChange: (next: Set<string>) => void
  searchRef: React.RefObject<HTMLInputElement | null>
}) {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const { account, folder, cat, q, unread, thread } = search
  const { rows, hasNextPage, fetchNextPage, isPending, error } = useThreadList(search)
  const labels = useLabels(account).data
  const correspondents = useCorrespondents(account)
  const knownDomains = useMemo(
    () => new Set([...(correspondents.data ?? [])].map((it) => registrableDomain(it))),
    [correspondents.data],
  )

  const setSearch = (patch: Partial<typeof search>) => navigate({ search: (prev) => ({ ...prev, ...patch }) })

  // The selection belongs to the list it was made in.
  const latest = useRef({ checked, onCheckedChange })
  latest.current = { checked, onCheckedChange }
  const lastChecked = useRef<number | null>(null)
  useEffect(() => {
    lastChecked.current = null
    if (latest.current.checked.size) latest.current.onCheckedChange(new Set())
  }, [account, folder, q, cat, unread])

  const sentinel = useRef<HTMLDivElement>(null)
  const next = useRef(fetchNextPage)
  next.current = fetchNextPage
  // Re-observed after every page: a sentinel that stays in view fires nothing more.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((it) => it.isIntersecting)) next.current()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, rows.length])

  const [draft, setDraft] = useState(q ?? '')
  useEffect(() => setDraft(q ?? ''), [q])

  const toggle = (index: number, shift: boolean) => {
    const url = rows[index]!.url
    const out = new Set(checked)
    if (shift && lastChecked.current !== null) {
      const [from, to] = [lastChecked.current, index].sort((a, b) => a - b)
      rows.slice(from, to! + 1).forEach((it) => out.add(it.url))
    } else if (out.has(url)) out.delete(url)
    else out.add(url)
    lastChecked.current = index
    onCheckedChange(out)
  }

  const runBulk = (action: MailAction, removes: boolean) => {
    const targets: ThreadRow[] = rows.filter((it) => checked.has(it.url))
    void runUndoable(action, targets)
    if (removes) onCheckedChange(new Set())
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
      {checked.size > 0 ? (
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-foreground/10 px-2">
          <span className="min-w-0 flex-1 truncate px-2 text-sm">{checked.size} selected</span>
          {BULK.map((it) => (
            <Button key={it.label} variant="ghost" size="sm" onClick={() => runBulk(it.action, it.removes)}>
              {it.label}
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
                  it.on ? 'bg-foreground text-background' : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground',
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
          role="searchbox"
          aria-label="Search mail"
          placeholder="Search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
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
            anyChecked={checked.size > 0}
            showAccount={account === 'all'}
            folder={folder}
            knownDomains={knownDomains}
            onSelect={() => setSearch({ thread: row.url })}
            onCheck={(shift) => toggle(index, shift)}
          />
        ))}
        {hasNextPage && <div ref={sentinel} data-testid="thread-sentinel" className="h-px" />}
        {!isPending && !rows.length && (
          <p className="p-6 text-center text-sm text-foreground/40">{error ? "Couldn't load mail" : 'Nothing here'}</p>
        )}
      </div>
    </div>
  )
}
