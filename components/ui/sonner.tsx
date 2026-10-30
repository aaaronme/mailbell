import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// Toasts take the popover fill and hairline, square; only the icon carries
// state color.
const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      // Sonner follows prefers-color-scheme itself when given "system".
      theme="system"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      // Sonner pins its own font stack on the toaster.
      toastOptions={{ classNames: { toast: 'font-sans!' } }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'color-mix(in srgb, var(--foreground) 10%, transparent)',
          '--border-radius': '0px',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
