import { MailMinusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { OpenThread } from '@/lib/api/mailbox'
import { useKnownDomains } from '@/lib/mail/correspondents'
import { suspicionOf } from '@/lib/mail/suspicion'
import { bgMessager } from '@/lib/messager'
import { hasUnsubscribeLink, UNSUBSCRIBED } from '@/lib/unsubscribe'

// Only for mail that looks genuine: for spam or a doubtful sender, an
// unsubscribe tells the sender the address is read.
export function UnsubscribeButton({ thread }: { thread: OpenThread }) {
  const knownDomains = useKnownDomains(thread.account)
  const mine = thread.account.toLowerCase()
  const last = thread.messages.findLast((it) => it.senderEmail.toLowerCase() !== mine)
  // Without the known domains a lookalike can't be ruled out yet.
  if (!last || !knownDomains || !hasUnsubscribeLink(last.contentHtml)) return null
  if (suspicionOf({ ...last, knownDomains }).length) return null

  async function unsubscribe(html: string) {
    try {
      const kind = await bgMessager.sendMessage('unsubscribe', { url: thread.url, html })
      if (kind === null) toast.error('No unsubscribe option found')
      else toast.success(UNSUBSCRIBED[kind])
    } catch (err) {
      console.error(err)
      toast.error('Unsubscribe failed')
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      title="Unsubscribe"
      aria-label="Unsubscribe"
      onClick={() => void unsubscribe(last.contentHtml)}
    >
      <MailMinusIcon />
    </Button>
  )
}
