import * as React from 'react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

// The surface is `menu-surface` (style.css) and nothing else: flush, so the
// first and last rows' hover meets the hairline.
function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'menu-surface z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-40 origin-(--radix-dropdown-menu-content-transform-origin) overflow-y-auto py-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-default items-center gap-2 px-3 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-foreground/10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-foreground/60 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1 h-px bg-foreground/10', className)} {...props} />
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator }
