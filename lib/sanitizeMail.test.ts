import { describe, expect, it } from 'vitest'
import { sanitizeMail } from './sanitizeMail'
import { EMAIL_BG_ATTR } from './emailBackground'

describe('sanitizeMail', () => {
  it('removes scripts, handlers, javascript: links and forms', () => {
    const html = sanitizeMail(
      '<p onclick="x()">hi</p><script>x()</script><img src="x" onerror="x()"><a href="javascript:x()">a</a>' +
        '<form action="https://evil.example"><input name="password"></form><meta http-equiv="refresh" content="0;url=https://evil.example">',
    )
    expect(html).not.toMatch(/script|onclick|onerror|javascript:|<form|<input|<meta/)
    expect(html).toContain('<p>hi</p>')
  })

  it('keeps the mail looking as sent, and opens its links in a new tab', () => {
    const html = sanitizeMail(
      `<div style="color: red" ${EMAIL_BG_ATTR}=""><img src="data:image/png;base64,AAAA" alt="logo"><a href="https://example.com">site</a></div>`,
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('div')!.getAttribute('style')).toBe('color: red')
    expect(doc.querySelector(`[${EMAIL_BG_ATTR}]`)).not.toBeNull()
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    const link = doc.querySelector('a')!
    expect([link.getAttribute('target'), link.getAttribute('rel')]).toEqual(['_blank', 'noopener noreferrer'])
  })
})
