import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, PanelLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sidebar } from './Sidebar'
import { ThreadList } from './ThreadList'
import { useBootstrapCorrespondents } from './useBootstrapCorrespondents'
import { ReadingPane, type LabelMenu } from './ReadingPane'
import { ShortcutSheet } from './ShortcutSheet'
import { useMailActions } from './useMailActions'
import { usePopoutShortcuts } from './usePopoutShortcuts'
import type { ReplyHandle } from '@/components/mail/ThreadView'
import { useAccounts } from '@/lib/useAccounts'
import { usePreload } from '@/lib/mail/preload'
import { useMarkRead } from '@/lib/mail/markRead'
import { useOpenThread, useThreadList } from '@/lib/mail/queries'
import { isSettingsChange, settingsOptions } from '@/lib/settings'

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

export function MailRoute() {
  const search = route.useSearch()
  const { thread } = search
  const navigate = useNavigate({ from: '/mail' })
  const wide = useMediaQuery('(min-width: 1000px)')
  const medium = useMediaQuery('(min-width: 700px)')
  const [drawer, setDrawer] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const list = { checked, onCheckedChange: setChecked, searchRef }
  const [sheet, setSheet] = useState(false)
  const [labelMenu, setLabelMenu] = useState<LabelMenu>(null)
  const readingRef = useRef<HTMLDivElement>(null)
  const replyRef = useRef<ReplyHandle>(null)
  useBootstrapCorrespondents(useAccounts().data ?? [])
  const { rows } = useThreadList(search)
  usePreload(rows, thread)

  const queryClient = useQueryClient()
  const settings = useQuery(settingsOptions).data
  useEffect(() => {
    // The popup's Settings page lives in another document.
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (isSettingsChange(changes, area)) void queryClient.invalidateQueries({ queryKey: settingsOptions.queryKey })
    }
    browser.storage.onChanged.addListener(onChanged)
    return () => browser.storage.onChanged.removeListener(onChanged)
  }, [queryClient])
  // Unknown until loaded: nothing is marked on a guess.
  const { engage, keepUnread } = useMarkRead(useOpenThread(thread).data, settings?.markRead ?? 'manual')
  const actions = useMailActions({ checked, onCheckedChange: setChecked, keepUnread })
  usePopoutShortcuts({
    rows,
    search,
    checked,
    setChecked,
    navigate: (next) => void navigate({ search: next }),
    actions,
    engage,
    focusReading: () => readingRef.current?.focus(),
    openReply: (mode) => replyRef.current?.open(mode),
    openLabelMenu: setLabelMenu,
    searchRef,
    showSheet: () => setSheet(true),
    enabled: () => !sheet,
  })
  const pane = { actions, engage, labelMenu, onLabelMenuChange: setLabelMenu, replyRef, scrollRef: readingRef }

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

  const sheetEl = <ShortcutSheet open={sheet} onOpenChange={setSheet} />

  if (!medium) {
    return (
      <div className="relative flex h-screen flex-col">
        {sheetEl}
        {thread ? (
          <>
            <div className="flex h-12 shrink-0 items-center border-b border-foreground/10 px-2">
              <Button variant="ghost" size="icon" title="Back" onClick={clearThread}>
                <ArrowLeftIcon />
              </Button>
            </div>
            <ReadingPane {...pane} />
          </>
        ) : (
          <ListColumn {...list} onToggleSidebar={() => setDrawer(!drawer)} />
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
      {sheetEl}
      {wide && (
        <div className="min-h-0 overflow-y-auto border-r border-foreground/10">
          <Sidebar />
        </div>
      )}
      <div className="flex min-h-0 flex-col border-r border-foreground/10">
        <ListColumn {...list} onToggleSidebar={wide ? undefined : () => setDrawer(!drawer)} />
      </div>
      <div className="flex min-h-0 flex-col">
        <ReadingPane {...pane} />
      </div>
      {!wide && drawer && <SidebarOverlay onClose={() => setDrawer(false)} />}
    </div>
  )
}

function ListColumn({
  onToggleSidebar,
  ...list
}: { onToggleSidebar?: () => void } & React.ComponentProps<typeof ThreadList>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onToggleSidebar && (
        <div className="flex h-12 shrink-0 items-center border-b border-foreground/10 px-2">
          <Button variant="ghost" size="icon" title="Show sidebar" onClick={onToggleSidebar}>
            <PanelLeftIcon />
          </Button>
        </div>
      )}
      <ThreadList {...list} />
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
