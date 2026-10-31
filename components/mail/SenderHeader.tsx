import { useState } from 'react'
import dayjs from 'dayjs'
import { BadgeCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { Avatar } from '@/components/extra/Avatar'
import { Button } from '@/components/ui/button'
import type { Message } from '@/lib/api/gmail'
import { splitAddress } from '@/lib/mail/identity'

// The address with its registrable domain picked out: that part is what the
// sender controls, and everything before it (subdomains, the local part) is
// what a look-alike address pads it with.
function Address({ email }: { email: string }) {
  const { local, host, domain } = splitAddress(email)
  const own = host === domain || !host.endsWith(`.${domain}`) ? '' : host.slice(0, host.length - domain.length)
  return (
    <>
      <span className="text-foreground/40">{`${local}@${own}`}</span>
      <span className="font-medium text-foreground/80">{host === domain || own ? domain : host}</span>
    </>
  )
}

export function SenderHeader(props: { message: Message; account: string; firstTime: boolean }) {
  const { message, firstTime } = props
  const { identity } = message
  const [details, setDetails] = useState(false)
  const replyTo = identity.replyToMismatch && identity.replyTo ? `Replies go to ${identity.replyTo}` : null
  const first = "you haven't written to this address before"
  const warning = replyTo ? (firstTime ? `${replyTo}, and ${first}` : replyTo) : firstTime ? `You${first.slice(3)}` : null
  const security = identity.tls === undefined ? null : identity.tls ? 'TLS' : 'No TLS'

  return (
    <div className="flex items-start gap-3">
      <Avatar name={message.senderName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate">
            <span className="font-medium">{message.senderName}</span>
            <span className="ml-1.5">
              <Address email={message.senderEmail} />
            </span>
            {identity.status === 'verified' && (
              <span className="ml-1 inline-block align-text-bottom" title={`Sent from ${identity.fromDomain} (verified)`}>
                <BadgeCheckIcon className="size-3.5 text-foreground/60" />
              </span>
            )}
            {identity.status === 'failed' && (
              <span className="ml-1 inline-block align-text-bottom" title={identity.reason ?? 'Failed sender checks'}>
                <TriangleAlertIcon className="size-3.5 text-foreground/60" />
              </span>
            )}
            {identity.via && <span className="text-foreground/40"> via {identity.via}</span>}
          </div>
          <span className="shrink-0 text-xs whitespace-nowrap text-foreground/40 tabular-nums">
            {message.time && dayjs(message.time).format('YYYY-MM-DD HH:mm')}
          </span>
        </div>
        <div className="text-xs text-foreground/60">
          <div>To: {message.to.join(', ')}</div>
          {message.cc.length > 0 && <div>Cc: {message.cc.join(', ')}</div>}
        </div>
        {warning && <div className="text-xs font-medium">{warning}</div>}
        <Button size="sm" variant="ghost" className="-ml-3 h-6 text-xs" onClick={() => setDetails(!details)}>
          Details
        </Button>
        {details && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-foreground/60">
            {identity.mailedBy && <Row label="Mailed by" value={identity.mailedBy} />}
            {identity.signedBy && <Row label="Signed by" value={identity.signedBy} />}
            {security && <Row label="Security" value={security} />}
            {identity.replyTo && <Row label="Reply-To" value={identity.replyTo} />}
          </dl>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </>
  )
}
