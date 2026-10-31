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

function render(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ').replace(BARE_URL, shortUrl)
  if (!(node instanceof Element)) return ''
  const tag = node.localName
  if (tag === 'br') return '\n'
  const inner = [...node.childNodes].map(render).join('')
  if (tag === 'a' && node.hasAttribute('href')) {
    const url = shortUrl(node.getAttribute('href')!)
    const text = inner.trim()
    return !text || text === url ? url : `${text} (${url})`
  }
  return BLOCKS.has(tag) ? `${BREAK}${inner}${BREAK}` : inner
}

// Plain text of a mail, for places that must not render markup. A link shows
// where it goes, since its text can claim anything.
export function safeText(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeMail(html).html, 'text/html')
  return render(doc.body)
    .replace(new RegExp(`${BREAK}+`, 'g'), '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
