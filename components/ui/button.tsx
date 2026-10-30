import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

// STYLE_GUIDE.md -> Button. Colors are foreground-relative so each variant
// reads right in both themes; focus is the global outline (style.css).
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary action: the solid inverse.
        default: 'bg-emphasis text-emphasis-foreground hover:bg-emphasis/85',
        secondary: 'bg-foreground/10 text-foreground hover:bg-foreground/15',
        ghost: 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'
  // The radius is owned here, after className, so every button gets the same
  // corners: ghost icon buttons are round, everything else rounded-md.
  const shape = variant === 'ghost' && size === 'icon' ? 'rounded-full' : 'rounded-md'
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }), shape)} {...props} />
}

export { Button }
