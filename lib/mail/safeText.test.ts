import { describe, expect, it } from 'vitest'
import { safeParts, safeText } from './safeText'

describe('safeText', () => {
  it('shows where a link really goes, and no markup', () => {
    const text = safeText('<p>Hi <a href="https://evil.ru/x">PayPal</a></p>')
    expect(text).toContain('PayPal (evil.ru/…)')
    expect(text).not.toContain('<')
  })

  it('shows just the host when the text is the url', () => {
    expect(safeText('<a href="https://a.com/x">https://a.com/x</a>')).toBe('a.com/…')
    expect(safeText('<a href="https://a.com/"><img alt=""></a>')).toBe('a.com')
  })

  // A tracking link runs to hundreds of characters; only its host says where it goes.
  it('keeps the whole host but drops the path, in links and in bare text', () => {
    const long = 'https://paypal.com.evil.ru/c/' + 'x'.repeat(300) + '?id=1'
    expect(safeText(`<a href="${long}">Log in</a>`)).toBe('Log in (paypal.com.evil.ru/…)')
    expect(safeText(`<p>Visit ${long}. Today</p>`)).toBe('Visit paypal.com.evil.ru/…. Today')
  })

  it('shows a mail link as its address', () => {
    expect(safeText('<a href="mailto:bob@x.com?subject=hi">write</a>')).toBe('write (bob@x.com)')
  })

  it('breaks lines at blocks', () => {
    expect(safeText('<div>one</div><p>two</p>a<br>b<script>x()</script>')).toBe('one\ntwo\na\nb')
  })

  it('keeps each full url beside its short form', () => {
    const long = 'https://a.com/c/' + 'x'.repeat(50)
    expect(safeParts(`<p>Hi <a href="${long}">there</a>, see ${long}</p>`)).toEqual([
      'Hi there (',
      { text: 'a.com/…', href: long },
      '), see ',
      { text: 'a.com/…', href: long },
    ])
  })
})
