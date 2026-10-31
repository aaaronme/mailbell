import { useEffect, useRef } from 'react'

// A two-key sequence is written 'g i'. The first key only waits, for up to
// this long, for the second; a prefix is kept per hook so it never leaks.
const SEQUENCE_MS = 1000

// Gmail's single-key shortcuts, by KeyboardEvent.key ('j', '#', 'I').
// Typing in a field, a key with Ctrl/Cmd/Alt, or a key an open menu or a
// focused control already handled never triggers one; Enter on a focused
// control is left to activate it. A handler may return false to leave the
// key's default alone. `enabled` can be a
// function, asked at the moment of the key press.
export function useShortcuts(shortcuts: Record<string, () => unknown>, enabled: boolean | (() => boolean) = true) {
  // The latest handlers without re-adding the listener on every render.
  const current = useRef({ shortcuts, enabled })
  current.current = { shortcuts, enabled }
  const pending = useRef<{ prefix: string; at: number } | null>(null)
  const listening = enabled !== false
  useEffect(() => {
    if (!listening) return
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.defaultPrevented || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return
      // A capital without Shift is CapsLock, not the Shift binding.
      if (/^[A-Z]$/.test(ev.key) && !ev.shiftKey) return
      const { shortcuts, enabled } = current.current
      if (typeof enabled === 'function' && !enabled()) return
      const target = ev.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable], [role=menu]')) return
      if (ev.key === 'Enter' && target.closest('a[href], button, [role=button], [role=checkbox], [role=menuitem], summary')) return
      const now = Date.now()
      const prefix = pending.current && now - pending.current.at <= SEQUENCE_MS ? pending.current.prefix : null
      pending.current = null
      if (prefix) {
        const run = shortcuts[`${prefix} ${ev.key}`]
        // A prefix and a key it does not pair with are both dropped.
        if (run && run() !== false) ev.preventDefault()
        return
      }
      if (Object.keys(shortcuts).some((key) => key.startsWith(`${ev.key} `))) {
        pending.current = { prefix: ev.key, at: now }
        return
      }
      const run = shortcuts[ev.key]
      if (!run) return
      if (run() !== false) ev.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [listening])
}
