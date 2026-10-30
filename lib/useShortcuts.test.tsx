import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useShortcuts } from './useShortcuts'

function Harness({ onArchive }: { onArchive: () => void }) {
  useShortcuts({ e: onArchive })
  return <input aria-label="field" />
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('useShortcuts', () => {
  it('runs on a bare key, but not while typing or with a modifier', async () => {
    const onArchive = vi.fn()
    const screen = await render(<Harness onArchive={onArchive} />)
    press(document.body, 'e')
    expect(onArchive).toHaveBeenCalledOnce()
    press(screen.getByLabelText('field').element(), 'e')
    press(document.body, 'e', { metaKey: true })
    press(document.body, 'x')
    expect(onArchive).toHaveBeenCalledOnce()
  })
})
