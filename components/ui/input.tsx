import * as React from 'react'

import { cn } from '@/lib/utils'

// The field (STYLE_GUIDE.md -> Field): a square hairline box that shows focus
// through its border and fill, not an outline.
function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 border border-foreground/15 bg-transparent px-2.5 text-sm outline-none transition-colors placeholder:text-foreground/40 hover:border-foreground/30 focus:border-foreground/40 focus:bg-foreground/5 read-only:text-foreground/60 disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
