import * as React from 'react'

import { cn } from '@/lib/utils'

// Input's multi-line sibling: the same hairline box, focus shown the same way.
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 resize-y border border-foreground/15 bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-foreground/40 hover:border-foreground/30 focus:border-foreground/40 focus:bg-foreground/5 disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
