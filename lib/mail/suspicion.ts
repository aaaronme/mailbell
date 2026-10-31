import { registrableDomain, type SenderIdentity } from './identity'

export type SuspicionReason = 'spam' | 'auth-failed' | 'name-spoof' | 'lookalike'

export const REASON_TEXT: Record<SuspicionReason, string> = {
  spam: 'This is in Spam',
  'auth-failed': 'This mail failed sender checks',
  'name-spoof': 'The sender’s name shows a different address',
  lookalike: 'This domain looks like one you’ve written to',
}

// RFC 3492 decoder, for the "xn--" labels of internationalized domains.
function punycodeDecode(input: string): string {
  const base = 36
  const out: number[] = []
  const basic = input.lastIndexOf('-')
  for (let j = 0; j < Math.max(basic, 0); j++) out.push(input.charCodeAt(j))
  let n = 128
  let bias = 72
  let i = 0
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) throw new RangeError('bad punycode')
      const c = input.charCodeAt(idx++)
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base
      if (digit >= base) throw new RangeError('bad punycode')
      i += digit * w
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias
      if (digit < t) break
      w *= base - t
    }
    const len = out.length + 1
    let delta = oldi === 0 ? Math.floor((i - oldi) / 700) : Math.floor((i - oldi) / 2)
    delta += Math.floor(delta / len)
    let k = 0
    while (delta > ((base - 1) * 26) >> 1) {
      delta = Math.floor(delta / (base - 1))
      k += base
    }
    bias = k + Math.floor((base * delta) / (delta + 38))
    n += Math.floor(i / len)
    i %= len
    out.splice(i++, 0, n)
  }
  return String.fromCodePoint(...out)
}

// The domain as a person would see it, so a Cyrillic "а" sits one edit from
// the Latin one instead of hiding behind an "xn--" label.
function displayDomain(domain: string): string {
  return domain
    .normalize('NFKC')
    .toLowerCase()
    .split('.')
    .map((label) => {
      if (!label.startsWith('xn--')) return label
      try {
        return punycodeDecode(label.slice(4))
      } catch {
        return label
      }
    })
    .join('.')
}

const comparable = (domain: string) => displayDomain(registrableDomain(domain))

// Common glyph swaps, applied to both sides before comparing.
const skeleton = (s: string) => s.replace(/0/g, 'o').replace(/1/g, 'l').replace(/rn/g, 'm').replace(/vv/g, 'w')

const same = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i])

// Damerau-Levenshtein distance <= 1 (one insert, delete, substitute, or swap).
function withinOneEdit(a: string[], b: string[]): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (i === a.length && i === b.length) return true
  if (a.length === b.length) {
    if (same(a.slice(i + 1), b.slice(i + 1))) return true
    return a[i] === b[i + 1] && a[i + 1] === b[i] && same(a.slice(i + 2), b.slice(i + 2))
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a]
  return same(long.slice(i + 1), short.slice(i))
}

export function isLookalike(domain: string, known: Set<string>): boolean {
  const mine = comparable(domain)
  const knownDomains = [...known].map(comparable)
  // A domain the user already writes to is never a lookalike of another.
  if (knownDomains.includes(mine)) return false
  const mineChars = [...mine]
  const mineSkeleton = skeleton(mine)
  return knownDomains.some((it) => skeleton(it) === mineSkeleton || withinOneEdit(mineChars, [...it]))
}

const ADDRESS_IN_TEXT = /[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}/gi

export function nameSpoofs(displayName: string, email: string): boolean {
  const real = email.trim().toLowerCase()
  return (displayName.match(ADDRESS_IN_TEXT) ?? []).some((it) => it.toLowerCase() !== real)
}

export function suspicionOf(input: {
  labelIds: string[]
  identity: SenderIdentity
  senderName: string
  senderEmail: string
  knownDomains: Set<string>
}): SuspicionReason[] {
  const reasons: SuspicionReason[] = []
  if (input.labelIds.includes('SPAM')) reasons.push('spam')
  if (input.identity.status === 'failed') reasons.push('auth-failed')
  if (nameSpoofs(input.senderName, input.senderEmail)) reasons.push('name-spoof')
  if (isLookalike(input.identity.fromDomain, input.knownDomains)) reasons.push('lookalike')
  return reasons
}
