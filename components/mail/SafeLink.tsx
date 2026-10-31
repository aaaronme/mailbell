import { useState } from 'react'
import { CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// A link in the safe text view: never followed on a plain click, which is what
// a phishing mail counts on. A click or right-click shows where it goes first.
export function SafeLink({ text, href }: { text: string; href: string }) {
  const [open, setOpen] = useState(false)
  const web = /^https?:\/\//i.test(href)

  async function copy() {
    try {
      await navigator.clipboard.writeText(href)
      toast.success('Link copied')
    } catch (err) {
      console.error(err)
      toast.error("Couldn't copy the link")
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={href}
          className="inline cursor-pointer underline decoration-foreground/40 decoration-dotted"
          onContextMenu={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
        >
          {text}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-96">
        <p className="px-2 py-1.5 font-mono text-xs break-all text-foreground/60">{href}</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void copy()}>
          <CopyIcon />
          Copy link
        </DropdownMenuItem>
        {web && (
          <DropdownMenuItem onSelect={() => void browser.tabs.create({ url: href })}>
            <ExternalLinkIcon />
            Open link
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
