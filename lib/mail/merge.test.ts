import { describe, expect, it } from 'vitest'
import type { ThreadRow } from '../api/mailbox'
import { mergeInboxes, type AccountPages } from './merge'

// Hours after a fixed origin, so the abstract 9.5 is a real timestamp.
const at = (hours: number) => new Date(Date.UTC(2026, 0, 1) + hours * 3_600_000).toISOString()
const row = (account: string, hours: number) =>
  ({ account, threadId: `${account}${hours}`, date: at(hours) }) as ThreadRow
const pages = (account: string, hours: number[], exhausted: boolean): AccountPages => ({
  account,
  rows: hours.map((it) => row(account, it)),
  exhausted,
})
const hoursOf = (rows: ThreadRow[]) => rows.map((it) => (Date.parse(it.date) - Date.UTC(2026, 0, 1)) / 3_600_000)

describe('mergeInboxes', () => {
  it('cuts at the latest oldest date', () => {
    const merged = mergeInboxes([pages('A', [10, 9, 8], false), pages('B', [9.5, 5], false)])
    expect(hoursOf(merged.rows)).toEqual([10, 9.5, 9, 8])
    expect(merged.limiting).toEqual(['A'])
  })

  it("exhausted accounts don't hold the cut", () => {
    const merged = mergeInboxes([pages('A', [10, 9, 8], false), pages('B', [9.5, 5], true)])
    // B's 5 stays held back: A may still hold mail between 8 and 5.
    expect(hoursOf(merged.rows)).toEqual([10, 9.5, 9, 8])
    expect(merged.limiting).toEqual(['A'])
  })

  it('all exhausted shows everything', () => {
    const merged = mergeInboxes([pages('A', [10, 8], true), pages('B', [9], true)])
    expect(hoursOf(merged.rows)).toEqual([10, 9, 8])
    expect(merged.limiting).toEqual([])
  })

  it('an empty account that is exhausted is ignored', () => {
    const merged = mergeInboxes([pages('A', [10, 8], false), pages('B', [], true)])
    expect(hoursOf(merged.rows)).toEqual([10, 8])
    expect(merged.limiting).toEqual(['A'])
  })

  it('an account with nothing loaded yet holds every row back and is paged first', () => {
    const merged = mergeInboxes([pages('A', [10, 8], false), pages('B', [], false)])
    expect(merged.rows).toEqual([])
    expect(merged.limiting).toEqual(['B'])
  })

  it('accounts tied on the oldest date are all limiting, and equal dates sort by account then thread', () => {
    const merged = mergeInboxes([pages('B', [9, 8], false), pages('A', [9, 8], false)])
    expect(merged.rows.map((it) => it.threadId)).toEqual(['A9', 'B9', 'A8', 'B8'])
    expect(merged.limiting).toEqual(['A', 'B'])
  })
})
