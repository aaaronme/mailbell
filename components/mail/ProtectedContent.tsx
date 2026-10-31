import { memo, useMemo, useState } from 'react'
import root from 'react-shadow'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createStyleSheets } from '@/lib/addStyle'
import { sanitizeMail, sanitizeStyles } from '@/lib/sanitizeMail'
import { settingsOptions } from '@/lib/settings'
import type { Message } from '@/lib/api/gmail'
import { useCorrespondents } from '@/lib/mail/correspondents'
import { getTrustedSenders, shouldShowRemote, trustSender } from '@/lib/mail/remoteContent'
import { safeText } from '@/lib/mail/safeText'
import { REASON_TEXT, type SuspicionReason } from '@/lib/mail/suspicion'

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


// `remote` is the only switch between the blocked and the unblocked rendering:
// both come from sanitizing the original html, never from the blocked one.
const MailContent = memo((props: { contentHtml: string; styles: string[]; remote: boolean }) => {
  const styleSheets = useMemo(() => {
    return createStyleSheets([
      BASE_RESET_STYLE,
      ...props.styles.map((it) => sanitizeStyles(it, { remote: props.remote }).css),
      DARK_MODE_FILTER_STYLE,
    ])
  }, [props.styles, props.remote])
  const html = useMemo(
    () => sanitizeMail(props.contentHtml, { remote: props.remote }).html,
    [props.contentHtml, props.remote],
  )
  return (
    <ShadowDiv styleSheets={styleSheets}>
      <div dangerouslySetInnerHTML={{ __html: html }} style={{ overflowX: 'auto' }} />
    </ShadowDiv>
  )
})

export function ProtectedContent(props: {
  account: string
  message: Message
  styles: string[]
  suspicion: SuspicionReason[]
}) {
  const { account, message, styles, suspicion } = props
  const queryClient = useQueryClient()
  const [formatted, setFormatted] = useState(false)
  // Per mail and per session; "Always show from this sender" is what persists.
  const [shownOnce, setShownOnce] = useState(false)
  const settings = useQuery(settingsOptions)
  const trustedKey = ['trustedSenders', account]
  const trusted = useQuery({ queryKey: trustedKey, queryFn: () => getTrustedSenders(account) })
  const correspondents = useCorrespondents(account)
  const email = message.senderEmail.toLowerCase()

  // What a blocked rendering would hide, styles included: a mail whose only
  // remote content is in a <style> still gets the bar.
  const blocked = useMemo(
    () => sanitizeMail(message.contentHtml).blocked + styles.reduce((sum, it) => sum + sanitizeStyles(it).blocked, 0),
    [message.contentHtml, styles],
  )

  if (suspicion.length > 0 && !formatted) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium">{suspicion.map((it) => REASON_TEXT[it]).join('. ')}</div>
        <pre className="whitespace-pre-wrap wrap-anywhere font-sans">{safeText(message.contentHtml)}</pre>
        <div>
          <Button size="sm" variant="ghost" onClick={() => setFormatted(true)}>
            Show formatted
          </Button>
        </div>
      </div>
    )
  }

  const remote =
    shouldShowRemote(settings.data?.remoteImages ?? 'ask', {
      trusted: !!trusted.data?.has(email),
      repliedTo: !!correspondents.data?.has(email),
    }) || shownOnce
  return (
    <>
      {blocked > 0 && !remote && (
        <div className="flex items-center gap-2 text-xs text-foreground/60">
          <span className="min-w-0 flex-1">Images are hidden to protect your privacy</span>
          <Button size="sm" variant="ghost" onClick={() => setShownOnce(true)}>
            Show images
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await trustSender(account, email)
                await queryClient.invalidateQueries({ queryKey: trustedKey })
              } catch (err) {
                console.error(err)
                toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`)
              }
            }}
          >
            Always show from this sender
          </Button>
        </div>
      )}
      <MailContent contentHtml={message.contentHtml} styles={styles} remote={remote} />
    </>
  )
}
