import DOMPurify from 'dompurify'

// Its own instance, so the hook below applies to mail only.
const purify = DOMPurify()

// A link opens in a tab of its own: without a target it would navigate the
// popup itself away.
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

// Mail is untrusted HTML rendered into the popup. The extension's CSP already
// blocks scripts and inline handlers; this removes them anyway, along with
// javascript: links and forms that could pose as a sign-in page. Inline
// styles and data- attributes (the dark-mode marker) stay.
export function sanitizeMail(html: string): string {
  return purify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'base', 'link'],
  })
}
