import { getDomain } from 'tldts'
import { header, parseMailbox } from '../api/gmail'

export type AuthStatus = 'verified' | 'unverified' | 'failed'

export interface SenderIdentity {
  status: AuthStatus
  reason?: string
  fromDomain: string
  signedBy?: string
  mailedBy?: string
  via?: string
  tls?: boolean
  replyTo?: string
  replyToMismatch: boolean
}

type Headers = { name: string; value: string }[]

// The registrable part of a host or address ("x@mail.github.com" ->
// "github.com"), or the host itself when it has none (localhost, an IP).
export function registrableDomain(hostOrAddress: string): string {
  const host = hostOrAddress
    .slice(hostOrAddress.lastIndexOf('@') + 1)
    .trim()
    .toLowerCase()
  return getDomain(host) ?? host
}

export function splitAddress(email: string): { local: string; host: string; domain: string } {
  const at = email.lastIndexOf('@')
  const host = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return { local: at < 0 ? '' : email.slice(0, at), host, domain: registrableDomain(host) }
}

const headerOf = (headers: Headers, name: string) => header({ mimeType: '', headers }, name)

// What follows `key=` in a segment of an Authentication-Results header, up to
// whitespace or a semicolon, minus the "@" of an identity.
function property(segment: string, key: string): string | undefined {
  return segment.match(new RegExp(`${key.replace('.', '\\.')}=@?([^\\s;]+)`, 'i'))?.[1]
}

function authResult(headers: Headers) {
  // Only the first header from Gmail's own authserv-id counts: anything a
  // sender adds, or a forwarder's earlier hop, is not Gmail's verdict.
  const value = headers.find(
    (h) => h.name.toLowerCase() === 'authentication-results' && /^\s*mx\.google\.com\s*(;|$)/i.test(h.value),
  )?.value
  if (value === undefined) return undefined
  const segments = value.split(';').slice(1)
  return {
    failed: /\b(spf|dkim|dmarc)=fail\b/i.test(value),
    dmarcPass: /\bdmarc=pass\b/i.test(value),
    headerFrom: segments.map((s) => property(s, 'header.from')).find(Boolean),
    dkim: segments
      .filter((s) => /\bdkim=pass\b/i.test(s))
      .map((s) => property(s, 'header.d') ?? property(s, 'header.i')),
    spf: segments.filter((s) => /\bspf=pass\b/i.test(s)).map((s) => property(s, 'smtp.mailfrom')),
  }
}

export function senderIdentity(headers: Headers, fromEmail: string): SenderIdentity {
  const fromDomain = splitAddress(fromEmail).domain
  const auth = authResult(headers)

  const dkimSignature = headerOf(headers, 'DKIM-Signature')?.match(/(?:^|[\s;])d=([^\s;]+)/)?.[1]
  const signedBy = auth?.dkim.find(Boolean) ?? dkimSignature
  const returnPath = headerOf(headers, 'Return-Path')?.replace(/[<>\s]/g, '')
  const received = headers.filter((h) => h.name.toLowerCase() === 'received')
  const replyTo = headerOf(headers, 'Reply-To')
  const replyToEmail = replyTo && parseMailbox(replyTo).email

  let status: AuthStatus
  let reason: string | undefined
  if (!auth) {
    status = 'unverified'
    reason = 'Not checked by Gmail'
  } else if (auth.failed) {
    status = 'failed'
  } else if (!auth.dmarcPass) {
    status = 'unverified'
    reason = 'No DMARC policy'
  } else {
    const authenticated = registrableDomain(auth.headerFrom ?? fromDomain)
    const aligned = [...auth.dkim, ...auth.spf].some((d) => d && registrableDomain(d) === authenticated)
    status = aligned ? 'verified' : 'unverified'
    if (!aligned) reason = 'Checks passed without alignment'
  }

  const signer = signedBy && registrableDomain(signedBy)
  return {
    status,
    ...(reason && { reason }),
    fromDomain,
    signedBy,
    mailedBy: returnPath ? registrableDomain(returnPath) : undefined,
    via: signer && signer !== fromDomain ? signer : undefined,
    tls: received.length ? received.some((h) => /ESMTPS|version=TLS/i.test(h.value)) : undefined,
    replyTo,
    replyToMismatch: !!replyToEmail && registrableDomain(replyToEmail) !== fromDomain,
  }
}
