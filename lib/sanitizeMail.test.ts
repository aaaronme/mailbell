import { describe, expect, it } from 'vitest'
import { sanitizeMail, sanitizeStyles } from './sanitizeMail'
import { TRACKER_HOSTS } from './mail/remoteContent'
import { EMAIL_BG_ATTR } from './emailBackground'

const outsideRemoteSrc = (html: string) => html.replace(/data-remote-src="[^"]*"/g, '')

describe('sanitizeMail', () => {
  it('removes scripts, handlers, javascript: links and forms', () => {
    const { html } = sanitizeMail(
      '<p onclick="x()">hi</p><script>x()</script><img src="x" onerror="x()"><a href="javascript:x()">a</a>' +
        '<form action="https://evil.example"><input name="password"></form><meta http-equiv="refresh" content="0;url=https://evil.example">',
    )
    expect(html).not.toMatch(/script|onclick|onerror|javascript:|<form|<input|<meta/)
    expect(html).toContain('<p>hi</p>')
  })

  it('keeps the mail looking as sent, and opens its links in a new tab', () => {
    const { html } = sanitizeMail(
      `<div style="color: red" ${EMAIL_BG_ATTR}=""><img src="data:image/png;base64,AAAA" alt="logo"><a href="https://example.com">site</a></div>`,
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('div')!.getAttribute('style')).toBe('color: red')
    expect(doc.querySelector(`[${EMAIL_BG_ATTR}]`)).not.toBeNull()
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    const link = doc.querySelector('a')!
    expect([link.getAttribute('target'), link.getAttribute('rel')]).toEqual(['_blank', 'noopener noreferrer'])
  })

  it('blocks every remote vector', () => {
    const { html, blocked } = sanitizeMail(
      '<img src="https://a/x.png" width=40 height=20>' +
        '<img srcset="https://a/1x.png 1x">' +
        '<table><tr><td background="https://a/bg.png">x</td></tr></table>' +
        '<div style="background:url(https://a/b.png)">y</div>' +
        '<video poster="https://a/p.png"></video>',
    )
    expect(outsideRemoteSrc(html)).not.toContain('https://a/')
    expect(blocked).toBe(5)
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('img')!.getAttribute('width')).toBe('40')
  })

  it('blocks the less obvious vectors', () => {
    const { html, blocked } = sanitizeMail(
      '<picture><source srcset="https://a/s.png"><img src="data:image/png;base64,AAAA"></picture>' +
        '<audio src="https://a/s.mp3"></audio>' +
        '<div style="background:image-set(\'https://a/i.png\' 1x)">a</div>' +
        '<div style="background:u\\72 l(https://a/e.png)">b</div>' +
        '<div style="background:\\75rl(//a/e.png)">c</div>' +
        '<svg><image href="https://a/v.svg"></image><image xlink:href="https://a/w.svg"></image><use href="https://a/u.svg#x"></use></svg>',
    )
    expect(outsideRemoteSrc(html)).not.toMatch(/https?:\/\/a\/|\/\/a\//)
    // DOMPurify drops <use> itself.
    expect(blocked).toBe(7)
  })

  it('blocks remote urls hidden in svg attributes, and keeps local ones', () => {
    const { html, blocked } = sanitizeMail(
      '<svg><rect filter="url(https://a/f.svg#f)"/><rect mask="url(https://a/m.svg#m)"/>' +
        '<rect fill="url(https://a/g.svg#g)"/><rect fill="url(#g)"/>' +
        '<linearGradient href="https://a/g.svg#x"/><linearGradient xlink:href="https://a/g.svg#x"/>' +
        '<linearGradient href="#local"/></svg>',
    )
    expect(outsideRemoteSrc(html)).not.toContain('https://a/')
    expect(blocked).toBe(5)
    expect(html).toContain('fill="url(#g)"')
    expect(html).toContain('href="#local"')
  })

  it('drops a sender-supplied data-remote-src in both modes', () => {
    for (const remote of [false, true]) {
      const { html } = sanitizeMail('<img data-remote-src="https://a/receipt" src="data:image/png;base64,AAAA">', { remote })
      expect(html).not.toContain('https://a/receipt')
    }
  })

  it('with remote, still drops urls on tracker hosts', () => {
    const t = `https://x.${TRACKER_HOSTS[0]}/t.png`
    const { html, blocked } = sanitizeMail(
      `<img srcset="${t} 1x" src="https://a/ok.png" width=5><td background="${t}">x</td>` +
        `<div style="background:url(${t}), url(https://a/ok.png)">y</div><video poster="${t}"></video>`,
      { remote: true },
    )
    expect(html).not.toContain(TRACKER_HOSTS[0])
    expect(html).toContain('https://a/ok.png')
    expect(blocked).toBe(0)
  })

  it('keeps cid and data images', () => {
    const { html, blocked } = sanitizeMail('<img src="cid:logo"><img src="data:image/png;base64,AAAA">')
    expect(html).toContain('src="cid:logo"')
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(blocked).toBe(0)
  })

  it('trackers never load, even with remote', () => {
    const html =
      `<img src="https://a/p.gif" width=1 height=1><img src="https://${TRACKER_HOSTS[0]}/o.png" width=50>` +
      '<img src="https://a/h.png" style="display:none">'
    expect(sanitizeMail(html, { remote: true })).toEqual({ html: '', blocked: 0 })
    expect(sanitizeMail(html)).toEqual({ html: '', blocked: 0 })
  })

  it('remote: true restores normal images', () => {
    const { html, blocked } = sanitizeMail(
      '<img src="https://a/x.png" width=40><div style="background:url(https://a/b.png)">y</div>',
      { remote: true },
    )
    expect(html).toContain('src="https://a/x.png"')
    expect(html).toContain('url(https://a/b.png)')
    expect(blocked).toBe(0)
  })

  it('does not leak remote: true into a later call', () => {
    sanitizeMail('<p>x</p>', { remote: true })
    expect(sanitizeMail('<img src="https://a/x.png">').blocked).toBe(1)
  })

  it('links get their real destination as title', () => {
    const { html } = sanitizeMail('<a href="https://evil.ru/x">PayPal</a>')
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('a')!.getAttribute('title')).toBe('https://evil.ru/x')
  })
})

describe('sanitizeStyles', () => {
  it('blocks @import and url() in font-face', () => {
    const css =
      '@import url("https://a/x.css"); @import "https://a/y.css"; @font-face{font-family:f;src:url(https://a/f.woff)} p{color:red}'
    const { css: out, blocked } = sanitizeStyles(css)
    expect(out).not.toContain('https://')
    expect(out).toContain('color:red')
    expect(blocked).toBe(3)
  })

  it('drops every @import, also when remote content is allowed', () => {
    const css = '@import "https://cdn.example.com/y.css"; p{color:red}'
    expect(sanitizeStyles(css, { remote: true }).css).not.toContain('@import')
    expect(sanitizeStyles(css, { remote: true }).css).toContain('color:red')
  })

  it('resumes after a malformed unquoted url', () => {
    const css = 'a{background:url(data:x" ); background:url(https://a/x.png) ; ")}'
    expect(sanitizeStyles(css)).toMatchObject({ blocked: 2 })
    expect(sanitizeStyles(css).css).not.toContain('https://')
    const { html, blocked } = sanitizeMail(`<div style='background:url(data:x( ); background:url(https://a/x.png)'>y</div>`)
    expect(html).not.toContain('https://')
    expect(blocked).toBe(1)
  })

  it('leaves css alone with remote', () => {
    expect(sanitizeStyles('p{background:url(https://a/b.png)}', { remote: true })).toEqual({
      css: 'p{background:url(https://a/b.png)}',
      blocked: 0,
    })
  })
})
