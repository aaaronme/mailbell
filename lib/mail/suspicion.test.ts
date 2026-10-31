import { describe, expect, it } from 'vitest'
import type { SenderIdentity } from './identity'
import { isLookalike, nameSpoofs, REASON_TEXT, suspicionOf } from './suspicion'

const identity = (status: SenderIdentity['status'], fromDomain = 'x.com'): SenderIdentity => ({
  status,
  fromDomain,
  replyToMismatch: false,
})

describe('isLookalike', () => {
  it('flags digit and glyph swaps', () => {
    expect(isLookalike('paypa1.com', new Set(['paypal.com']))).toBe(true)
    expect(isLookalike('rnicrosoft.com', new Set(['microsoft.com']))).toBe(true)
    expect(isLookalike('vvikipedia.org', new Set(['wikipedia.org']))).toBe(true)
  })
  it('flags a single edit', () => {
    expect(isLookalike('paypall.com', new Set(['paypal.com']))).toBe(true)
    expect(isLookalike('paypla.com', new Set(['paypal.com']))).toBe(true)
  })
  it('never flags a known domain itself, even when another known one is near', () => {
    expect(isLookalike('paypal.com', new Set(['paypal.com']))).toBe(false)
    expect(isLookalike('paypal.com', new Set(['paypa1.com', 'paypal.com']))).toBe(false)
  })
  it('ignores distant domains', () => {
    expect(isLookalike('github.com', new Set(['gitlab.com']))).toBe(false)
  })
  it('compares registrable domains, not subdomains', () => {
    expect(isLookalike('mail.paypal.com', new Set(['paypal.com']))).toBe(false)
    expect(isLookalike('mail.paypa1.com', new Set(['paypal.com']))).toBe(true)
  })
  it('catches IDN homoglyphs in unicode and punycode form', () => {
    expect(isLookalike('pаypal.com', new Set(['paypal.com']))).toBe(true) // Cyrillic а
    expect(isLookalike('xn--pypal-4ve.com', new Set(['paypal.com']))).toBe(true)
  })
})

describe('nameSpoofs', () => {
  it('flags a name that shows a different address', () => {
    expect(nameSpoofs('support@paypal.com', 'x@evil.ru')).toBe(true)
  })
  it('allows plain names and the matching address', () => {
    expect(nameSpoofs('Bob', 'bob@x.com')).toBe(false)
    expect(nameSpoofs('bob@x.com', 'bob@x.com')).toBe(false)
    expect(nameSpoofs('Bob@X.com', 'bob@x.com')).toBe(false)
  })
  it('does not trip on punctuation around the sender’s own address', () => {
    for (const name of ['Bob (bob@x.com)', 'Smith,bob@x.com', '"bob@x.com"', 'Smith;bob@x.com', 'bob@x.com:', '[bob@x.com]'])
      expect(nameSpoofs(name, 'bob@x.com'), name).toBe(false)
  })
  it('still flags another address in the same forms', () => {
    for (const name of ['Bob (ceo@y.com)', 'Smith,ceo@y.com', '"ceo@y.com"', 'Smith;ceo@y.com', '[ceo@y.com]'])
      expect(nameSpoofs(name, 'bob@x.com'), name).toBe(true)
  })
  it('sees through fullwidth lookalike characters', () => {
    expect(nameSpoofs('support＠paypal.com', 'x@evil.ru')).toBe(true)
    expect(nameSpoofs('bob＠x.com', 'bob@x.com')).toBe(false)
  })
})

describe('suspicionOf', () => {
  const base = {
    labelIds: [] as string[],
    identity: identity('verified'),
    senderName: 'Bob',
    senderEmail: 'bob@x.com',
    knownDomains: new Set<string>(),
  }
  it('is empty for ordinary mail', () => {
    expect(suspicionOf(base)).toEqual([])
  })
  it('reports spam and failed auth in order', () => {
    expect(suspicionOf({ ...base, labelIds: ['SPAM'], identity: identity('failed') })).toEqual(['spam', 'auth-failed'])
  })
  it('reports name spoofing and lookalikes', () => {
    expect(
      suspicionOf({
        ...base,
        senderName: 'a@paypal.com',
        identity: identity('verified', 'paypa1.com'),
        knownDomains: new Set(['paypal.com']),
      }),
    ).toEqual(['name-spoof', 'lookalike'])
  })
  it('has text for every reason', () => {
    expect(REASON_TEXT).toEqual({
      spam: 'This is in Spam',
      'auth-failed': 'This mail failed sender checks',
      'name-spoof': "The sender's name shows a different address",
      lookalike: "This domain looks like one you've written to",
    })
  })
  it('survives malformed punycode labels', () => {
    for (const d of ['xn--:::.com', 'xn--9999999999999999999999.com', 'xn--.com'])
      expect(() => isLookalike(d, new Set(['paypal.com'])), d).not.toThrow()
  })
})
