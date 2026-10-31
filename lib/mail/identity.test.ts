import { describe, expect, it } from 'vitest'
import { registrableDomain, senderIdentity, splitAddress } from './identity'

const auth = (value: string) => ({ name: 'Authentication-Results', value })

describe('senderIdentity', () => {
  it('verified when dmarc passes with aligned dkim', () => {
    const id = senderIdentity(
      [
        auth(
          'mx.google.com; dkim=pass header.i=@mail.springfield.gov; spf=pass smtp.mailfrom=bounce.springfield.gov; dmarc=pass header.from=springfield.gov',
        ),
      ],
      'notices@mail.springfield.gov',
    )
    expect(id.status).toBe('verified')
    expect(id.fromDomain).toBe('springfield.gov')
    expect(id.via).toBeUndefined()
  })

  it('failed on dmarc fail', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=pass header.i=@a.com; spf=softfail smtp.mailfrom=a.com; dmarc=fail header.from=a.com')],
      'x@a.com',
    )
    expect(id.status).toBe('failed')
  })

  it('does not treat softfail or neutral as failure', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=neutral; spf=softfail smtp.mailfrom=a.com; dmarc=none header.from=a.com')],
      'x@a.com',
    )
    expect(id).toMatchObject({ status: 'unverified', reason: 'No DMARC policy' })
  })

  it('uses only the first Authentication-Results header', () => {
    const pass = auth('mx.google.com; dkim=pass header.i=@a.com; dmarc=pass header.from=a.com')
    const fail = auth('mx.google.com; dkim=fail header.i=@a.com; dmarc=fail header.from=a.com')
    expect(senderIdentity([fail, pass], 'x@a.com').status).toBe('failed')
    expect(senderIdentity([pass, fail], 'x@a.com').status).toBe('verified')
  })

  it('is unverified when a foreign Authentication-Results comes first', () => {
    const id = senderIdentity(
      [auth('evil.example; dmarc=pass header.from=a.com; dkim=pass header.d=a.com'), auth('mx.google.com; dmarc=pass header.from=a.com; dkim=pass header.d=a.com')],
      'x@a.com',
    )
    expect(id).toMatchObject({ status: 'unverified', reason: 'Not checked by Gmail' })
  })

  it('ignores method=result text inside comments', () => {
    const id = senderIdentity(
      [auth('mx.google.com; spf=pass (google.com: domain of dmarc=pass@evil.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=evil.com')],
      'x@evil.com',
    )
    expect(id.status).toBe('unverified')
  })

  it('ignores properties injected through comments', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=pass (header.d=victim.com) header.d=evil.com; dmarc=pass (x header.from=victim.com) header.from=evil.com')],
      'x@victim.com',
    )
    expect(id.status).toBe('unverified')
    expect(id.signedBy).toBe('evil.com')
  })

  it('handles nested comments and quoted strings', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=pass (a (b dmarc=pass) c) header.d=a.com; dmarc=fail (")") header.from=a.com')],
      'x@a.com',
    )
    expect(id.status).toBe('failed')
  })

  it('reads results case-insensitively', () => {
    const id = senderIdentity([auth('MX.Google.COM; DKIM=PASS header.d=A.com; DMARC=PASS header.from=a.COM')], 'x@a.com')
    expect(id.status).toBe('verified')
  })

  it('reads header.from only from the dmarc segment', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=pass header.d=evil.com header.from=evil.com; dmarc=pass header.from=a.com')],
      'x@evil.com',
    )
    expect(id.status).toBe('unverified')
  })

  it('unverified when the authenticated header.from is not the displayed domain', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=pass header.d=evil.com; dmarc=pass header.from=evil.com')],
      'x@victim.com',
    )
    expect(id.status).toBe('unverified')
  })

  it('does not report a dmarc error as a missing policy', () => {
    const id = senderIdentity([auth('mx.google.com; dmarc=temperror header.from=a.com')], 'x@a.com')
    expect(id.status).toBe('unverified')
    expect(id.reason).not.toBe('No DMARC policy')
  })

  it('missing header is unverified', () => {
    expect(senderIdentity([], 'x@a.com')).toMatchObject({ status: 'unverified', reason: 'Not checked by Gmail' })
  })

  it('unverified when dmarc passes without alignment', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=pass header.d=sendgrid.net; spf=pass smtp.mailfrom=sendgrid.net; dmarc=pass header.from=shop.com')],
      'x@shop.com',
    )
    expect(id).toMatchObject({ status: 'unverified', reason: 'Checks passed without alignment' })
  })

  it('verified by spf alignment', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=none; spf=pass smtp.mailfrom=bounce.shop.com; dmarc=pass header.from=shop.com')],
      'x@shop.com',
    )
    expect(id.status).toBe('verified')
  })

  it('via when signed by another domain', () => {
    const id = senderIdentity(
      [auth('mx.google.com; dkim=pass header.i=@sendgrid.net; spf=pass smtp.mailfrom=sendgrid.net; dmarc=pass header.from=shop.com')],
      'x@shop.com',
    )
    expect(id.via).toBe('sendgrid.net')
    expect(id.signedBy).toBe('sendgrid.net')
  })

  it('does not trust a DKIM-Signature header for signedBy; reads mailedBy from Return-Path', () => {
    const id = senderIdentity(
      [
        { name: 'DKIM-Signature', value: 'v=1; a=rsa-sha256; d=mail.a.com; s=x' },
        { name: 'Return-Path', value: '<bounce@mta.a.com>' },
      ],
      'x@a.com',
    )
    expect(id.signedBy).toBeUndefined()
    expect(id.mailedBy).toBe('a.com')
  })

  it('tls from Received headers', () => {
    expect(senderIdentity([], 'x@a.com').tls).toBeUndefined()
    expect(senderIdentity([{ name: 'Received', value: 'by x with ESMTPS id 1' }], 'x@a.com').tls).toBe(true)
    expect(senderIdentity([{ name: 'Received', value: 'by x with SMTP id 1' }], 'x@a.com').tls).toBe(false)
    // Only the topmost hop, the one Gmail made, counts.
    const hops = [
      { name: 'Received', value: 'by mx.google.com with SMTP id 2' },
      { name: 'Received', value: 'by x with ESMTPS id 1' },
    ]
    expect(senderIdentity(hops, 'x@a.com').tls).toBe(false)
  })

  it('replyToMismatch when registrable domains differ', () => {
    const id = senderIdentity([{ name: 'Reply-To', value: 'x@gmail.com' }], 'ceo@corp.com')
    expect(id.replyTo).toBe('x@gmail.com')
    expect(id.replyToMismatch).toBe(true)
    const same = senderIdentity([{ name: 'Reply-To', value: 'Boss <x@mail.corp.com>' }], 'ceo@corp.com')
    expect(same.replyToMismatch).toBe(false)
  })
})

describe('registrableDomain', () => {
  it('treats private suffixes as registrable', () => {
    expect(registrableDomain('a.github.io')).toBe('a.github.io')
    expect(registrableDomain('a.github.io')).not.toBe(registrableDomain('b.github.io'))
  })

  it.each([
    ['springfield.gov.x7.ru', 'x7.ru'],
    ['a.b.co.uk', 'b.co.uk'],
    ['x@mail.github.com', 'github.com'],
    ['localhost', 'localhost'],
    ['1.2.3.4', '1.2.3.4'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(registrableDomain(input)).toBe(expected)
  })
})

describe('splitAddress', () => {
  it('splits local, host and registrable domain', () => {
    expect(splitAddress('a@mail.github.com')).toEqual({ local: 'a', host: 'mail.github.com', domain: 'github.com' })
  })
})
