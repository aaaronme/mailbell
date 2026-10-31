import { getDomain } from 'tldts'

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
  return getDomain(host, { allowPrivateDomains: true }) ?? host
}

export function splitAddress(email: string): { local: string; host: string; domain: string } {
  const at = email.lastIndexOf('@')
  const host = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return { local: at < 0 ? '' : email.slice(0, at), host, domain: registrableDomain(host) }
}

const headerOf = (headers: Headers, name: string) =>
  headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value

// Removes RFC 5322 comments and quoted strings in one left-to-right pass, so a
// "(" inside quotes or a quote inside a comment can't desync it. Both are free
// text a sender or relay controls ("(domain of dmarc=pass@evil.com ...)",
// smtp.mailfrom="x; dmarc=pass"@evil.com), so neither may read as structure.
// Nested comments and backslash escapes are honoured; an unterminated one
// swallows the rest, which can only lose information.
function stripQuotedAndComments(value: string): string {
  let out = ''
  let depth = 0
  let quoted = false
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!
    if (depth > 0) {
      if (c === '\\') i++
      else if (c === '(') depth++
      else if (c === ')' && --depth === 0) out += ' '
    } else if (quoted) {
      if (c === '\\') i++
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === '(') depth = 1
    else out += c
  }
  return out
}

interface Segment {
  method: string
  result: string
  text: string
}

// `key=` as a property of this segment; the key must start a token.
function property(segment: Segment, key: string): string | undefined {
  return segment.text.match(new RegExp(`(?:^|\\s)${key.replace('.', '\\.')}=@?([^\\s;]+)`, 'i'))?.[1]
}

// Gmail's verdict: the message's first Authentication-Results header, and only
// when it names mx.google.com. Any later header, or one a sender or an earlier
// hop added on top, says nothing about what Gmail checked.
function authResult(headers: Headers) {
  const value = headerOf(headers, 'Authentication-Results')
  if (value === undefined) return undefined
  const [authserv = '', ...rest] = stripQuotedAndComments(value).split(';')
  if (authserv.trim().split(/\s+/)[0]?.toLowerCase() !== 'mx.google.com') return undefined
  const segments: Segment[] = []
  for (const text of rest) {
    const m = text.match(/^\s*([a-z][a-z0-9-]*)\s*=\s*([a-z]+)/i)
    if (m) segments.push({ method: m[1]!.toLowerCase(), result: m[2]!.toLowerCase(), text: text.trim() })
  }
  const of = (method: string, result?: string) =>
    segments.filter((s) => s.method === method && (result === undefined || s.result === result))
  const dmarc = of('dmarc')[0]
  return {
    failed: segments.some((s) => ['spf', 'dkim', 'dmarc'].includes(s.method) && s.result === 'fail'),
    dmarc: dmarc?.result,
    headerFrom: dmarc && property(dmarc, 'header.from'),
    dkim: of('dkim', 'pass').map((s) => property(s, 'header.d') ?? property(s, 'header.i')),
    spf: of('spf', 'pass').map((s) => property(s, 'smtp.mailfrom')),
  }
}

// The addr-specs of an address header, in order. Display names and comments
// are dropped first, so an address written inside one never counts.
function addressList(value: string): string[] {
  return stripQuotedAndComments(value)
    .split(/,(?![^<]*>)/)
    .map((part) => (part.match(/<([^>]*)>/)?.[1] ?? part).trim())
    .filter(Boolean)
}

export function senderIdentity(headers: Headers, fromEmail: string): SenderIdentity {
  const fromDomain = splitAddress(fromEmail).domain
  const auth = authResult(headers)

  const signedBy = auth?.dkim.find(Boolean)?.replace(/^.*@/, '').toLowerCase()
  const returnPath = headerOf(headers, 'Return-Path')?.replace(/[<>\s]/g, '')
  // Gmail's own hop: Received headers above it are internal, those below it
  // are the sender's to write.
  const received = headers.find(
    (h) => h.name.toLowerCase() === 'received' && /\bby\s+mx\.google\.com\b/i.test(h.value),
  )?.value
  const replyTos = addressList(headerOf(headers, 'Reply-To') ?? '')

  let status: AuthStatus
  let reason: string | undefined
  if (!auth) {
    status = 'unverified'
    reason = 'Not checked by Gmail'
  } else if (auth.failed) {
    status = 'failed'
  } else if (auth.dmarc !== 'pass') {
    status = 'unverified'
    if (auth.dmarc === 'temperror' || auth.dmarc === 'permerror') reason = 'DMARC check failed to complete'
    else if (!auth.dmarc || auth.dmarc === 'none') reason = 'No DMARC policy'
    else reason = 'DMARC did not pass'
  } else {
    // Alignment is against the From the reader sees, not the domain the
    // header claims to have authenticated.
    const aligned =
      (!auth.headerFrom || registrableDomain(auth.headerFrom) === fromDomain) &&
      [...auth.dkim, ...auth.spf].some((d) => d && registrableDomain(d) === fromDomain)
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
    tls: received === undefined ? undefined : /ESMTPS|version=TLS/i.test(received),
    replyTo: replyTos[0],
    replyToMismatch: replyTos.some((a) => registrableDomain(a) !== fromDomain),
  }
}
