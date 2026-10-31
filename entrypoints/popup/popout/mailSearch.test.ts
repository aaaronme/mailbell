import { describe, it, expect } from 'vitest'
import { validateMailSearch } from './mailSearch'

describe('validateMailSearch', () => {
  it('defaults to the all-accounts primary inbox', () => {
    expect(validateMailSearch({})).toEqual({ account: 'all', folder: 'INBOX', cat: 'primary' })
  })

  it('drops the category outside the inbox', () => {
    expect(validateMailSearch({ folder: 'SENT', cat: 'social' }).cat).toBeUndefined()
  })

  it('falls back to primary for an unknown category', () => {
    expect(validateMailSearch({ cat: 'bogus' }).cat).toBe('primary')
  })

  it('keeps query, unread and thread', () => {
    expect(validateMailSearch({ q: 'x', unread: true, thread: 't', account: 'a@b.c' })).toMatchObject({
      q: 'x',
      unread: true,
      thread: 't',
      account: 'a@b.c',
    })
  })
})
