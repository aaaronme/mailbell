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

// Removes RFC 5322 comments and quoted strings from an address header in one
// left-to-right pass, so a "(" inside quotes or a quote inside a comment can't
// desync it. Both are sender text ('"<ceo@corp.com>" <x@evil.com>'), so neither
// may read as an address. Nested comments and backslash escapes are honoured;
// an unterminated one swallows the rest, and is reported so callers can fail
// closed.
function stripQuotedAndComments(value: string): { text: string; balanced: boolean } {
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
  return { text: out, balanced: depth === 0 && !quoted }
}

// Removes RFC 5322 comments (nested, with backslash escapes). Comments are
// free text a sender or relay controls ("(domain of dmarc=pass@evil.com ...)"),
// so none of it may read as structure. An unterminated comment or a stray ")"
// is reported so callers can fail closed.
function stripComments(value: string): { text: string; balanced: boolean } {
  let out = ''
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!
    if (depth > 0) {
      if (c === '\\') i++
      else if (c === '(') depth++
      else if (c === ')' && --depth === 0) out += ' '
    } else if (c === '(') depth = 1
    else if (c === ')') return { text: out, balanced: false }
    else out += c
  }
  return { text: out, balanced: depth === 0 }
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
// Any '"' makes it unreadable: inside Gmail's comments quotes aren't special,
// so a quoted local part can carry ")" or ";" out of one. Unquoted local parts
// are atext, which has none of ( ) ; ", so without quotes a sender can't
// write structure.
function authResult(headers: Headers) {
  const value = headerOf(headers, 'Authentication-Results')
  if (value === undefined) return undefined
  const scanned = stripComments(value)
  const [authserv = '', ...rest] = scanned.text.split(';')
  if (authserv.trim().split(/\s+/)[0]?.toLowerCase() !== 'mx.google.com') return undefined
  if (!scanned.balanced || value.includes('"')) return { unreadable: true as const }
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
function addressList(value: string): { addresses: string[]; balanced: boolean } {
  const { text, balanced } = stripQuotedAndComments(value)
  const addresses = text
    .split(/,(?![^<]*>)/)
    .map((part) => (part.match(/<([^>]*)>/)?.[1] ?? part).trim())
    .filter(Boolean)
  return { addresses, balanced }
}

export function senderIdentity(headers: Headers, fromEmail: string): SenderIdentity {
  const fromDomain = splitAddress(fromEmail).domain
  const auth = authResult(headers)

  const dkimDomains: (string | undefined)[] = (auth && 'dkim' in auth && auth.dkim) || []
  const signedBy = dkimDomains.find(Boolean)?.replace(/^.*@/, '').toLowerCase()
  const returnPath = headerOf(headers, 'Return-Path')?.replace(/[<>\s]/g, '')
  // Gmail's own hop: Received headers above it are internal, those below it
  // are the sender's to write.
  const gmailHop = /\bby\s+mx\.google\.com(?=[\s;(]|$)/i
  const received = headers.find((h) => h.name.toLowerCase() === 'received' && gmailHop.test(h.value))?.value
  const afterHost = received?.slice(received.search(gmailHop) + received.match(gmailHop)![0].length)
  const rawReplyTo = headerOf(headers, 'Reply-To')?.trim()
  const replyTos = addressList(rawReplyTo ?? '')
  // A Reply-To that can't be read is not one that is safe.
  const replyToUnreadable = !!rawReplyTo && (!replyTos.balanced || !replyTos.addresses.length)

  let status: AuthStatus
  let reason: string | undefined
  if (!auth) {
    status = 'unverified'
    reason = 'Not checked by Gmail'
  } else if ('unreadable' in auth) {
    status = 'failed'
    reason = 'Authentication results could not be read'
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
    tls: afterHost === undefined ? undefined : /\bwith\s+ESMTPS|\(version=TLS/i.test(afterHost),
    replyTo: replyToUnreadable ? rawReplyTo : replyTos.addresses[0],
    replyToMismatch: replyToUnreadable || replyTos.addresses.some((a) => registrableDomain(a) !== fromDomain),
  }
}
