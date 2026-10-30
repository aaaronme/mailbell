import { useEffect, useRef } from 'react'

// Gmail's single-key shortcuts, by KeyboardEvent.key ('j', '#', 'I').
// Typing in a field, a key with Ctrl/Cmd/Alt, or a key an open menu or a
// focused control already handled never triggers one. `enabled` can be a
// function, asked at the moment of the key press.
export function useShortcuts(shortcuts: Record<string, () => void>, enabled: boolean | (() => boolean) = true) {
  // The latest handlers without re-adding the listener on every render.
  const current = useRef({ shortcuts, enabled })
  current.current = { shortcuts, enabled }
  const listening = enabled !== false
  useEffect(() => {
    if (!listening) return
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey) return
      const { shortcuts, enabled } = current.current
      if (typeof enabled === 'function' && !enabled()) return
      const target = ev.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable], [role=menu]')) return
      const run = shortcuts[ev.key]
      if (!run) return
      ev.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [listening])
}
