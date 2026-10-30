import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { getAttachmentBlob, openMailInWeb, type Attachment, type ThreadMail } from '@/lib/api/gmail'
import { useMailQuery } from '@/lib/useMailQuery'
import type { EmailThread } from '@/lib/StateManager'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { PaperclipIcon, ChevronsUpDownIcon, ChevronsDownUpIcon } from 'lucide-react'
import { memo, useEffect, useMemo } from 'react'
import root from 'react-shadow'
import { useCollapseState } from '@/lib/useCollapseState'
import { createStyleSheets } from '@/lib/addStyle'
import { MailActions, urlsFromSender } from '@/components/extra/MailActions'
import { Avatar } from '@/components/extra/Avatar'
import { PageHeader, PageTitle } from '@/components/extra/PageHeader'

// Not importing detailRoute directly from router.tsx: that file imports
// this one (as the route's component), so a direct import would be
// circular. getRouteApi() looks the route up by its string id instead.
const detailRouteApi = getRouteApi('/detail/$threadUrl')

// react-shadow's `root` is proxied via an index signature, which under
// noUncheckedIndexedAccess types every property access as possibly
// undefined even though the proxy always returns a component.
const ShadowDiv = root.div as NonNullable<typeof root.div>

// Raw email HTML almost never sets its own text color (it relies on the
// browser default, black) - but `color` is an inherited property that
// crosses shadow boundaries by default, so with nothing resetting it here,
// unstyled email text was inheriting straight through from our OWN app
// chrome's `body { color: var(--foreground) }`. In dark mode --foreground is
// near-white (correct for our UI, meant to sit on our dark background) -
// confirmed live via DevTools computed styles showing an unstyled <pre> at
// oklch(0.985 0 0). Piping that near-white value through the invert() below
// (built for content starting from the browser's actual black default) flips
// it to near-black-on-black, and the text disappears entirely regardless of
// how the invert/brightness math is tuned. Pinning an explicit black here -
// not `initial`/`canvastext`, which the ancestor's `color-scheme: dark` can
// silently reinterpret as white - cuts that inheritance off at the shadow
// boundary so unstyled text always starts from the same baseline a normal
// browser gives it. Anything the email DOES style explicitly (inline color,
// its own <style> rules) still overrides this via normal cascade specificity.
//
// The white background belongs here for the same reason, next to that black:
// both are the baseline a plain browser gives raw HTML, and dark mode is built
// on exactly that baseline - invert() turns this white into the pure black that
// brightness() below relies on. Keeping it here, unconditional, means the host
// only ever restates the browser's own baseline and the dark-mode sheet never
// has to; that matters because the filter is applied on top of this baseline,
// not instead of it, and because the popup's own `--background` is white in
// light mode too - so light mode is unaffected either way.
const BASE_RESET_STYLE = `
  :host {
    color: #000;
    background: white;
  }
`

// Emails ship their own (usually light, white-background) styling, which we
// don't control. Inverting lightness while rotating hue back is the standard
// trick browsers' own "force dark" modes use to make arbitrary HTML readable
// on a dark background; re-inverting img/video cancels it out so photos and
// logos aren't rendered as photonegatives.
//
// Known limitation of inverting rather than re-theming, unchanged by any of the
// above: a mail that is *already* dark by design (Steam's login notifications
// are the usual example) inverts into a light one. Fixing that would mean
// detecting and honouring the sender's own dark styling instead of forcing our
// own, which is a different mechanism, not a tweak to these rules.
//
// Low-contrast text (light gray "secondary info" on white, common for fine
// print / error details) needs extra help: invert() alone preserves the
// original color distance, so text that was barely legible on white becomes
// barely legible on black instead of actually improving.
//
// brightness(), not contrast(), fixes that gap: the host background is white
// (set by BASE_RESET_STYLE, not by these rules - see there for why it lives
// next to the colour reset rather than in here), so after invert() it's pinned
// at pure black (0), where brightness's multiply-by-b leaves it unchanged
// (0 * b = 0) - only the non-zero text lightens. contrast() looks like the
// obvious tool for "low contrast text" but is wrong here: it pivots around 50%
// gray, and inverted light-gray text already lands below that pivot (same side
// as the black background), so contrast pushes it *toward* black too, shrinking
// the gap instead of widening it - confirmed live, it made previously-faint
// text disappear entirely.
const DARK_MODE_BRIGHTNESS = 1.5

// Wrapped in the media query itself rather than picked in JS - the whole
// point of moving off next-themes is that dark mode is now purely a system
// preference the browser applies on its own, so this rule only needs to be
// present in the stylesheet, never conditionally included. The rules are kept
// in their own exported constant so a test can apply them without the media
// query wrapper (a browser test cannot switch prefers-color-scheme on demand).
export const DARK_MODE_RULES = `
    :host {
      filter: invert(1) hue-rotate(180deg) brightness(${DARK_MODE_BRIGHTNESS});
    }
    img, video {
      /* Order matters here, and it's the opposite of what's intuitive: the
         brightness cancellation has to run BEFORE invert/hue-rotate, not
         after. brightness() is a plain per-channel multiply (no pivot,
         unlike contrast()), so multiplying by its exact reciprocal is a
         true inverse - but only if it stays outside the two invert/
         hue-rotate pairs. Those two pairs are each self-inverse and cancel
         to identity ONLY when they sit immediately adjacent (host's
         invert/hue-rotate right after this element's); sandwiching a
         brightness multiply between them (i.e. after this element's
         invert/hue-rotate) breaks that adjacency and the cancellation math
         no longer works out, leaving photos visibly tinted. Putting it
         first keeps both pairs adjacent and cancels exactly, so photos/
         logos render at their original brightness. */
      filter: brightness(${1 / DARK_MODE_BRIGHTNESS}) invert(1) hue-rotate(180deg);
    }
    /* Background images (legacy background= attributes, inline
       background-image / background shorthands - see liftBackgroundImages)
       are painted by the element itself, so the img/video rule above can
       never reach them: their artwork stayed fully inverted, showing up as
       a photographic negative with the hue spun 180 degrees. Pinterest's
       board mails are the worst offender, because their big collage tiles
       are td[background] while only the small ones are real img elements.

       The element is therefore the thing being compensated now: the
       extraction pass only marks it ([data-email-bg]), and the same
       cancellation filter the img rule uses is applied to that element, so
       its background image *and* the text inside it render exactly as the
       sender designed them - dark copy on a light board, white copy on a
       dark banner. That replaced an ::before layer repainted from custom
       properties, which fixed the artwork but not the copy: the text stayed
       inverted and came out white-on-white on a light board.

       Known cost, the same one img already accepted: a filter makes the
       element a containing block for absolutely positioned descendants and a
       stacking context, so a position: fixed inside a marked block is
       contained by that block instead of the viewport.

       The value is the same expression, in the same order, as the img/video
       rule above (see the ordering note there for why brightness() has to
       come first) - only its target differs. */
    [data-email-bg] {
      filter: brightness(${1 / DARK_MODE_BRIGHTNESS}) invert(1) hue-rotate(180deg);
    }
    /* A marked block is already rendered as-is by the filter above, so
       anything inside it that the earlier rules would compensate has to be
       left alone or it gets cancelled a *second* time (a nested photo would
       come out inverted again). No filter, therefore: the ancestor's
       cancellation already covers it, background and all. The
       element-inside-element selector has to beat the [data-email-bg] rule
       above by specificity, not by order - a marked block nested in another
       must lose its own filter, not re-apply it. */
    [data-email-bg] img, [data-email-bg] video {
      filter: none;
    }
    [data-email-bg] [data-email-bg] {
      filter: none;
    }
`

const DARK_MODE_FILTER_STYLE = `
  @media (prefers-color-scheme: dark) {
${DARK_MODE_RULES}  }
`

const MailContent = memo((props: { contentHtml: string; styles: string[] }) => {
  const styleSheets = useMemo(() => {
    return createStyleSheets([BASE_RESET_STYLE, ...props.styles, DARK_MODE_FILTER_STYLE])
  }, [props.styles])
  return (
    <ShadowDiv styleSheets={styleSheets}>
      <div dangerouslySetInnerHTML={{ __html: props.contentHtml }} style={{ overflowX: 'auto' }} />
    </ShadowDiv>
  )
})

// The run of older messages folded into one row.
const CollapsedMessagesIndicator = memo((props: { count: number; onExpand: () => void }) => (
  <button
    type="button"
    data-testid="collapsed-indicator"
    data-count={props.count}
    className="flex w-full cursor-pointer items-center justify-center gap-2 border-b border-foreground/10 py-2 text-xs text-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
    onClick={props.onExpand}
  >
    <span className="font-medium tabular-nums">{props.count}</span> messages collapsed
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
  message: ThreadMail['messages'][number]
  styles: string[]
  collapsed: boolean
  onToggle: () => void
}) {
  const { account, message, styles, collapsed, onToggle } = props

  if (collapsed) {
    return (
      <div
        data-testid="mail-message"
        className="flex cursor-pointer items-center gap-3 border-b border-foreground/10 px-4 py-3 transition-colors hover:bg-foreground/5"
        onClick={onToggle}
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
      <div className="flex items-start gap-3">
        <Avatar name={message.senderName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate">
              <span className="font-medium">{message.senderName}</span>
              <span className="ml-1.5 text-foreground/40">{message.senderEmail}</span>
            </div>
            <span className="shrink-0 text-xs whitespace-nowrap text-foreground/40 tabular-nums">
              {message.time && dayjs(message.time).format('YYYY-MM-DD HH:mm')}
            </span>
          </div>
          <div className="text-xs text-foreground/60">
            <div>To: {message.to.join(', ')}</div>
            {message.cc.length > 0 && <div>Cc: {message.cc.join(', ')}</div>}
          </div>
        </div>
      </div>
      {/* Email body */}
      <MailContent contentHtml={message.contentHtml} styles={styles} />
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
              <span className="truncate max-w-[200px]">{attachment.fileName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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

  const groupStartIndex = collapseStore.groupIndexes.size > 0 ? Math.min(...collapseStore.groupIndexes) : null

  return (
    <div className="flex flex-col min-h-screen">
      <DetailToolbar
        thread={thread}
        senderUrls={urlsFromSender(mailQuery.data!.threads, thread)}
        messageCount={messageCount}
        allCollapsed={collapseStore.hasCollapsed}
        onToggleAll={collapseStore.toggleAll}
      />
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
            return (
              <MailMessage
                key={`${message.senderEmail}-${message.time}-${i}`}
                account={thread.account}
                message={message}
                styles={thread.styles}
                collapsed={collapseStore.contentIndexes.has(i)}
                onToggle={() => collapseStore.toggleContent(i)}
              />
            )
          })}
        </div>
      </div>
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
          className="min-w-0 hover:underline"
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
          title={props.allCollapsed ? 'All Collapsed' : 'All Expanded'}
          onClick={props.onToggleAll}
        >
          {props.allCollapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
        </Button>
      )}
      <MailActions thread={thread} senderUrls={props.senderUrls} />
    </PageHeader>
  )
}
