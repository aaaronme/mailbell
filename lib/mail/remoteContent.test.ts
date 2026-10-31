import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { blockCssUrls, isTrackerUrl, getTrustedSenders, isTracker, shouldShowRemote, trustSender, TRACKER_HOSTS } from './remoteContent'

vi.stubGlobal('browser', fakeBrowser)

describe('isTracker', () => {
  it('flags tiny and hidden images and known hosts', () => {
    expect(isTracker({ src: 'https://a/p.gif', width: '1', height: '1' })).toBe(true)
    expect(isTracker({ src: 'https://a/p.gif', height: '1px' })).toBe(true)
    expect(isTracker({ src: 'https://a/p.gif', style: 'dis\\70lay: none' })).toBe(true)
    expect(isTracker({ src: 'https://a/p.gif', style: 'visibility:hidden' })).toBe(true)
    expect(isTracker({ src: 'https://a/p.gif', style: 'opacity:0' })).toBe(true)
    for (const zero of ['0', '0.0', '.0', '0%', '0 !important']) {
      expect(isTracker({ src: 'https://a/p.gif', style: `opacity:${zero}` })).toBe(true)
    }
    expect(isTracker({ src: `https://${TRACKER_HOSTS[0]}./x.png` })).toBe(true)
    expect(isTracker({ src: `https://sub.${TRACKER_HOSTS[0]}/x.png` })).toBe(true)
  })

  it('leaves ordinary images alone', () => {
    expect(isTracker({ src: 'https://a/p.png', width: '40', height: '20', style: 'opacity:0.5' })).toBe(false)
    expect(isTracker({ src: 'https://a/p.png', width: '100%' })).toBe(false)
    expect(isTracker({ src: 'https://a/p.png', width: '1em', height: '0.5in' })).toBe(false)
    expect(isTracker({ src: `https://not${TRACKER_HOSTS[0]}/x.png` })).toBe(false)
  })
})

describe('blockCssUrls', () => {
  it('replaces remote urls and counts them', () => {
    expect(blockCssUrls('a{background:url(https://a/b.png)} b{background:url( "//a/c.png" )}')).toEqual({
      css: 'a{background:url("")} b{background:url("")}',
      blocked: 2,
    })
  })

  it('sees through escapes, image-set and @import', () => {
    const { css, blocked } = blockCssUrls(
      '@import "https://a/x.css";a{b:u\\rl(https://a/1)}c{d:\\55RL("https://a/2")}e{f:-webkit-image-set("https://a/3" 1x)}',
    )
    expect(css).not.toMatch(/https:|\/\/a/)
    expect(blocked).toBe(4)
  })

  it('resumes after a bad string, which ends at an unescaped newline', () => {
    for (const css of [
      "x:'\n;background-image:url(https://a/x.png)",
      'a{content:"\n}b{background:url(https://a/x.png)}',
      'a{background:url("x\n);b:url(https://a/x.png)}',
      '@import "x\n;a{background:url(https://a/x.png)}',
    ]) {
      expect(blockCssUrls(css).css).not.toContain('https://')
    }
  })

  it('continues a string over an escaped newline', () => {
    const css = 'a{content:"x\\\ny;z:url(https://a/x.png)"}'
    expect(blockCssUrls(css)).toEqual({ css, blocked: 0 })
  })

  it('in trackers mode only drops urls on tracker hosts', () => {
    const css = `a{background:url(https://a/b.png)} b{background:url(https://${TRACKER_HOSTS[0]}/t.gif)}`
    expect(blockCssUrls(css, 'trackers')).toEqual({
      css: 'a{background:url(https://a/b.png)} b{background:url("")}',
      blocked: 1,
    })
  })

  it('ends a malformed unquoted url at the first ")" and resumes there', () => {
    for (const css of [
      'a{background:url(data:x" ); background:url(https://a/x.png) ; ")}',
      'a{background:url(data:x( ); background:url(https://a/x.png)}',
    ]) {
      const result = blockCssUrls(css)
      expect(result.css).not.toContain('https://')
      expect(result.blocked).toBe(2)
    }
  })

  it('scans a long run of whitespace in linear time', () => {
    for (const tail of ['x)', 'x']) {
      const css = `a{background:url(a${' '.repeat(200000)}${tail}}`
      const start = performance.now()
      const result = blockCssUrls(css)
      expect(performance.now() - start).toBeLessThan(200)
      expect(result.blocked).toBe(1)
    }
  })

  it('reads only css whitespace as whitespace', () => {
    const css = 'a{background:url(data:x\u00a0y\ufeff)}'
    expect(blockCssUrls(css)).toEqual({ css, blocked: 0 })
  })

  it('drops a malformed url on a tracker host when remote is allowed', () => {
    const css = `a{background:url(https://x.${TRACKER_HOSTS[0]}/ x)}`
    expect(blockCssUrls(css, 'trackers')).toEqual({ css: 'a{background:url("")}', blocked: 1 })
  })

  it('keeps a local url padded with whitespace', () => {
    const css = 'a{background:url( data:image/png;base64,AAA )}'
    expect(blockCssUrls(css)).toEqual({ css, blocked: 0 })
  })

  it('keeps data and cid urls', () => {
    const css = 'a{background:url(data:image/png;base64,AAAA)} b{background:url("cid:x")}'
    expect(blockCssUrls(css)).toEqual({ css, blocked: 0 })
  })
})

describe('isTrackerUrl', () => {
  it('matches hosts and subdomains, including protocol-relative urls', () => {
    expect(isTrackerUrl(`//x.${TRACKER_HOSTS[0]}/o.gif`)).toBe(true)
    expect(isTrackerUrl('https://example.com/o.gif')).toBe(false)
  })
})

describe('shouldShowRemote', () => {
  it('follows the setting, and trust always wins', () => {
    expect(shouldShowRemote('replied', { trusted: false, repliedTo: true })).toBe(true)
    expect(shouldShowRemote('replied', { trusted: false, repliedTo: false })).toBe(false)
    expect(shouldShowRemote('ask', { trusted: false, repliedTo: true })).toBe(false)
    expect(shouldShowRemote('ask', { trusted: true, repliedTo: false })).toBe(true)
    expect(shouldShowRemote('always', { trusted: false, repliedTo: false })).toBe(true)
  })
})

describe('trusted senders', () => {
  beforeEach(() => fakeBrowser.reset())

  it('stores them per account, case-insensitively', async () => {
    await trustSender('a@gmail.com', 'Bob@Example.com')
    await trustSender('a@gmail.com', 'bob@example.com')
    expect([...(await getTrustedSenders('a@gmail.com'))]).toEqual(['bob@example.com'])
    expect((await getTrustedSenders('b@gmail.com')).size).toBe(0)
  })
})
