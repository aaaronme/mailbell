import { Dialog as DialogPrimitive } from 'radix-ui'

const GROUPS: { title: string; rows: [keys: string, what: string][] }[] = [
  {
    title: 'Navigate',
    rows: [
      ['j / k', 'Next / previous conversation'],
      ['Enter, o', 'Open and focus the conversation'],
      ['u', 'Back to the list'],
      ['/', 'Search'],
      ['g then i', 'Go to Inbox'],
      ['g then s', 'Go to Starred'],
      ['g then t', 'Go to Sent'],
      ['g then d', 'Go to Drafts'],
    ],
  },
  {
    title: 'Act',
    rows: [
      ['x', 'Select'],
      ['e', 'Archive'],
      ['#', 'Delete (Restore in Trash)'],
      ['!', 'Report spam (Not spam in Spam)'],
      ['s', 'Star / unstar'],
      ['Shift+U', 'Mark unread'],
      ['Shift+I', 'Mark read'],
      ['l', 'Label as'],
      ['v', 'Move to'],
      ['r', 'Reply'],
      ['a', 'Reply all'],
      ['z', 'Undo'],
      ['?', 'This list'],
    ],
  },
]

export function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/10" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="menu-surface fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-4 outline-none"
        >
          <DialogPrimitive.Title className="mb-3 text-sm font-medium">Keyboard shortcuts</DialogPrimitive.Title>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {GROUPS.map((group) => (
              <section key={group.title}>
                <h3 className="mb-1 text-xs text-foreground/60">{group.title}</h3>
                <dl>
                  {group.rows.map(([keys, what]) => (
                    <div key={keys} className="flex items-baseline justify-between gap-4 py-1 text-sm">
                      <dt className="text-foreground/70">{what}</dt>
                      <dd className="shrink-0 font-mono text-xs">{keys}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
