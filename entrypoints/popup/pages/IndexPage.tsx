import { Button } from '@/components/ui/button'
import { openMailInWeb, newEmail, getActiveInboxUrl } from '@/lib/api/gmail'
import { bgMessager } from '@/lib/messager'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
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
  BellIcon,
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
import { PageHeader } from '@/components/extra/PageHeader'
import type { EmailThread } from '@/lib/StateManager'
import { getThreadCode } from '@/lib/otp'
import { MailActions, urlsFromSender } from '@/components/extra/MailActions'
import { useAccounts } from '@/lib/useAccounts'
import { addAccount } from './SettingsPage'

function MailItem({
  thread,
  senderUrls,
  onClick,
}: {
  thread: EmailThread
  senderUrls: string[]
  onClick: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
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
            <MailActions thread={thread} senderUrls={senderUrls} />
          </div>
        </div>
        <div className="truncate text-foreground/80">{thread.title}</div>
        <div className="truncate text-xs text-foreground/50">{thread.summary}</div>
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
  const queryClient = useQueryClient()
  const refreshMutation = useMutation({
    // Don't rely solely on background's 'refreshPopup' push: it's lost if the
    // keepalive port is reconnecting at that instant. Pull once our own
    // request has completed.
    mutationFn: async () => {
      await bgMessager.sendMessage('refreshThreads', undefined)
      await queryClient.invalidateQueries({ queryKey: mailQueryKey })
    },
  })

  async function markAllAsRead(msg: string) {
    try {
      await bgMessager.sendMessage('gmailAction', {
        cmd: 'markAllAsRead',
        urls: (mailQuery.data?.threads ?? []).map((t) => t.url),
      })
      await queryClient.invalidateQueries({ queryKey: mailQueryKey })
      toast.success(msg)
    } catch (err) {
      console.error(err)
      toast.error(msg + ' failed')
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
      {(mailQuery.data?.threads.length ?? 0) > 0 && (
        <Button
          size="icon"
          variant="ghost"
          title={'Mark all as read'}
          onClick={() => markAllAsRead('Mark all as read')}
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
      <Button
        size="icon"
        variant="ghost"
        title={'Open in Gmail'}
        onClick={async () => {
          await openMailInWeb(await getActiveInboxUrl())
          window.close()
        }}
      >
        <ExternalLinkIcon />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title={'New email'}
        onClick={newEmail}
      >
        <MailPlusIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" title={'More'}>
            <MoreVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={'end'}>
          <DropdownMenuItem asChild>
            {/* ?view=tab tells main.tsx not to pin the popup width. */}
            <a href={browser.runtime.getURL('/popup.html?view=tab')} target="_blank">
              <SquareArrowOutUpRightIcon />
              Popout
            </a>
          </DropdownMenuItem>
          {/* Only Firefox's background page can play audio (see lib/sound.ts). */}
          {import.meta.env.FIREFOX && (
            <DropdownMenuItem onClick={() => navigate({ to: '/sound' })}>
              <BellIcon />
              Notification sound
            </DropdownMenuItem>
          )}
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

function MailList({
  accounts,
  threads,
  onSelectFeed,
}: {
  accounts: string[]
  threads: EmailThread[]
  onSelectFeed: (thread: EmailThread) => void
}) {
  const items = (list: EmailThread[]) =>
    list.map((thread) => (
      <MailItem
        key={thread.url}
        thread={thread}
        senderUrls={urlsFromSender(threads, thread)}
        onClick={() => onSelectFeed(thread)}
      />
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
            <h2 className="sticky top-12 z-10 flex justify-between border-b border-foreground/10 bg-background px-4 py-1.5 text-xs font-medium text-foreground/60">
              <span className="truncate">{account}</span>
              <span className="tabular-nums">{own.length}</span>
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
    <div className="flex flex-col gap-1 border-b border-foreground/10 bg-destructive/10 px-4 py-2">
      {expired.map((account) => (
        <div key={account.email} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{account.email}</span>
            <span className="text-foreground/60"> needs to sign in again</span>
          </span>
          <Button size="sm" onClick={() => addAccount(account.email)}>
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
          !mailQuery.data?.accounts.length && 'flex flex-col items-center justify-center gap-4',
        )}
      >
        {mailQuery.data?.accounts.length ? (
          <MailList
            accounts={mailQuery.data.accounts}
            threads={mailQuery.data.threads}
            onSelectFeed={onSelectFeed}
          />
        ) : (
          <>
            <p className="font-display text-xl">Your inbox, from the toolbar</p>
            <Button onClick={() => addAccount()}>Sign in with Google</Button>
          </>
        )}
      </div>
      <CodeBar threads={mailQuery.data?.threads ?? []} />
    </div>
  )
}
