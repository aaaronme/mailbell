import DOMPurify from 'dompurify'
import { blockCssUrls, isLocalUrl, isTracker, isTrackerUrl } from './mail/remoteContent'

// Its own instance, so the hooks below apply to mail only.
const purify = DOMPurify()

// What the call in progress asked for and has blocked so far. Hooks are global
// to the instance, so they read this rather than taking options; sanitize is
// synchronous, so nothing else runs in between and `finally` always resets it.
let current: { remote: boolean; blocked: number } | null = null

const MEDIA = new Set(['img', 'source', 'audio', 'video', 'track'])
const SVG_NS = 'http://www.w3.org/2000/svg'

// Whether any candidate of a srcset matches. Candidates are runs of non-space
// after whitespace or commas, so a data: url may itself hold commas.
function srcsetHas(srcset: string, test: (url: string) => boolean) {
  let rest = srcset
  while (true) {
    rest = rest.replace(/^[\s,]+/, '')
    if (!rest) return false
    if (test(/^\S+/.exec(rest)![0])) return true
    rest = rest.slice(/^\S+\s*([^,]*)/.exec(rest)![0].length)
  }
}

// A link opens in a tab of its own: without a target it would navigate the
// popup itself away. Its title is where it really goes, since the text can
// claim anything.
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
    node.setAttribute('title', node.getAttribute('href')!)
  }
  if (!current || !(node instanceof Element)) return

  // Ours to write, never the sender's.
  node.removeAttribute('data-remote-src')
  const tag = node.localName.toLowerCase()
  if (
    tag === 'img' &&
    isTracker({
      src: node.getAttribute('src') ?? '',
      width: node.getAttribute('width') ?? undefined,
      height: node.getAttribute('height') ?? undefined,
      style: node.getAttribute('style') ?? undefined,
    })
  ) {
    node.remove()
    return
  }

  // Without remote, anything not local is out; with it, only trackers' urls.
  const { remote } = current
  const bad = (url: string) => (remote ? isTrackerUrl(url) : !isLocalUrl(url))
  const badRef = (url: string) => (remote ? isTrackerUrl(url) : !url.startsWith('#') && !isLocalUrl(url))
  let hit = false
  // Informational only: Task 6 restores by sanitizing again with remote set,
  // never by reading this back.
  const remember = (value: string) => {
    if (!remote && !node.hasAttribute('data-remote-src')) node.setAttribute('data-remote-src', value)
  }
  if (MEDIA.has(tag)) {
    const src = node.getAttribute('src')
    if (src && bad(src)) {
      remember(src)
      node.removeAttribute('src')
      hit = true
    }
    const srcset = node.getAttribute('srcset')
    if (srcset && srcsetHas(srcset, bad)) {
      remember(srcset)
      node.removeAttribute('srcset')
      hit = true
    }
  }
  for (const attr of ['poster', 'background']) {
    const value = node.getAttribute(attr)
    if (value && bad(value)) {
      node.removeAttribute(attr)
      hit = true
    }
  }
  if (node.namespaceURI === SVG_NS) {
    // Whatever the element, an href is a fetch unless it points inside the
    // svg; <a> only navigates.
    if (tag !== 'a') {
      for (const attr of ['href', 'xlink:href']) {
        const value = node.getAttribute(attr)
        if (value && badRef(value)) {
          node.removeAttribute(attr)
          hit = true
        }
      }
    }
    // filter, mask, fill, clip-path ... take a css url() as a presentation
    // attribute.
    for (const attr of node.getAttributeNames()) {
      const value = node.getAttribute(attr)!
      if (attr !== 'style' && value.includes('(')) {
        const result = blockCssUrls(value, remote ? 'trackers' : 'all')
        if (result.blocked) {
          node.setAttribute(attr, result.css)
          hit = true
        }
      }
    }
  }
  const style = node.getAttribute('style')
  if (style) {
    const result = blockCssUrls(style, remote ? 'trackers' : 'all')
    if (result.blocked) {
      node.setAttribute('style', result.css)
      hit = true
    }
  }
  // A dropped tracker isn't a loss worth telling the reader about.
  if (hit && !remote) current.blocked++
})

// Mail is untrusted HTML rendered into the popup. The extension's CSP already
// blocks scripts and inline handlers; this removes them anyway, along with
// javascript: links and forms that could pose as a sign-in page. Inline
// styles and data- attributes (the dark-mode marker) stay. Nothing remote
// loads unless `remote` is set, and tracking pixels never do. `blocked` counts
// the elements that lost something.
export function sanitizeMail(html: string, opts: { remote?: boolean } = {}): { html: string; blocked: number } {
  current = { remote: opts.remote ?? false, blocked: 0 }
  try {
    const clean = purify.sanitize(html, {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'base', 'link'],
    })
    return { html: clean, blocked: current.blocked }
  } finally {
    current = null
  }
}

// The <style> contents that prepareHtml pulled out of a mail, which no sanitize
// pass saw.
export function sanitizeStyles(css: string, opts: { remote?: boolean } = {}): { css: string; blocked: number } {
  if (opts.remote) return { css: blockCssUrls(css, 'trackers').css, blocked: 0 }
  return blockCssUrls(css)
}
