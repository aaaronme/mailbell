import DOMPurify from 'dompurify'
import { blockCssUrls, isLocalUrl, isTracker } from './mail/remoteContent'

// Its own instance, so the hooks below apply to mail only.
const purify = DOMPurify()

// What the call in progress asked for and has blocked so far. Hooks are global
// to the instance, so they read this rather than taking options; sanitize is
// synchronous, so nothing else runs in between and `finally` always resets it.
let current: { remote: boolean; blocked: number } | null = null

const MEDIA = new Set(['img', 'source', 'audio', 'video', 'track'])
// SVG elements that fetch what their href names; <a> only navigates.
const SVG_FETCHERS = new Set(['image', 'feimage', 'use'])

// Whether any candidate of a srcset is not local. Candidates are runs of
// non-space after whitespace or commas, so a data: url may itself hold commas.
function srcsetIsRemote(srcset: string) {
  let rest = srcset
  while (true) {
    rest = rest.replace(/^[\s,]+/, '')
    if (!rest) return false
    const url = /^\S+/.exec(rest)![0]
    if (!isLocalUrl(url)) return true
    const descriptors = /^\S+\s*([^,]*)/.exec(rest)!
    rest = rest.slice(descriptors[0].length)
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
  if (current.remote) return

  let hit = false
  const remember = (value: string) => {
    if (!node.hasAttribute('data-remote-src')) node.setAttribute('data-remote-src', value)
  }
  if (MEDIA.has(tag)) {
    const src = node.getAttribute('src')
    if (src && !isLocalUrl(src)) {
      remember(src)
      node.removeAttribute('src')
      hit = true
    }
    const srcset = node.getAttribute('srcset')
    if (srcset && srcsetIsRemote(srcset)) {
      remember(srcset)
      node.removeAttribute('srcset')
      hit = true
    }
  }
  for (const attr of ['poster', 'background']) {
    const value = node.getAttribute(attr)
    if (value && !isLocalUrl(value)) {
      node.removeAttribute(attr)
      hit = true
    }
  }
  if (SVG_FETCHERS.has(tag)) {
    for (const attr of ['href', 'xlink:href']) {
      const value = node.getAttribute(attr)
      if (value && !value.startsWith('#') && !isLocalUrl(value)) {
        node.removeAttribute(attr)
        hit = true
      }
    }
  }
  const style = node.getAttribute('style')
  if (style) {
    const result = blockCssUrls(style)
    if (result.blocked) {
      node.setAttribute('style', result.css)
      hit = true
    }
  }
  if (hit) current.blocked++
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
export function sanitizeStyles(css: string, opts: { remote?: boolean } = {}): string {
  return opts.remote ? css : blockCssUrls(css).css
}
