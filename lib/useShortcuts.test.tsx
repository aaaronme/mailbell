import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useShortcuts } from './useShortcuts'

function Harness({ onArchive }: { onArchive: () => void }) {
  useShortcuts({ e: onArchive })
  return <input aria-label="field" />
}

function Sequence({ shortcuts }: { shortcuts: Record<string, () => void> }) {
  useShortcuts(shortcuts)
  return <input aria-label="field" />
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('useShortcuts', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('runs a two-key sequence', async () => {
    const fn = vi.fn()
    await render(<Sequence shortcuts={{ 'g i': fn }} />)
    press(document.body, 'g')
    press(document.body, 'i')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('sequence times out', async () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    await render(<Sequence shortcuts={{ 'g i': fn }} />)
    press(document.body, 'g')
    vi.advanceTimersByTime(1001)
    press(document.body, 'i')
    expect(fn).not.toHaveBeenCalled()
  })

  it('a non-matching second key is dropped, not run on its own', async () => {
    const a = vi.fn()
    const b = vi.fn()
    await render(<Sequence shortcuts={{ 'g i': a, j: b }} />)
    press(document.body, 'g')
    press(document.body, 'j')
    expect(b).not.toHaveBeenCalled()
    expect(a).not.toHaveBeenCalled()
  })

  it('keys of a sequence typed in a field do not trigger it', async () => {
    const fn = vi.fn()
    const screen = await render(<Sequence shortcuts={{ 'g i': fn }} />)
    const field = screen.getByLabelText('field').element()
    press(field, 'g')
    press(field, 'i')
    press(document.body, 'i')
    expect(fn).not.toHaveBeenCalled()
  })

  it('a prefix pressed before a hook mounts does not complete a sequence in it', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const before = await render(<Sequence shortcuts={{ 'g i': first }} />)
    press(document.body, 'g')
    await before.unmount()
    await render(<Sequence shortcuts={{ 'g i': second }} />)
    press(document.body, 'i')
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  it('leaves Enter to a focused control, but not other keys', async () => {
    const enter = vi.fn()
    const e = vi.fn()
    const screen = await render(
      <>
        <Sequence shortcuts={{ Enter: enter, e }} />
        <button type="button">act</button>
        <a href="#x">link</a>
      </>,
    )
    for (const el of [screen.getByRole('button', { name: 'act' }).element(), screen.getByRole('link').element()]) {
      press(el, 'Enter')
    }
    expect(enter).not.toHaveBeenCalled()
    press(document.body, 'Enter')
    expect(enter).toHaveBeenCalledOnce()
    press(screen.getByRole('button', { name: 'act' }).element(), 'e')
    expect(e).toHaveBeenCalledOnce()
  })

  it('ignores a capital letter without Shift (CapsLock) and keys while composing', async () => {
    const fn = vi.fn()
    await render(<Sequence shortcuts={{ U: fn, e: fn }} />)
    press(document.body, 'U')
    press(document.body, 'e', { isComposing: true })
    expect(fn).not.toHaveBeenCalled()
    press(document.body, 'U', { shiftKey: true })
    expect(fn).toHaveBeenCalledOnce()
  })

  it('leaves the default alone when the handler returns false', async () => {
    await render(<Sequence shortcuts={{ '/': () => false }} />)
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })
})
