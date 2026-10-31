import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFastPoll, FAST_POLL_MS, isVisibleMessage } from './fastPoll'

describe('fastPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('polls at once when a view becomes visible, then every 10 s', async () => {
    const poll = vi.fn(async () => {})
    const fast = createFastPoll(poll)
    expect(FAST_POLL_MS).toBe(10_000)
    fast.setVisible('t1', true)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(poll).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('stops when the last view is hidden', async () => {
    const poll = vi.fn(async () => {})
    const fast = createFastPoll(poll)
    fast.setVisible('t1', true)
    await vi.advanceTimersByTimeAsync(25_000)
    expect(poll).toHaveBeenCalledTimes(3)
    fast.setVisible('t1', false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(poll).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('keeps polling while another view is visible', async () => {
    const poll = vi.fn(async () => {})
    const fast = createFastPoll(poll)
    fast.setVisible('t1', true)
    fast.setVisible('popup', true)
    // A second visible view is not a 0 -> 1 change: no extra poll.
    expect(poll).toHaveBeenCalledTimes(1)
    fast.setVisible('t1', false)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('stops when the last visible view is dropped', async () => {
    const poll = vi.fn(async () => {})
    const fast = createFastPoll(poll)
    fast.setVisible('t1', true)
    fast.setVisible('t2', false)
    fast.drop('t1')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(poll).toHaveBeenCalledTimes(1)
  })

  it('waits 10 s after a slow poll resolves, never overlapping', async () => {
    let running = 0
    let overlapped = false
    const starts: number[] = []
    const poll = vi.fn(async () => {
      overlapped ||= running > 0
      running++
      starts.push(Date.now())
      await new Promise((resolve) => setTimeout(resolve, 15_000))
      running--
    })
    const t0 = Date.now()
    const fast = createFastPoll(poll)
    fast.setVisible('t1', true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(overlapped).toBe(false)
    expect(starts.map((it) => it - t0)).toEqual([0, 25_000, 50_000])
  })

  it('keeps polling after a poll rejects', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const poll = vi.fn(async () => {
      if (poll.mock.calls.length === 1) throw new Error('offline')
    })
    const fast = createFastPoll(poll)
    fast.setVisible('t1', true)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('recognizes visibility messages and ignores the heartbeat', () => {
    expect(isVisibleMessage({ type: 'visible', visible: false })).toBe(true)
    expect(isVisibleMessage('heartbeat')).toBe(false)
    expect(isVisibleMessage(null)).toBe(false)
    expect(isVisibleMessage({ type: 'other' })).toBe(false)
  })

  it('a view shown again mid-poll does not start a second one', async () => {
    let release!: () => void
    const poll = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const fast = createFastPoll(poll)
    fast.setVisible('t1', true)
    fast.setVisible('t1', false)
    fast.setVisible('t1', true)
    expect(poll).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(poll).toHaveBeenCalledTimes(2)
  })
})
