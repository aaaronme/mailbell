import type { RefObject } from 'react'
import type { ThreadRow } from '@/lib/api/mailbox'
import { undoLatest } from '@/lib/mail/undo'
import { useShortcuts } from '@/lib/useShortcuts'
import { validateMailSearch, type MailSearch } from './mailSearch'
import type { MailActions } from './useMailActions'

export interface PopoutShortcutContext {
  rows: ThreadRow[]
  search: MailSearch
  checked: Set<string>
  setChecked: (next: Set<string>) => void
  navigate: (search: (prev: MailSearch) => MailSearch) => void
  actions: MailActions
  // Marks the open thread read per the setting.
  engage: () => void
  focusReading: () => void
  openReply: (mode: 'reply' | 'all') => void
  openLabelMenu: (kind: 'label' | 'move') => void
  searchRef: RefObject<HTMLInputElement | null>
  showSheet: () => void
  // False while the sheet is up; a menu already swallows its own keys.
  enabled: () => boolean
}

// Gmail's keys for the popout. Every action goes through `actions`, the same
// path as the reading pane's buttons, so checked threads and undo behave alike.
export function usePopoutShortcuts(ctx: PopoutShortcutContext) {
  const { rows, search, checked, actions } = ctx
  const at = rows.findIndex((it) => it.url === search.thread)
  const select = (url: string | undefined) => ctx.navigate((prev) => ({ ...prev, thread: url }))
  const step = (by: 1 | -1) => () => {
    const next = at < 0 ? rows[0] : rows[at + by]
    if (next) select(next.url)
  }
  const toggleSelected = () => {
    const url = rows[at]?.url
    if (!url) return
    const next = new Set(checked)
    if (!next.delete(url)) next.add(url)
    ctx.setChecked(next)
  }
  const engageAndFocus = () => {
    if (!search.thread) return
    ctx.engage()
    ctx.focusReading()
  }
  const go = (folder: string) => () =>
    ctx.navigate(() =>
      search.account === 'all'
        ? validateMailSearch({ account: 'all', folder: 'INBOX' })
        : validateMailSearch({ account: search.account, folder }),
    )
  const openMenu = (kind: 'label' | 'move') => () => {
    if (search.thread) ctx.openLabelMenu(kind)
  }
  const unread = () => actions.run({ kind: 'unread' })

  useShortcuts(
    {
      j: step(1),
      k: step(-1),
      Enter: engageAndFocus,
      o: engageAndFocus,
      u: () => select(undefined),
      x: toggleSelected,
      e: () => void actions.archive(),
      '#': () => void actions.trash(),
      Delete: () => void actions.trash(),
      Backspace: () => void actions.trash(),
      '!': () => void actions.spam(),
      s: () => void actions.toggleStar(),
      U: () => void unread(),
      I: () => void actions.run({ kind: 'read' }),
      z: () => void undoLatest(),
      r: () => ctx.openReply('reply'),
      a: () => ctx.openReply('all'),
      // Part 2 maps `c` to Mailbell's own compose; newEmail() would open Gmail.
      '/': () => ctx.searchRef.current?.focus(),
      'g i': go('INBOX'),
      'g s': go('STARRED'),
      'g t': go('SENT'),
      'g d': go('DRAFT'),
      '?': ctx.showSheet,
      l: openMenu('label'),
      v: openMenu('move'),
    },
    ctx.enabled,
  )
}
