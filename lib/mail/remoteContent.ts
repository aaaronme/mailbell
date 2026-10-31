import type { Settings } from '../settings'

// Hosts that serve open-tracking pixels for email platforms. Picked from the
// public lists kept by the Ugly Email extension and by the PixelBlock and
// Trocker projects, keeping hosts that serve only tracking. Matches the host
// and every subdomain of it.
export const TRACKER_HOSTS = [
  'mailchimp.com',
  'list-manage.com',
  'mandrillapp.com',
  'sendgrid.net',
  'sendgrid.com',
  'mailgun.org',
  'hubspot.com',
  'hubspotemail.net',
  'hs-analytics.net',
  'mixmax.com',
  'mailtrack.io',
  'yesware.com',
  'streak.com',
  'getnotify.com',
  'bananatag.com',
  'cirrusinsight.com',
  'superhuman.com',
  'campaign-archive.com',
  'constantcontact.com',
  'exacttarget.com',
  'returnpath.net',
  'sparkpostmail.com',
  'postmarkapp.com',
  'mktdns.com',
  'tracking.klaviyomail.com',
]

const hostOf = (src: string) => {
  try {
    return new URL(src).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function decodeCssEscapes(css: string): string {
  return css.replace(/\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|([^\n]))/gi, (_, hex?: string, char?: string) => {
    if (char !== undefined) return char
    const code = parseInt(hex!, 16)
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '�'
  })
}

// A pixel is 1px or less in either dimension. A percentage says nothing about
// the size on screen.
function tiny(value: string | undefined) {
  if (!value || value.includes('%')) return false
  const size = parseFloat(value)
  return size <= 1
}

export function isTracker(img: { src: string; width?: string; height?: string; style?: string }): boolean {
  if (tiny(img.width) || tiny(img.height)) return true
  const style = decodeCssEscapes(img.style ?? '').toLowerCase()
  if (/(^|;)\s*display\s*:\s*none\b/.test(style) || /(^|;)\s*visibility\s*:\s*hidden\b/.test(style)) return true
  if (/(^|;)\s*opacity\s*:\s*0(\.0*)?\s*(!important\s*)?(;|$)/.test(style)) return true
  const width = /(^|;)\s*width\s*:\s*([^;]*)/.exec(style)?.[2]?.trim()
  const height = /(^|;)\s*height\s*:\s*([^;]*)/.exec(style)?.[2]?.trim()
  if (tiny(width) || tiny(height)) return true
  const host = hostOf(img.src.trim())
  return !!host && TRACKER_HOSTS.some((it) => host === it || host.endsWith(`.${it}`))
}

// Local data needs no network. Everything else, relative and protocol-relative
// urls included, may reach out. Browsers ignore tabs and newlines inside a url.
export function isLocalUrl(url: string): boolean {
  return /^(data|cid):/i.test(url.replace(/[\t\n\r]/g, '').trim())
}

const IDENT_START = /[a-z_\-\\]|[^\x00-\x7f]/i
const IDENT_CHAR = /[a-z0-9_\-]|[^\x00-\x7f]/i

// Reads a CSS ident (escapes decoded) at `start`; `end` is where it stops.
function readIdent(css: string, start: number) {
  let i = start
  while (i < css.length) {
    if (css[i] === '\\') {
      // A hex escape takes up to 6 digits and one trailing space.
      const hex = /^[0-9a-f]{1,6}[ \t\n\r\f]?/i.exec(css.slice(i + 1, i + 8))
      i += 1 + (hex ? hex[0].length : 1)
    } else if (IDENT_CHAR.test(css.charAt(i))) i++
    else break
  }
  i = Math.min(i, css.length)
  return { name: decodeCssEscapes(css.slice(start, i)).toLowerCase(), end: i }
}

function readString(css: string, start: number) {
  const quote = css[start]
  let i = start + 1
  while (i < css.length && css[i] !== quote) i += css[i] === '\\' ? 2 : 1
  return { value: decodeCssEscapes(css.slice(start + 1, i)), end: Math.min(i + 1, css.length) }
}

// The index just past the ")" that closes the "(" before `start`.
function skipParens(css: string, start: number) {
  let depth = 1
  let i = start
  while (i < css.length && depth > 0) {
    const char = css.charAt(i)
    if (char === '"' || char === "'") i = readString(css, i).end
    else if (char === '\\') i += 2
    else {
      if (char === '(') depth++
      else if (char === ')') depth--
      i++
    }
  }
  return Math.min(i, css.length)
}

// url(), src(), image-set() and @import are how CSS fetches things. This
// scans tokens rather than pattern-matching text so that escapes (`u\rl(`),
// comments and quoting can't hide one. Any url that isn't data: or cid: is
// replaced, relative ones too.
export function blockCssUrls(css: string): { css: string; blocked: number } {
  let out = ''
  let blocked = 0
  let i = 0
  while (i < css.length) {
    const char = css.charAt(i)
    if (char === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2)
      const end = close < 0 ? css.length : close + 2
      out += css.slice(i, end)
      i = end
    } else if (char === '"' || char === "'") {
      const end = readString(css, i).end
      out += css.slice(i, end)
      i = end
    } else if (char === '@' && IDENT_START.test(css[i + 1] ?? '')) {
      const { name, end } = readIdent(css, i + 1)
      if (name === 'import') {
        // The whole rule, up to its ";" or the end of the sheet.
        let j = end
        while (j < css.length && css[j] !== ';') {
          if (css[j] === '"' || css[j] === "'") j = readString(css, j).end
          else if (css[j] === '(') j = skipParens(css, j + 1)
          else j += css[j] === '\\' ? 2 : 1
        }
        blocked++
        i = Math.min(j + 1, css.length)
      } else {
        out += css.slice(i, end)
        i = end
      }
    } else if (IDENT_START.test(char)) {
      const { name, end } = readIdent(css, i)
      if (css[end] !== '(') {
        out += css.slice(i, end)
        i = end
      } else if (name === 'url' || name === 'src') {
        let j = end + 1
        while (/\s/.test(css[j] ?? '')) j++
        let value: string
        if (css[j] === '"' || css[j] === "'") {
          const string = readString(css, j)
          value = string.value
          j = string.end
          while (j < css.length && css[j] !== ')') j++
          j++
        } else {
          const close = skipParens(css, j)
          value = decodeCssEscapes(css.slice(j, close - 1))
          j = close
        }
        if (isLocalUrl(value)) out += css.slice(i, j)
        else {
          out += 'url("")'
          blocked++
        }
        i = Math.min(j, css.length)
      } else if (name === 'image-set' || name === '-webkit-image-set' || name === 'cross-fade' || name === '-webkit-cross-fade') {
        // Takes bare strings as urls, so there's no telling a local one apart
        // cheaply.
        out += 'url("")'
        blocked++
        i = skipParens(css, end + 1)
      } else {
        out += css.slice(i, end + 1)
        i = end + 1
      }
    } else {
      out += char
      i++
    }
  }
  return { css: out, blocked }
}

const TRUSTED_KEY = 'trustedSenders'

type TrustedStore = Record<string, string[]>

export async function getTrustedSenders(account: string): Promise<Set<string>> {
  const { [TRUSTED_KEY]: stored } = await browser.storage.local.get<Record<string, TrustedStore>>(TRUSTED_KEY)
  return new Set(stored?.[account])
}

// Read-modify-write, chained so two quick calls in this context don't lose one.
let writeChain: Promise<unknown> = Promise.resolve()

export function trustSender(account: string, email: string): Promise<void> {
  const run = async () => {
    const { [TRUSTED_KEY]: stored } = await browser.storage.local.get<Record<string, TrustedStore>>(TRUSTED_KEY)
    const all = stored ?? {}
    const senders = new Set(all[account])
    senders.add(email.trim().toLowerCase())
    await browser.storage.local.set({ [TRUSTED_KEY]: { ...all, [account]: [...senders] } })
  }
  const result = writeChain.then(run, run)
  writeChain = result.catch(() => {})
  return result
}

export function shouldShowRemote(
  setting: Settings['remoteImages'],
  ctx: { trusted: boolean; repliedTo: boolean },
): boolean {
  return ctx.trusted || setting === 'always' || (setting === 'replied' && ctx.repliedTo)
}
