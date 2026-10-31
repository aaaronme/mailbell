import { toast } from 'sonner'
import {
  ACTION_TEXT,
  actionVerb,
  applyAction,
  applyWithPatch,
  revertAction,
  type ActionTarget,
  type MailAction,
  type Patch,
} from './actions'

interface Entry {
  a: MailAction
  targets: ActionTarget[]
  patch: Patch
}

// Single level: a newer action replaces the older one's Undo. Overlapping
// actions complete independently, so the latest is whichever succeeded last.
let latest: Entry | null = null

export async function runUndoable(a: MailAction, targets: ActionTarget[]): Promise<void> {
  let patch: Patch
  try {
    patch = await applyWithPatch(a, targets)
  } catch {
    toast.error(`Couldn't ${actionVerb(a)}. Try again.`)
    return
  }
  latest = { a, targets, patch }
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
  try {
    await revertAction(entry.a, entry.targets, entry.patch)
  } catch {
    // Keep it retryable unless a newer action has taken the slot meanwhile.
    latest ??= entry
    toast.error("Couldn't undo. Try again.")
    return
  }
  toast('Undone', { id: 'undo', duration: 2000 })
}

export async function runSilent(a: MailAction, targets: ActionTarget[]): Promise<void> {
  await applyAction(a, targets)
}
