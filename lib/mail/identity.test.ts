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

  it('fails on a quoted local part that smuggles in segments', () => {
    for (const value of [
      'mx.google.com; spf=pass smtp.mailfrom="x; dmarc=pass header.from=victim.com; dkim=pass header.d=victim.com "@evil.com',
      'mx.google.com; spf=pass smtp.mailfrom="x; dmarc=pass header.from=victim.com"@evil.com',
    ]) {
      const id = senderIdentity([auth(value)], 'ceo@victim.com')
      expect(id, value).toMatchObject({ status: 'failed', reason: 'Authentication results could not be read' })
    }
  })

  it('fails when a quoted local part closes the Gmail comment early', () => {
    const local = '"a) ; dmarc=pass header.from=victim.com; dkim=pass header.d=victim.com; foo=(b"@evil.com'
    const id = senderIdentity(
      [auth(`mx.google.com; spf=pass (google.com: domain of ${local} designates 1.2.3.4 as permitted sender) smtp.mailfrom=${local}`)],
      'ceo@victim.com',
    )
    expect(id).toMatchObject({ status: 'failed', reason: 'Authentication results could not be read' })
    expect(id.signedBy).toBeUndefined()
  })

  it('does not let a quoted "(" hide or forge later segments', () => {
    const id = senderIdentity(
      [auth('mx.google.com; spf=pass smtp.mailfrom="(x"@evil.com; dmarc=fail header.from=victim.com; dkim=pass header.d=victim.com')],
      'ceo@victim.com',
    )
    expect(id.status).toBe('failed')
  })

  it('fails safe on quoted or unterminated header.i values', () => {
    const quoted = senderIdentity(
      [auth('mx.google.com; dkim=pass header.i="@victim.com"; dmarc=pass header.from=victim.com')],
      'ceo@victim.com',
    )
    expect(quoted.status).toBe('failed')
    const open = senderIdentity(
      [auth('mx.google.com; dkim=pass header.d=evil.com; spf=pass smtp.mailfrom="x; dmarc=pass header.from=victim.com')],
      'ceo@victim.com',
    )
    expect(open.status).toBe('failed')
  })

  it('fails when the results cannot be read', () => {
    const id = senderIdentity(
      [auth('mx.google.com; spf=pass (google.com: domain of "(x"@evil.com designates 1.2.3.4) smtp.mailfrom="(x"@evil.com; dmarc=fail header.from=evil.com')],
      'x@evil.com',
    )
    expect(id).toMatchObject({ status: 'failed', reason: 'Authentication results could not be read' })
    for (const value of [
      'mx.google.com; dkim=pass (header.d=a.com; dmarc=pass header.from=a.com',
      'mx.google.com; dkim=pass (a (b) header.d=a.com; dmarc=pass header.from=a.com',
      'mx.google.com; dkim=pass a) header.d=a.com; dmarc=pass header.from=a.com',
    ]) {
      expect(senderIdentity([auth(value)], 'x@a.com'), value).toMatchObject({
        status: 'failed',
        reason: 'Authentication results could not be read',
      })
    }
  })

  it('does not fail a foreign Authentication-Results for its quotes', () => {
    const id = senderIdentity([auth('evil.example; spf=pass smtp.mailfrom="x"@a.com')], 'x@a.com')
    expect(id).toMatchObject({ status: 'unverified', reason: 'Not checked by Gmail' })
  })

  it('normalises signedBy', () => {
    const id = senderIdentity([auth('mx.google.com; dkim=pass header.i=@Mail.A.com; dmarc=pass header.from=a.com')], 'x@a.com')
    expect(id.signedBy).toBe('mail.a.com')
  })

  it('handles nested comments and escaped parens', () => {
    const failed = senderIdentity(
      [auth('mx.google.com; dkim=pass (a (b dmarc=pass) c) header.d=a.com; dmarc=fail (a \\) b) header.from=a.com')],
      'x@a.com',
    )
    expect(failed.status).toBe('failed')
    expect(failed.reason).not.toBe('Authentication results could not be read')
    const verified = senderIdentity(
      [auth('mx.google.com; dkim=pass (a (b; dmarc=fail \\( c) d) header.d=a.com; dmarc=pass header.from=a.com')],
      'x@a.com',
    )
    expect(verified.status).toBe('verified')
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

  it('tls from the Received header added by mx.google.com', () => {
    expect(senderIdentity([], 'x@a.com').tls).toBeUndefined()
    expect(senderIdentity([{ name: 'Received', value: 'by x with ESMTPS id 1' }], 'x@a.com').tls).toBeUndefined()
    const hops = (gmailHop: string) => [
      { name: 'Received', value: 'by 2002:a05:6a20:1 with SMTP id abc; Sat, 31 Oct 2026 10:00:00 -0700 (PDT)' },
      { name: 'Received', value: gmailHop },
      { name: 'Received', value: 'from origin.example by relay.example with ESMTPS id 1' },
    ]
    const tls = 'from mail.x.com (mail.x.com. [1.2.3.4]) by mx.google.com with ESMTPS id q1 (version=TLS1_3)'
    expect(senderIdentity(hops(tls), 'x@a.com').tls).toBe(true)
    expect(senderIdentity(hops('from mail.x.com by MX.GOOGLE.COM with SMTP id q1'), 'x@a.com').tls).toBe(false)
  })

  it('anchors the Gmail hop host and reads TLS only after it', () => {
    const tlsOf = (value: string) => senderIdentity([{ name: 'Received', value }], 'x@a.com').tls
    expect(tlsOf('from ESMTPS (helo) by mx.google.com with SMTP id 1')).toBe(false)
    expect(tlsOf('from x by mx.google.com.evil.com with ESMTPS id 1')).toBeUndefined()
    expect(tlsOf('from x by mx.google.com with ESMTPS id 1')).toBe(true)
    expect(tlsOf('from x by mx.google.com with SMTP id 1 (version=TLS1_3)')).toBe(true)
    expect(tlsOf('from x by mx.google.com (Postfix) with ESMTPS id 1 (version=TLS1_3)')).toBe(true)
  })

  it('replyToMismatch when registrable domains differ', () => {
    const id = senderIdentity([{ name: 'Reply-To', value: 'x@gmail.com' }], 'ceo@corp.com')
    expect(id.replyTo).toBe('x@gmail.com')
    expect(id.replyToMismatch).toBe(true)
    for (const value of ['"<ceo@corp.com>" <x@evil.com>', 'x@evil.com (ceo@corp.com)', 'x@evil.com, y@corp.com']) {
      const spoof = senderIdentity([{ name: 'Reply-To', value }], 'ceo@corp.com')
      expect(spoof.replyToMismatch, value).toBe(true)
      expect(spoof.replyTo, value).toBe('x@evil.com')
    }
    const broken = senderIdentity([{ name: 'Reply-To', value: ' "oops <evil@evil.com> ' }], 'ceo@corp.com')
    expect(broken.replyToMismatch).toBe(true)
    expect(broken.replyTo).toBe('"oops <evil@evil.com>')
    const unparsed = senderIdentity([{ name: 'Reply-To', value: '()' }], 'ceo@corp.com')
    expect(unparsed.replyToMismatch).toBe(true)
    expect(senderIdentity([], 'ceo@corp.com').replyToMismatch).toBe(false)
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
