import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import type { OpenThread } from '../api/mailbox'

vi.mock('./undo', () => ({ runSilent: vi.fn(async () => undefined), runUndoable: vi.fn() }))

const { runSilent } = await import('./undo')
const { useMarkRead } = await import('./markRead')

const thread = (id: string, labelIds = ['INBOX', 'UNREAD']) =>
  ({ url: `https://mail.google.com/mail/?authuser=a%40x.com#inbox/${id}`, account: 'a@x.com', labelIds }) as OpenThread

describe('useMarkRead', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(runSilent).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  type Mode = 'delay' | 'immediate' | 'manual'
  const mount = (t: OpenThread | undefined, mode: Mode) =>
    renderHook((p?: { t: OpenThread | undefined; mode: Mode }) => useMarkRead(p!.t, p!.mode), {
      initialProps: { t, mode },
    })

  it('marks read after 2000 ms in delay mode', async () => {
    await mount(thread('A'), 'delay')
    vi.advanceTimersByTime(1999)
    expect(runSilent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(runSilent).toHaveBeenCalledTimes(1)
    expect(runSilent).toHaveBeenCalledWith({ kind: 'read' }, [
      { account: 'a@x.com', threadId: 'A', url: thread('A').url },
    ])
  })

  it('cancels when the thread changes first', async () => {
    const view = await mount(thread('A'), 'delay')
    vi.advanceTimersByTime(1500)
    await view.rerender({ mode: 'delay', t: thread('B') })
    vi.advanceTimersByTime(1999)
    expect(runSilent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(runSilent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runSilent).mock.calls[0]![1][0]!.threadId).toBe('B')
  })

  it('marks at once on engage and not again later', async () => {
    const view = await mount(thread('A'), 'delay')
    vi.advanceTimersByTime(100)
    view.result.current.engage()
    expect(runSilent).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(runSilent).toHaveBeenCalledTimes(1)
  })

  it('marks at once in immediate mode', async () => {
    await mount(thread('A'), 'immediate')
    expect(runSilent).toHaveBeenCalledTimes(1)
  })

  it('never marks in manual mode, even on engage', async () => {
    const view = await mount(thread('A'), 'manual')
    view.result.current.engage()
    vi.advanceTimersByTime(5000)
    expect(runSilent).not.toHaveBeenCalled()
  })

  it('never marks a thread that is already read', async () => {
    const view = await mount(thread('A', ['INBOX']), 'immediate')
    view.result.current.engage()
    vi.advanceTimersByTime(5000)
    expect(runSilent).not.toHaveBeenCalled()
  })

  it('treats selecting the same thread again as a new selection', async () => {
    const view = await mount(thread('A'), 'immediate')
    expect(runSilent).toHaveBeenCalledTimes(1)
    await view.rerender({ mode: 'immediate', t: undefined })
    await view.rerender({ mode: 'immediate', t: thread('A') })
    expect(runSilent).toHaveBeenCalledTimes(2)
  })

  it('starts the delay when settings arrive after the thread', async () => {
    const view = await mount(thread('A'), 'manual')
    vi.advanceTimersByTime(3000)
    await view.rerender({ t: thread('A'), mode: 'delay' })
    vi.advanceTimersByTime(1999)
    expect(runSilent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(runSilent).toHaveBeenCalledTimes(1)
  })

  it('tries again on the next engage after a failure', async () => {
    vi.mocked(runSilent).mockRejectedValueOnce(new Error('offline'))
    const view = await mount(thread('A'), 'manual')
    await view.rerender({ t: thread('A'), mode: 'delay' })
    vi.advanceTimersByTime(2000)
    await vi.advanceTimersByTimeAsync(0)
    view.result.current.engage()
    expect(runSilent).toHaveBeenCalledTimes(2)
  })

  it('leaves a thread marked unread during the delay alone', async () => {
    const view = await mount(thread('A'), 'delay')
    vi.advanceTimersByTime(500)
    view.result.current.keepUnread()
    vi.advanceTimersByTime(5000)
    view.result.current.engage()
    expect(runSilent).not.toHaveBeenCalled()
  })
})
