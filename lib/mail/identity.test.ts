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

  it('uses only the first mx.google.com header', () => {
    const id = senderIdentity(
      [
        auth('mx.google.com; dkim=pass header.i=@a.com; dmarc=pass header.from=a.com'),
        auth('other.example; dkim=fail; dmarc=fail header.from=a.com'),
      ],
      'x@a.com',
    )
    expect(id.status).toBe('verified')
  })

  it('ignores a leading header from another authserv-id', () => {
    const id = senderIdentity(
      [auth('other.example; dmarc=fail'), auth('mx.google.com; dkim=pass header.d=a.com; dmarc=pass header.from=a.com')],
      'x@a.com',
    )
    expect(id.status).toBe('verified')
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

  it('reads signedBy from DKIM-Signature and mailedBy from Return-Path', () => {
    const id = senderIdentity(
      [
        { name: 'DKIM-Signature', value: 'v=1; a=rsa-sha256; d=mail.a.com; s=x' },
        { name: 'Return-Path', value: '<bounce@mta.a.com>' },
      ],
      'x@a.com',
    )
    expect(id.signedBy).toBe('mail.a.com')
    expect(id.mailedBy).toBe('a.com')
  })

  it('tls from Received headers', () => {
    expect(senderIdentity([], 'x@a.com').tls).toBeUndefined()
    expect(senderIdentity([{ name: 'Received', value: 'by x with ESMTPS id 1' }], 'x@a.com').tls).toBe(true)
    expect(senderIdentity([{ name: 'Received', value: 'by x with SMTP id 1' }], 'x@a.com').tls).toBe(false)
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
  it.each([
    ['springfield.gov.x7.ru', 'x7.ru'],
    ['a.b.co.uk', 'b.co.uk'],
    ['x@mail.github.com', 'github.com'],
    ['localhost', 'localhost'],
  ])('%s -> %s', (input, expected) => {
    expect(registrableDomain(input)).toBe(expected)
  })
})

describe('splitAddress', () => {
  it('splits local, host and registrable domain', () => {
    expect(splitAddress('a@mail.github.com')).toEqual({ local: 'a', host: 'mail.github.com', domain: 'github.com' })
  })
})
