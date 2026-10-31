import { toast } from 'sonner'
import { ACTION_TEXT, actionVerb, applyAction, inverse, type ActionTarget, type MailAction } from './actions'

interface Entry {
  a: MailAction
  targets: ActionTarget[]
}

// Single level: a newer action replaces the older one's Undo. Overlapping
// actions complete independently, so the latest is whichever succeeded last.
let latest: Entry | null = null

export async function runUndoable(a: MailAction, targets: ActionTarget[]): Promise<void> {
  try {
    await applyAction(a, targets)
  } catch {
    toast.error(`Couldn't ${actionVerb(a)}. Try again.`)
    return
  }
  latest = { a, targets }
  toast(ACTION_TEXT(a, targets.length), {
    id: 'undo',
    duration: 6000,
    action: { label: 'Undo', onClick: () => void undoLatest() },
  })
}

export async function undoLatest(): Promise<void> {
  const entry = latest
  if (!entry) return
  latest = null
  const back = inverse(entry.a)
  try {
    await applyAction(back, entry.targets)
  } catch {
    toast.error(`Couldn't undo. Try again.`)
    return
  }
  toast('Undone', { id: 'undo', duration: 2000 })
}

export async function runSilent(a: MailAction, targets: ActionTarget[]): Promise<void> {
  await applyAction(a, targets)
}
