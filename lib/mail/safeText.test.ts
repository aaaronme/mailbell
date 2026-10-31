import { describe, expect, it } from 'vitest'
import { safeText } from './safeText'

describe('safeText', () => {
  it('shows where a link really goes, and no markup', () => {
    const text = safeText('<p>Hi <a href="https://evil.ru/x">PayPal</a></p>')
    expect(text).toContain('PayPal (https://evil.ru/x)')
    expect(text).not.toContain('<')
  })

  it('shows just the url when the text is the url', () => {
    expect(safeText('<a href="https://a.com/x">https://a.com/x</a>')).toBe('https://a.com/x')
  })

  it('breaks lines at blocks', () => {
    expect(safeText('<div>one</div><p>two</p>a<br>b<script>x()</script>')).toBe('one\ntwo\na\nb')
  })
})
