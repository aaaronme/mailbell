import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { openMailInWeb } from '@/lib/api/gmail'
import { bgMessager, type GmailAction } from '@/lib/messager'
import type { EmailThread } from '@/lib/StateManager'
import { hasUnsubscribeLink } from '@/lib/unsubscribe'
import { mailQueryKey } from '@/lib/useMailQuery'
import { useQueryClient } from '@tanstack/react-query'
import { useShortcuts } from '@/lib/useShortcuts'
import { ArchiveIcon, BanIcon, ExternalLinkIcon, MailMinusIcon, MailOpenIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

// Every listed thread from this thread's sender, this one included.
export function urlsFromSender(threads: EmailThread[], thread: EmailThread): string[] {
  const sender = thread.author.email.toLowerCase()
  return threads.filter((it) => it.author.email.toLowerCase() === sender).map((it) => it.url)
}

// The per-mail actions, shared by the list row and the opened mail. With
// `shortcuts`, Gmail's keys run them too (see useShortcuts for a function).
export function MailActions({
  thread,
  senderUrls,
  shortcuts = false,
}: {
  thread: EmailThread
  senderUrls: string[]
  shortcuts?: boolean | (() => boolean)
}) {
  const queryClient = useQueryClient()
  async function gmailAction(data: GmailAction) {
    await bgMessager.sendMessage('gmailAction', data)
    await queryClient.invalidateQueries({ queryKey: mailQueryKey })
  }
  async function run(msg: string, data: GmailAction) {
    try {
      await gmailAction(data)
      toast.success(msg)
    } catch (err) {
      console.error(err)
      toast.error(msg + ' failed')
    }
  }
  // Removes what the user asked for, whatever kind of unsubscribe it was:
  // they chose "unsubscribe and remove", and page/mail kinds are a click away.
  async function unsubscribe(cleanup: GmailAction) {
    let kind
    try {
      kind = await bgMessager.sendMessage('unsubscribe', thread.url)
    } catch (err) {
      console.error(err)
      toast.error('Unsubscribe failed')
      return
    }
    if (kind === null) {
      toast.error('No unsubscribe option found')
      return
    }
    await run(
      {
        post: 'Unsubscribe request sent',
        open: 'Unsubscribe page opened',
        mail: 'Unsubscribe mail ready to send',
      }[kind],
      cleanup,
    )
  }
  const one = (cmd: 'archive' | 'deleteMail' | 'markAsRead' | 'markAsSpam') => ({ cmd, url: thread.url })
  useShortcuts(
    {
      e: () => run('Archive', one('archive')),
      '#': () => run('Delete', one('deleteMail')),
      I: () => run('Mark as read', one('markAsRead')),
      '!': () => run('Mark as spam', one('markAsSpam')),
    },
    shortcuts,
  )
  const all = (cmd: 'archiveAll' | 'deleteAll') => ({ cmd, urls: senderUrls })
  const othersFromSender = senderUrls.length > 1
  const canUnsubscribe = hasUnsubscribeLink(thread.messages.at(-1)?.contentHtml ?? '')
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        title="Archive (e)"
        onClick={() => run('Archive', one('archive'))}
      >
        <ArchiveIcon />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title="Trash (#)"
        onClick={() => run('Delete', one('deleteMail'))}
      >
        <Trash2Icon />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title="Mark as read (Shift+I)"
        onClick={() => run('Mark as read', one('markAsRead'))}
      >
        <MailOpenIcon />
      </Button>
      {(canUnsubscribe || othersFromSender) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" title={canUnsubscribe ? 'Unsubscribe' : 'From this sender'}>
              <MailMinusIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={'end'}>
            {canUnsubscribe && (
              <>
                <DropdownMenuItem onClick={() => unsubscribe(one('archive'))}>Unsubscribe and archive</DropdownMenuItem>
                <DropdownMenuItem onClick={() => unsubscribe(one('deleteMail'))}>Unsubscribe and delete</DropdownMenuItem>
              </>
            )}
            {canUnsubscribe && othersFromSender && (
              <>
                <DropdownMenuItem onClick={() => unsubscribe(all('archiveAll'))}>
                  Unsubscribe and archive all {senderUrls.length} from sender
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => unsubscribe(all('deleteAll'))}>
                  Unsubscribe and delete all {senderUrls.length} from sender
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {othersFromSender && (
              <>
                <DropdownMenuItem onClick={() => run(`Archive ${senderUrls.length} mails`, all('archiveAll'))}>
                  Archive all {senderUrls.length} from sender
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => run(`Delete ${senderUrls.length} mails`, all('deleteAll'))}>
                  Delete all {senderUrls.length} from sender
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button
        size="icon"
        variant="ghost"
        title="Spam (!)"
        onClick={() => run('Mark as spam', one('markAsSpam'))}
      >
        <BanIcon />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title={'Open in Gmail'}
        onClick={() => openMailInWeb(thread.url).then(() => window.close())}
      >
        <ExternalLinkIcon />
      </Button>
    </>
  )
}
