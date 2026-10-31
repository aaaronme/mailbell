import { sanitizeMail } from '../sanitizeMail'

const BLOCKS = new Set([
  'address', 'blockquote', 'div', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre',
  'section', 'table', 'tr', 'ul',
])

// Marks a block boundary; runs of them become one line break, so nested blocks
// don't stack blank lines.
const BREAK = '\u0001'

// Trailing punctuation usually ends the sentence, not the url.
const BARE_URL = /\bhttps?:\/\/[^\s<>"]+?(?=[.,;:!?)\]]*(?:\s|$))/gi

// Where a link goes, without the tracking path that can run to hundreds of
// characters: the whole host is what tells a real domain from a lookalike.
function shortUrl(url: string): string {
  if (/^mailto:/i.test(url)) return decodeURIComponent(url.slice(7).split('?')[0]!)
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url
    return u.pathname === '/' && !u.search && !u.hash ? u.host : `${u.host}/…`
  } catch {
    return url
  }
}

// A link travels through the line clean-up as \u0002href\u0003short\u0004,
// so its full url survives for safeParts.
const LINK = /\u0002([^\u0003]*)\u0003([^\u0004]*)\u0004/g
const link = (href: string) => `\u0002${href}\u0003${shortUrl(href)}\u0004`
const plain = (text: string) => text.replace(LINK, '$2')

function render(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ').replace(BARE_URL, link)
  if (!(node instanceof Element)) return ''
  const tag = node.localName
  if (tag === 'br') return '\n'
  const inner = [...node.childNodes].map(render).join('')
  if (tag === 'a' && node.hasAttribute('href')) {
    const href = node.getAttribute('href')!.replace(/\s+/g, '')
    // A url in the text is only what the sender claims; just the href is a link.
    const text = plain(inner).trim()
    return !text || text === shortUrl(href) ? link(href) : `${text} (${link(href)})`
  }
  return BLOCKS.has(tag) ? `${BREAK}${inner}${BREAK}` : inner
}

function marked(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeMail(html).html, 'text/html')
  return render(doc.body)
    .replace(new RegExp(`${BREAK}+`, 'g'), '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Plain text of a mail, for places that must not render markup. A link shows
// where it goes, since its text can claim anything.
export function safeText(html: string): string {
  return plain(marked(html))
}

// The same text, with each link split out with its full url, for a view
// that shows it on hover.
export function safeParts(html: string): (string | { text: string; href: string })[] {
  const parts: (string | { text: string; href: string })[] = []
  const text = marked(html)
  let at = 0
  for (const m of text.matchAll(LINK)) {
    if (m.index > at) parts.push(text.slice(at, m.index))
    parts.push({ text: m[2]!, href: m[1]! })
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push(text.slice(at))
  return parts
}
