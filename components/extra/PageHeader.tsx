import { Button } from '@/components/ui/button'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { useShortcuts } from '@/lib/useShortcuts'

// The sticky bar every page starts with. Sub-pages pass `back` for the arrow
// home; actions go in children, after the title.
export function PageHeader({
  title,
  back,
  children,
}: {
  title: React.ReactNode
  back?: boolean
  children?: React.ReactNode
}) {
  const navigate = useNavigate()
  useShortcuts({ u: () => navigate({ to: '/' }) }, !!back)
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-1 border-b border-foreground/10 bg-background px-2">
      {back && (
        <Button size="icon" variant="ghost" title="Back (u)" onClick={() => navigate({ to: '/' })}>
          <ArrowLeftIcon />
        </Button>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2">{title}</div>
      {children}
    </header>
  )
}

// A page or thread title: the display serif, regular weight.
export function PageTitle({ children }: { children: React.ReactNode }) {
  return <h1 className="truncate font-display text-base">{children}</h1>
}
