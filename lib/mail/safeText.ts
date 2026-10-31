import { sanitizeMail } from '../sanitizeMail'

const BLOCKS = new Set([
  'address', 'blockquote', 'div', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre',
  'section', 'table', 'tr', 'ul',
])

// Marks a block boundary; runs of them become one line break, so nested blocks
// don't stack blank lines.
const BREAK = '\u0001'

function render(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ')
  if (!(node instanceof Element)) return ''
  const tag = node.localName
  if (tag === 'br') return '\n'
  const inner = [...node.childNodes].map(render).join('')
  if (tag === 'a' && node.hasAttribute('href')) {
    const url = node.getAttribute('href')!
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
