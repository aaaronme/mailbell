import { Button } from '@/components/ui/button'
import { openMailInWeb, newEmail, inboxUrl } from '@/lib/api/gmail'
import { bgMessager } from '@/lib/messager'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { mailQueryKey, useMailQuery } from '@/lib/useMailQuery'
import dayjs from 'dayjs'
import {
  MailOpenIcon,
  ExternalLinkIcon,
  MoreVerticalIcon,
  SquareArrowOutUpRightIcon,
  MailPlusIcon,
  BugIcon,
  CopyIcon,
  SettingsIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { RefreshIcon } from '@/components/extra/RefreshIcon'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GithubIcon } from '@/components/extra/GithubIcon'
import { Avatar } from '@/components/extra/Avatar'
import { useClient } from '@/components/extra/ClientForm'
import { SetupGuide } from './SetupGuide'
import { PageHeader } from '@/components/extra/PageHeader'
import type { EmailThread } from '@/lib/StateManager'
import { getThreadCode } from '@/lib/otp'
import { MailActions, urlsFromSender } from '@/components/extra/MailActions'
import { useAccounts } from '@/lib/useAccounts'
import { addAccount } from '@/lib/accounts'
import { useShortcuts } from '@/lib/useShortcuts'

function MailItem({
  thread,
  senderUrls,
  onClick,
}: {
  thread: EmailThread
  senderUrls: string[]
  onClick: () => void
}) {
  const row = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={row}
      role="button"
      tabIndex={0}
      data-mail-row={thread.url}
      className="group flex cursor-pointer gap-3 border-b border-foreground/10 px-4 py-3 transition-colors hover:bg-foreground/5"
      onClick={onClick}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' && ev.target === ev.currentTarget) onClick()
      }}
    >
      <Avatar name={thread.author.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sender, then the time - or, while hovered or focused, the actions in its place. */}
        <div className="flex h-6 items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{thread.author.name}</span>
            <span className="ml-1.5 text-foreground/40">{thread.author.email}</span>
          </span>
          <span className="text-xs whitespace-nowrap text-foreground/40 tabular-nums group-hover:hidden group-focus-within:hidden group-has-[[data-state=open]]:hidden">
            {dayjs(thread.modified).format('YYYY-MM-DD HH:mm')}
          </span>
          <div
            className="-my-1 hidden group-hover:flex group-focus-within:flex group-has-[[data-state=open]]:flex"
            onClick={(ev) => ev.stopPropagation()}
          >
            <MailActions thread={thread} senderUrls={senderUrls} shortcuts={() => !!row.current?.contains(document.activeElement)} />
          </div>
        </div>
        <div className="truncate text-foreground/80">{thread.title}</div>
        <div className="truncate text-xs text-foreground/40">{thread.summary}</div>
      </div>
    </div>
  )
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    window.close()
  } catch (err) {
    console.error(err)
    toast.error('Copy failed')
  }
}

// Codes from unread mail, newest first, pinned to the bottom of the popup.
function CodeBar({ threads }: { threads: EmailThread[] }) {
  const codes = threads
    .map((thread) => ({ thread, code: getThreadCode(thread) }))
    .filter((it): it is { thread: EmailThread; code: string } => it.code !== null)
    .sort((a, b) => dayjs(b.thread.modified).valueOf() - dayjs(a.thread.modified).valueOf())
    .slice(0, 3)
  const newest = codes[0]?.code
  // Enter copies the newest code, unless a focused control takes the key itself.
  useEffect(() => {
    if (!newest) return
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Enter' && ev.target === document.body) void copyCode(newest!)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [newest])
  if (!codes.length) return null
  return (
    <div className="sticky bottom-0 z-10 flex flex-col border-t border-foreground/10 bg-background">
      {codes.map(({ thread, code }, i) => (
        <button
          key={thread.url}
          className="flex cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-foreground/5"
          title={i === 0 ? 'Copy code (Enter)' : 'Copy code'}
          onClick={() => copyCode(code)}
        >
          {/* The code is the popup's one accent: what you came to the popup for. */}
          <span className="font-mono text-base font-semibold tracking-widest text-bell">{code}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/60">{thread.author.name}</span>
          <CopyIcon className="size-4 shrink-0 text-foreground/60" />
        </button>
      ))}
    </div>
  )
}

function Toolbar() {
  const navigate = useNavigate()
  const mailQuery = useMailQuery()
  const clientQuery = useClient()
  const signedIn = !!mailQuery.data?.accounts.length
  // No client to sign in with: walk through creating one instead.
  const needsSetup = !signedIn && clientQuery.isSuccess && !clientQuery.data
  const queryClient = useQueryClient()
  const refreshMutation = useMutation({
    // Don't rely solely on background's 'refreshPopup' push: it's lost if the
    // keepalive port is reconnecting at that instant. Pull once our own
    // request has completed.
    mutationFn: async () => {
      await bgMessager.sendMessage('refreshThreads', undefined)
      await queryClient.invalidateQueries({ queryKey: mailQueryKey })
    },
    onError: (err) => {
      console.error(err)
      toast.error("Couldn't refresh. The Debug log has details.")
    },
  })

  async function markAllAsRead() {
    try {
      await bgMessager.sendMessage('gmailAction', {
        cmd: 'markAllAsRead',
        urls: (mailQuery.data?.threads ?? []).map((t) => t.url),
      })
      await queryClient.invalidateQueries({ queryKey: mailQueryKey })
      toast.success('Marked all as read')
    } catch (err) {
      console.error(err)
      toast.error("Couldn't mark all as read")
    }
  }

  const accounts = mailQuery.data?.accounts ?? []
  const accountLabel = accounts.length === 1 ? accounts[0] : `${accounts.length} accounts`

  return (
    <PageHeader
      title={
        <>
          <img src="/icon/48.png" alt="" className="size-5" />
          {accounts.length ? (
            <span className="truncate font-medium">
              {accountLabel}
              <span className="ml-1.5 text-foreground/40 tabular-nums">{mailQuery.data!.threads.length}</span>
            </span>
          ) : (
            <span className="font-display text-base">Mailbell</span>
          )}
        </>
      }
    >
      {/* The full mail client, used often enough to sit out of the menu.
          ?view=tab tells main.tsx not to pin the popup width. */}
      {accounts.length > 0 && (
        <Button asChild size="sm" variant="secondary">
          <a href={browser.runtime.getURL('/popup.html?view=tab')} target="_blank">
            <SquareArrowOutUpRightIcon />
            Open in tab
          </a>
        </Button>
      )}
      {(mailQuery.data?.threads.length ?? 0) > 0 && (
        <Button
          size="icon"
          variant="ghost"
          title={'Mark all as read'}
          onClick={() => markAllAsRead()}
        >
          <MailOpenIcon />
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        title={'Refresh'}
        onClick={() => refreshMutation.mutate()}
        disabled={refreshMutation.isPending}
      >
        <RefreshIcon loading={refreshMutation.isPending} />
      </Button>
      {/* With several accounts, each account's heading opens its own inbox. */}
      {accounts.length < 2 && (
        <Button
          size="icon"
          variant="ghost"
          title={'Open in Gmail'}
          onClick={() => openInbox(accounts[0])}
        >
          <ExternalLinkIcon />
        </Button>
      )}
      {accounts.length < 2 ? (
        <Button size="icon" variant="ghost" title="New email (c)" onClick={() => newEmail()}>
          <MailPlusIcon />
        </Button>
      ) : (
        // Which account it's sent from.
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" title="New email (c)">
              <MailPlusIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={'end'}>
            {accounts.map((account) => (
              <DropdownMenuItem key={account} onClick={() => newEmail(account)}>
                From {account}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" title={'More'}>
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={'end'}>
          <DropdownMenuItem onClick={() => navigate({ to: '/settings' })}>
            <SettingsIcon />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate({ to: '/debug' })}>
            <BugIcon />
            Debug Log
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="https://github.com/aaaronme/mailbell" target="_blank">
              <GithubIcon />
              GitHub
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PageHeader>
  )
}

const mailRows = () => [...document.querySelectorAll<HTMLElement>('[data-mail-row]')]

function MailList({
  accounts,
  threads,
  onSelectFeed,
}: {
  accounts: string[]
  threads: EmailThread[]
  onSelectFeed: (thread: EmailThread) => void
}) {
  // j/k move focus between rows, from the top if none has it. The action
  // shortcuts act on the row that has focus (MailItem).
  function move(by: number) {
    const rows = mailRows()
    const current = rows.findIndex((it) => it.contains(document.activeElement))
    const index = current === -1 ? 0 : current + by
    rows[Math.max(0, Math.min(index, rows.length - 1))]?.focus()
  }
  // The row focused last, to refocus where it was once it's gone.
  const [selected, setSelected] = useState<{ url: string; index: number } | null>(null)
  useShortcuts({ j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1), c: () => newEmail(focusedAccount()) })
  // A mail archived or deleted from the keyboard leaves the list: carry on
  // with the one that took its place.
  useEffect(() => {
    if (!selected || threads.some((it) => it.url === selected.url)) return
    const rows = mailRows()
    rows[Math.min(selected.index, rows.length - 1)]?.focus()
  }, [threads, selected])
  const items = (list: EmailThread[]) =>
    list.map((thread) => (
      <div
        key={thread.url}
        data-account={thread.account}
        onFocus={(ev) => setSelected({ url: thread.url, index: mailRows().indexOf(ev.currentTarget.firstElementChild as HTMLElement) })}
      >
        <MailItem
          thread={thread}
          senderUrls={urlsFromSender(threads, thread)}
          onClick={() => onSelectFeed(thread)}
        />
      </div>
    ))
  if (accounts.length < 2) {
    return <div>{items(threads)}</div>
  }
  // One section per account, in the order they were added, including accounts with nothing
  // unread - so every signed-in account is visibly being watched.
  return (
    <div>
      {accounts.map((account) => {
        const own = threads.filter((it) => it.account === account)
        return (
          <section key={account}>
            {/* top-12: sticks under the page header, not behind it. */}
            <h2 className="sticky top-12 z-10 border-b border-foreground/10 bg-background text-xs font-medium text-foreground/60">
              <button
                type="button"
                title={`Open ${account} in Gmail`}
                onClick={() => openInbox(account)}
                className="group flex w-full items-center gap-1.5 px-4 py-1.5 text-left transition-colors hover:bg-foreground/5"
              >
                <span className="truncate">{account}</span>
                <ExternalLinkIcon className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                <span className="ml-auto text-foreground/40 tabular-nums">{own.length}</span>
              </button>
            </h2>
            {items(own)}
          </section>
        )
      })}
    </div>
  )
}

// An account Google signed out (revoked, password change) silently drops out
// of the list otherwise.
function ReauthBanner() {
  const expired = (useAccounts().data ?? []).filter((it) => it.needsReauth)
  if (!expired.length) return null
  return (
    <div className="flex flex-col border-b border-foreground/10 bg-destructive/10">
      {expired.map((account) => (
        <div key={account.email} className="flex items-center gap-2 px-4 py-2">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{account.email}</span>
            <span className="text-destructive"> needs to sign in again</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => addAccount(account.email)}>
            Reconnect
          </Button>
        </div>
      ))}
    </div>
  )
}

export function IndexPage() {
  const navigate = useNavigate()
  const mailQuery = useMailQuery()
  const clientQuery = useClient()
  const signedIn = !!mailQuery.data?.accounts.length
  // No client to sign in with: walk through creating one instead.
  const needsSetup = !signedIn && clientQuery.isSuccess && !clientQuery.data

  async function onSelectFeed(thread: EmailThread) {
    navigate({ to: '/detail/$threadUrl', params: { threadUrl: encodeURIComponent(thread.url) } })
    if (import.meta.env.PROD) {
      await bgMessager.sendMessage('gmailAction', {
        cmd: 'viewed',
        url: thread.url,
      })
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Toolbar />
      <ReauthBanner />
      <div
        className={cn(
          'flex-1',
          // Centered on this element itself: a child's h-full doesn't resolve
          // against a flex item's grown height.
          !signedIn && !needsSetup && 'flex flex-col items-center justify-center gap-4 px-4 text-center',
        )}
      >
        {signedIn ? (
          <MailList accounts={mailQuery.data!.accounts} threads={mailQuery.data!.threads} onSelectFeed={onSelectFeed} />
        ) : needsSetup ? (
          <SetupGuide />
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="font-display text-xl">Your inbox, from the toolbar</p>
              <p className="text-xs text-foreground/60">Sign in to see new mail and one-time codes here.</p>
            </div>
            <Button onClick={() => addAccount()}>Sign in with Google</Button>
          </>
        )}
      </div>
      <CodeBar threads={mailQuery.data?.threads ?? []} />
    </div>
  )
}

async function openInbox(account: string | undefined) {
  await openMailInWeb(account ? inboxUrl(account) : 'https://mail.google.com/mail/')
  window.close()
}

// The account of the focused mail, so c writes from the inbox you're in.
function focusedAccount() {
  return document.activeElement?.closest<HTMLElement>('[data-account]')?.dataset.account || undefined
}
