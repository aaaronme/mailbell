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

  it('ignores inherited property names as categories', () => {
    expect(validateMailSearch({ cat: 'toString' }).cat).toBe('primary')
  })

  it('coerces numbers (parsed from JSON-looking params) to strings', () => {
    expect(validateMailSearch({ q: 2024, account: 7, folder: 5 })).toMatchObject({ q: '2024', account: '7', folder: '5' })
  })

  it('drops empty strings, objects, arrays and unknown keys', () => {
    const out = validateMailSearch({ q: '', account: {}, folder: [], thread: '', extra: 'x' })
    expect(out).toEqual({ account: 'all', folder: 'INBOX', cat: 'primary' })
  })

  it('keeps unread only for true or "true"', () => {
    expect(validateMailSearch({ unread: true }).unread).toBe(true)
    expect(validateMailSearch({ unread: 'true' }).unread).toBe(true)
    for (const v of ['false', 1, 'garbage', false]) expect(validateMailSearch({ unread: v }).unread).toBeUndefined()
  })

  it('drops the category for a label-id folder', () => {
    expect(validateMailSearch({ folder: 'Label_12', cat: 'social' }).cat).toBeUndefined()
  })
})
