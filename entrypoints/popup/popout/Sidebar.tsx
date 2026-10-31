import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addAccount } from '@/lib/accounts'
import { OAuthError } from '@/lib/auth/oauth'
import { useAccounts } from '@/lib/useAccounts'
import type { GmailLabel } from '@/lib/api/mailbox'
import { labelsOptions, useLabels } from '@/lib/mail/queries'
import { labelTree, SYSTEM_FOLDERS, type LabelNode } from '@/lib/mail/folders'
import { cn } from '@/lib/utils'
import { validateMailSearch } from './mailSearch'

const route = getRouteApi('/mail')

// labels.list carries no counts for the other system folders.
const COUNTED_SYSTEM = new Set(['INBOX', 'SPAM', 'DRAFT'])

const sumInboxUnread = (results: { data?: GmailLabel[] }[]) =>
  results.reduce((sum, { data }) => sum + (data?.find((it) => it.id === 'INBOX')?.threadsUnread ?? 0), 0)

const ROW = 'flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 text-left text-sm transition-colors'

function Entry({
  active,
  onClick,
  count,
  folder,
  indent = 0,
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  folder?: string
  // Levels of 12px, for nested labels.
  indent?: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-folder={folder}
      onClick={onClick}
      style={indent ? { paddingLeft: 12 + indent * 12 } : undefined}
      className={cn(ROW, active ? 'bg-foreground text-background' : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground')}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {!!count && (
        <>
          <span aria-hidden className={cn('tabular-nums', active ? 'text-background/70' : 'text-foreground/40')}>
            {count}
          </span>
          <span className="sr-only">, {count} unread</span>
        </>
      )}
    </button>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const { data: accounts = [] } = useAccounts()
  const inboxCounts = useQueries({
    queries: accounts.map(({ email }) => labelsOptions(email)),
    combine: sumInboxUnread,
  })

  // Dropping q and thread: a new folder starts a fresh list.
  const open = (account: string, folder: string) => {
    void navigate({ to: '/mail', search: validateMailSearch({ account, folder }) })
    onNavigate?.()
  }

  return (
    <nav data-testid="sidebar" aria-label="Mailboxes" className="flex min-h-full flex-col py-2">
      <Entry
        active={search.account === 'all' && search.folder === 'INBOX'}
        count={inboxCounts}
        onClick={() => open('all', 'INBOX')}
      >
        All inboxes
      </Entry>
      {accounts.map(({ email }) => (
        <AccountSection key={email} email={email} search={search} open={open} />
      ))}
      <div className="mt-auto flex flex-col border-t border-foreground/10 pt-2">
        <Button
          variant="ghost"
          className="justify-start px-3"
          onClick={() => {
            void navigate({ to: '/settings' })
            onNavigate?.()
          }}
        >
          <SettingsIcon /> Settings
        </Button>
        <Button variant="ghost" className="justify-start px-3" onClick={() => void addAccount()}>
          <PlusIcon /> Add account
        </Button>
      </div>
    </nav>
  )
}

function AccountSection({
  email,
  search,
  open,
}: {
  email: string
  search: { account: string; folder: string }
  open: (account: string, folder: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const labels = useLabels(email)

  const countOf = (id: string) => labels.data?.find((it) => it.id === id)?.threadsUnread
  const isActive = (folder: string) => search.account === email && search.folder === folder

  return (
    <section data-account={email} className="mt-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex h-8 w-full cursor-pointer items-center gap-1 px-3 text-left text-xs text-foreground/40 transition-colors hover:text-foreground"
      >
        {expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
        <span className="truncate">{email}</span>
      </button>
      {labels.error instanceof OAuthError && (
        <Button variant="ghost" size="sm" className="mx-3" onClick={() => void addAccount(email)}>
          Reconnect
        </Button>
      )}
      {labels.isError && !(labels.error instanceof OAuthError) && (
        <div className="flex items-center gap-2 px-3 text-xs text-foreground/40">
          Couldn't load labels
          <Button variant="ghost" size="sm" onClick={() => void labels.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {expanded && (
        <>
          {SYSTEM_FOLDERS.map(({ id, name }) => (
            <Entry
              key={id}
              folder={id}
              active={isActive(id)}
              count={COUNTED_SYSTEM.has(id) ? countOf(id) : undefined}
              onClick={() => open(email, id)}
            >
              {name}
            </Entry>
          ))}
          {labelTree(labels.data ?? []).map((node) => (
            <LabelRow
              key={node.path}
              node={node}
              depth={0}
              isActive={isActive}
              countOf={countOf}
              onOpen={(id) => open(email, id)}
            />
          ))}
        </>
      )}
    </section>
  )
}

function LabelRow({
  node,
  depth,
  isActive,
  countOf,
  onOpen,
}: {
  node: LabelNode
  depth: number
  isActive: (folder: string) => boolean
  countOf: (id: string) => number | undefined
  onOpen: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = node.children.length > 0
  const active = !!node.id && isActive(node.id)
  return (
    <>
      <div className="relative flex items-center">
        {hasChildren && (
          <button
            type="button"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            style={{ left: depth * 12 }}
            className="absolute z-10 flex h-8 w-3 cursor-pointer items-center justify-center text-foreground/40 transition-colors hover:text-foreground"
          >
            {expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
          </button>
        )}
        <Entry
          active={active}
          indent={depth}
          count={node.id ? countOf(node.id) : undefined}
          // A prefix-only parent has no mail of its own; it just folds its children.
          onClick={() => (node.id ? onOpen(node.id) : setExpanded(!expanded))}
        >
          <span className="flex items-center gap-2">
            {node.color && (
              // design-exempt: Gmail label color
              <span className="size-2 shrink-0" style={{ backgroundColor: node.color.backgroundColor }} />
            )}
            <span className="truncate">{node.name}</span>
          </span>
        </Entry>
      </div>
      {hasChildren &&
        expanded &&
        node.children.map((child) => (
          <LabelRow
            key={child.path}
            node={child}
            depth={depth + 1}
            isActive={isActive}
            countOf={countOf}
            onOpen={onOpen}
          />
        ))}
    </>
  )
}
