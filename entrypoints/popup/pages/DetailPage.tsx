import { Button } from '@/components/ui/button'
import { openMailInWeb } from '@/lib/api/gmail'
import { useMailQuery } from '@/lib/useMailQuery'
import type { EmailThread } from '@/lib/StateManager'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ChevronsUpDownIcon, ChevronsDownUpIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useCollapseState } from '@/lib/useCollapseState'
import { MailActions, urlsFromSender } from '@/components/extra/MailActions'
import { PageHeader, PageTitle } from '@/components/extra/PageHeader'
import { ThreadView } from '@/components/mail/ThreadView'

// Kept here so the style tests keep their import path.
export { DARK_MODE_RULES } from '@/components/mail/ThreadView'

// Not importing detailRoute directly from router.tsx: that file imports
// this one (as the route's component), so a direct import would be
// circular. getRouteApi() looks the route up by its string id instead.
const detailRouteApi = getRouteApi('/detail/$threadUrl')

export function DetailPage() {
  const { threadUrl } = detailRouteApi.useParams()
  const navigate = useNavigate()
  const mailQuery = useMailQuery()
  const thread = mailQuery.data?.threads.find((t) => t.url === decodeURIComponent(threadUrl))

  // The route's loader (router.tsx) already confirmed this thread exists
  // and warmed mailQuery's cache before this component ever mounted, so
  // messageCount is correct from the very first render - no effect needed
  // to push it in after the fact once thread resolves asynchronously.
  // router.tsx also remounts this component (key={threadUrl}) on every
  // thread change, giving each thread its own fresh collapse state for
  // free instead of needing to sync one shared instance to a new count.
  const messageCount = thread?.messageCount ?? 0
  const collapseStore = useCollapseState(messageCount)

  useEffect(() => {
    // Unlike the initial "does this thread exist" check (handled by the
    // route loader before this component ever mounts), this reacts to the
    // thread disappearing *while already open* - archived/deleted from
    // elsewhere mid-view. There's no render-time equivalent for "navigate
    // away because data I'm subscribed to changed out from under me", so
    // this one stays an effect.
    if (mailQuery.data && !thread) {
      navigate({ to: '/' })
    }
  }, [mailQuery.data, thread, navigate])

  if (!thread) {
    return <></>
  }
  return (
    <div className="flex flex-col min-h-screen">
      <DetailToolbar
        thread={thread}
        senderUrls={urlsFromSender(mailQuery.data!.threads, thread)}
        messageCount={messageCount}
        allCollapsed={collapseStore.hasCollapsed}
        onToggleAll={collapseStore.toggleAll}
      />
      <ThreadView thread={thread} collapse={collapseStore} />
    </div>
  )
}

function DetailToolbar(props: {
  thread: EmailThread
  senderUrls: string[]
  messageCount: number
  allCollapsed: boolean
  onToggleAll: () => void
}) {
  const { thread } = props
  return (
    <PageHeader
      back
      title={
        <a
          className="min-w-0 transition-colors hover:text-foreground/80"
          href={thread.url}
          title="Open in Gmail"
          onClick={(ev) => {
            ev.preventDefault()
            void openMailInWeb(thread.url).then(() => window.close())
          }}
        >
          <PageTitle>
            {thread.subject}
            {thread.messageCount > 1 && (
              <span className="ml-1.5 font-sans text-sm text-foreground/40 tabular-nums">{thread.messageCount}</span>
            )}
          </PageTitle>
        </a>
      }
    >
      {props.messageCount > 1 && (
        <Button
          size="icon"
          variant="ghost"
          title={props.allCollapsed ? 'Expand all' : 'Collapse all'}
          onClick={props.onToggleAll}
        >
          {props.allCollapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
        </Button>
      )}
      <MailActions thread={thread} senderUrls={props.senderUrls} shortcuts />
    </PageHeader>
  )
}
