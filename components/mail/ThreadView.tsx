import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { getAttachmentBlob, parseMailbox, type Attachment, type Message } from '@/lib/api/gmail'
import type { OpenThread } from '@/lib/api/mailbox'
import type { EmailThread } from '@/lib/StateManager'
import dayjs from 'dayjs'
import { PaperclipIcon, ChevronsUpDownIcon, ReplyIcon, ReplyAllIcon, CalendarIcon, VideoIcon } from 'lucide-react'
import { Fragment, memo, useEffect, useImperativeHandle, useState } from 'react'
import root from 'react-shadow'
import { useQueryClient } from '@tanstack/react-query'
import { useCollapseState } from '@/lib/useCollapseState'
import { createStyleSheets } from '@/lib/addStyle'
import { sanitizeMail, sanitizeStyles } from '@/lib/sanitizeMail'
import { Avatar } from '@/components/extra/Avatar'
import { Textarea } from '@/components/ui/textarea'
import { bgMessager } from '@/lib/messager'
import { replyRecipients } from '@/lib/reply'
import { addToCalendarUrl, findMeetingLink, formatEventTime } from '@/lib/calendar'
import { useShortcuts } from '@/lib/useShortcuts'
import { addCorrespondents, normaliseEmails, useCorrespondents, useKnownDomains } from '@/lib/mail/correspondents'
import { suspicionOf, type SuspicionReason } from '@/lib/mail/suspicion'
import { SenderHeader } from './SenderHeader'
import { ProtectedContent } from './ProtectedContent'

// The popup's EmailThread and the popout's OpenThread render the same way.
type Thread = EmailThread | OpenThread

// The run of older messages folded into one row.
const CollapsedMessagesIndicator = memo((props: { count: number; onExpand: () => void }) => (
  <button
    type="button"
    data-testid="collapsed-indicator"
    data-count={props.count}
    className="flex w-full cursor-pointer items-center justify-center gap-2 border-b border-foreground/10 py-2 text-xs text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
    onClick={props.onExpand}
  >
    Show <span className="font-medium tabular-nums">{props.count}</span> earlier messages
    <ChevronsUpDownIcon className="size-3" />
  </button>
))

// Attachments are fetched on click: the API serves them as base64 JSON, so
// there's no plain link to point the browser at.
async function downloadAttachment(account: string, attachment: Attachment) {
  try {
    const url = URL.createObjectURL(await getAttachmentBlob(account, attachment))
    const a = document.createElement('a')
    a.href = url
    a.download = attachment.fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    console.error(err)
    toast.error(`Download failed: ${attachment.fileName}`)
  }
}

const MailMessage = function MailMessage(props: {
  account: string
  message: Message
  styles: string[]
  firstTime: boolean
  suspicion: SuspicionReason[]
  collapsed: boolean
  onToggle: () => void
}) {
  const { account, message, styles, firstTime, suspicion, collapsed, onToggle } = props

  if (collapsed) {
    return (
      <div
        data-testid="mail-message"
        role="button"
        tabIndex={0}
        className="flex cursor-pointer items-center gap-3 border-b border-foreground/10 px-4 py-3 transition-colors hover:bg-foreground/5"
        onClick={onToggle}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault()
            onToggle()
          }
        }}
      >
        <Avatar name={message.senderName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{message.senderName}</span>
            {message.time && (
              <time
                dateTime={dayjs(message.time).toISOString()}
                title={dayjs(message.time).format('YYYY-MM-DD HH:mm:ss')}
                className="shrink-0 text-xs text-foreground/40 tabular-nums"
              >
                {dayjs(message.time).format('YYYY-MM-DD HH:mm')}
              </time>
            )}
          </div>
          <div className="truncate text-foreground/60">{message.contentText}</div>
        </div>
      </div>
    )
  }
  // Show full content when expanded
  return (
    <div
      data-testid="mail-message"
      className="flex flex-col gap-3 border-b border-foreground/10 px-4 py-3"
    >
      <SenderHeader message={message} account={account} firstTime={firstTime} />
      {/* Email body */}
      <ProtectedContent account={account} message={message} styles={styles} suspicion={suspicion} />
      {/* Attachments */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {message.attachments.map((attachment) => (
            <button
              key={attachment.attachmentId}
              type="button"
              onClick={() => downloadAttachment(account, attachment)}
              className="flex cursor-pointer items-center gap-1.5 border border-foreground/15 px-2 py-1 text-xs text-foreground/80 transition-colors hover:border-foreground/30 hover:bg-foreground/5"
            >
              <PaperclipIcon className="size-3 text-foreground/60" />
              <span className="max-w-48 truncate">{attachment.fileName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// The thread's newest invite and video-call link: join it, or add it to
// Google Calendar.
function MeetingBar({ thread }: { thread: Thread }) {
  const newestFirst = thread.messages.toReversed()
  const event = newestFirst.find((it) => it.event)?.event
  const meeting = findMeetingLink([
    ...(event?.location ? [event.location] : []),
    ...newestFirst.map((it) => it.contentHtml),
  ])
  if (!event && !meeting) return null
  return (
    <div className="flex items-center gap-3 border-b border-foreground/10 px-4 py-2">
      <CalendarIcon className="size-4 shrink-0 text-foreground/60" />
      <div className="min-w-0 flex-1 truncate text-xs">
        {event ? (
          <>
            <span className="font-medium">{event.title || thread.subject}</span>
            <span className="ml-1.5 text-foreground/60 tabular-nums">{formatEventTime(event)}</span>
          </>
        ) : (
          <span className="text-foreground/60">{meeting!.service} meeting</span>
        )}
      </div>
      {event && (
        <Button size="sm" variant="ghost" asChild>
          <a href={addToCalendarUrl(event, thread.account, meeting?.url)} target="_blank">
            Add to calendar
          </a>
        </Button>
      )}
      {meeting && (
        <Button size="sm" variant="secondary" asChild>
          <a href={meeting.url} target="_blank" rel="noreferrer" title={meeting.url}>
            <VideoIcon />
            Join {meeting.service}
          </a>
        </Button>
      )}
    </div>
  )
}

// Reply or reply all, in plain text, without leaving the popup.
export interface ReplyHandle {
  open(mode: 'reply' | 'all'): void
}

// `shortcuts` off leaves r and a to the host; `replyRef` lets it open the box.
function ReplyBox({
  thread,
  shortcuts = true,
  replyRef,
}: {
  thread: Thread
  shortcuts?: boolean
  replyRef?: React.Ref<ReplyHandle>
}) {
  const [mode, setMode] = useState<'reply' | 'all' | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const last = thread.messages.at(-1)
  const canReplyAll = !!last && replyRecipients(last, thread.account, true).cc.length > 0
  const openReply = (next: 'reply' | 'all') => {
    if (next === 'reply' || canReplyAll) setMode(next)
  }
  useShortcuts({ r: () => openReply('reply'), a: () => openReply('all') }, shortcuts && mode === null && !!last)
  useImperativeHandle(replyRef, () => ({
    open: (next) => {
      if (mode === null && last) openReply(next)
    },
  }))
  if (!last) return null

  if (!mode) {
    return (
      <div className="flex gap-2 border-t border-foreground/10 p-4">
        <Button size="sm" variant="secondary" title="Reply (r)" onClick={() => setMode('reply')}>
          <ReplyIcon />
          Reply
        </Button>
        {canReplyAll && (
          <Button size="sm" variant="secondary" title="Reply all (a)" onClick={() => setMode('all')}>
            <ReplyAllIcon />
            Reply all
          </Button>
        )}
      </div>
    )
  }

  const recipients = replyRecipients(last, thread.account, mode === 'all')
  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await bgMessager.sendMessage('sendReply', { url: thread.url, recipients, text })
      toast.success('Reply sent')
      setText('')
      setMode(null)
    } catch (err) {
      console.error(err)
      toast.error(`Reply failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 border-t border-foreground/10 p-4">
      <div className="truncate text-xs text-foreground/60">
        To {recipients.to.join(', ')}
        {recipients.cc.length > 0 && <span className="text-foreground/40"> · Cc {recipients.cc.join(', ')}</span>}
      </div>
      <Textarea
        autoFocus
        aria-label="Reply"
        value={text}
        disabled={sending}
        onChange={(ev) => setText(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) void send()
        }}
      />
      <div className="flex gap-2">
        <Button size="sm" title="Send (Ctrl/Cmd+Enter)" disabled={!text.trim() || sending} onClick={send}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
        <Button size="sm" variant="ghost" disabled={sending} onClick={() => setMode(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}


export { DARK_MODE_RULES } from './ProtectedContent'

const NO_DOMAINS = new Set<string>()

export function ThreadView(props: {
  thread: Thread
  // The reader is acting on the mail: pointer, wheel, scroll or focus inside.
  onEngage?: () => void
  // Lets a toolbar outside the view drive collapsing; the view owns one otherwise.
  collapse?: ReturnType<typeof useCollapseState>
  // The host owns r and a (and opens the reply box through `replyRef`).
  shortcuts?: boolean
  replyRef?: React.Ref<ReplyHandle>
}) {
  const { thread, onEngage } = props
  const queryClient = useQueryClient()
  const ownCollapse = useCollapseState(thread.messageCount)
  const collapseStore = props.collapse ?? ownCollapse
  const correspondents = useCorrespondents(thread.account)
  const mine = thread.account.toLowerCase()

  const knownDomains = useKnownDomains(thread.account) ?? NO_DOMAINS

  const known = correspondents.data
  useEffect(() => {
    if (!known) return
    const recipients = normaliseEmails(
      thread.messages
        .filter((it) => it.senderEmail.toLowerCase() === mine)
        .flatMap((it) => [...it.to, ...it.cc].map((to) => parseMailbox(to).email)),
    )
    // Writing only what is new keeps a refetch of the same thread from writing.
    if (!recipients.some((it) => !known.has(it))) return
    void addCorrespondents(thread.account, recipients).then(() =>
      queryClient.invalidateQueries({ queryKey: ['correspondents', thread.account] }),
    )
  }, [thread.messages, thread.account, mine, known, queryClient])

  const groupStartIndex = collapseStore.groupIndexes.size > 0 ? Math.min(...collapseStore.groupIndexes) : null

  return (
    <div
      className="flex flex-col"
      onPointerDown={onEngage}
      onWheel={onEngage}
      onScrollCapture={onEngage}
      onFocus={onEngage}
    >
      {/* Keyed by thread so a reused view starts every mail's local state afresh. */}
      <Fragment key={thread.url}>
      <MeetingBar thread={thread} />
      <div className="flex-1">
        <div>
          {thread.messages.map((message, i) => {
            if (collapseStore.groupIndexes.has(i)) {
              if (i === groupStartIndex) {
                return (
                  <CollapsedMessagesIndicator
                    key={`collapsed-indicator`}
                    count={collapseStore.groupIndexes.size}
                    onExpand={() => collapseStore.expandGroup()}
                  />
                )
              }
              return null
            }
            const email = message.senderEmail.toLowerCase()
            const fromMe = email === mine
            return (
              <MailMessage
                key={`${message.senderEmail}-${message.time}-${i}`}
                account={thread.account}
                message={message}
                styles={thread.styles}
                firstTime={!fromMe && !!correspondents.data && !correspondents.data.has(email)}
                suspicion={
                  fromMe
                    ? []
                    : suspicionOf({
                        labelIds: message.labelIds,
                        identity: message.identity,
                        senderName: message.senderName,
                        senderEmail: message.senderEmail,
                        knownDomains,
                      })
                }
                collapsed={collapseStore.contentIndexes.has(i)}
                onToggle={() => collapseStore.toggleContent(i)}
              />
            )
          })}
        </div>
        <ReplyBox thread={thread} shortcuts={props.shortcuts} replyRef={props.replyRef} />
      </div>
      </Fragment>
    </div>
  )
}
