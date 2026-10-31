import { useEffect, useState, useSyncExternalStore } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon, PanelLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sidebar } from './Sidebar'
import { useBootstrapCorrespondents } from './useBootstrapCorrespondents'
import { useAccounts } from '@/lib/useAccounts'

const route = getRouteApi('/mail')

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', notify)
      return () => mq.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
  )
}

// Tasks 11 and 13 replace these.
const ThreadList = () => <div data-testid="thread-list" className="min-h-0 flex-1" />
const ReadingPane = () => <div data-testid="reading-pane" className="min-h-0 flex-1" />

export function MailRoute() {
  const { thread } = route.useSearch()
  const navigate = useNavigate({ from: '/mail' })
  const wide = useMediaQuery('(min-width: 1000px)')
  const medium = useMediaQuery('(min-width: 700px)')
  const [drawer, setDrawer] = useState(false)
  useBootstrapCorrespondents(useAccounts().data ?? [])

  useEffect(() => {
    if (wide) setDrawer(false)
  }, [wide])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])

  const clearThread = () => navigate({ search: (prev) => ({ ...prev, thread: undefined }) })

  if (!medium) {
    return (
      <div className="relative flex h-screen flex-col">
        {thread ? (
          <>
            <div className="flex h-12 shrink-0 items-center border-b border-foreground/10 px-2">
              <Button variant="ghost" size="icon" title="Back" onClick={clearThread}>
                <ArrowLeftIcon />
              </Button>
            </div>
            <ReadingPane />
          </>
        ) : (
          <ListColumn onToggleSidebar={() => setDrawer(!drawer)} />
        )}
        {drawer && <SidebarOverlay onClose={() => setDrawer(false)} />}
      </div>
    )
  }

  return (
    <div
      className="relative grid h-screen"
      style={{ gridTemplateColumns: `${wide ? '224px ' : ''}360px minmax(0, 1fr)` }}
    >
      {wide && (
        <div className="min-h-0 overflow-y-auto border-r border-foreground/10">
          <Sidebar />
        </div>
      )}
      <div className="flex min-h-0 flex-col border-r border-foreground/10">
        <ListColumn onToggleSidebar={wide ? undefined : () => setDrawer(!drawer)} />
      </div>
      <div className="flex min-h-0 flex-col">
        <ReadingPane />
      </div>
      {!wide && drawer && <SidebarOverlay onClose={() => setDrawer(false)} />}
    </div>
  )
}

function ListColumn({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onToggleSidebar && (
        <div className="flex h-12 shrink-0 items-center border-b border-foreground/10 px-2">
          <Button variant="ghost" size="icon" title="Show sidebar" onClick={onToggleSidebar}>
            <PanelLeftIcon />
          </Button>
        </div>
      )}
      <ThreadList />
    </div>
  )
}

function SidebarOverlay({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="absolute inset-0 z-10 bg-foreground/10" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 z-20 w-56 overflow-y-auto border-r border-foreground/10 bg-background">
        <Sidebar onNavigate={onClose} />
      </div>
    </>
  )
}
