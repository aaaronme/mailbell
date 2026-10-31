import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { blockCssUrls, getTrustedSenders, isTracker, shouldShowRemote, trustSender, TRACKER_HOSTS } from './remoteContent'

vi.stubGlobal('browser', fakeBrowser)

describe('isTracker', () => {
  it('flags tiny and hidden images and known hosts', () => {
    expect(isTracker({ src: 'https://a/p.gif', width: '1', height: '1' })).toBe(true)
    expect(isTracker({ src: 'https://a/p.gif', height: '1px' })).toBe(true)
    expect(isTracker({ src: 'https://a/p.gif', style: 'dis\\70lay: none' })).toBe(true)
    expect(isTracker({ src: 'https://a/p.gif', style: 'visibility:hidden' })).toBe(true)
    expect(isTracker({ src: 'https://a/p.gif', style: 'opacity:0' })).toBe(true)
    expect(isTracker({ src: `https://sub.${TRACKER_HOSTS[0]}/x.png` })).toBe(true)
  })

  it('leaves ordinary images alone', () => {
    expect(isTracker({ src: 'https://a/p.png', width: '40', height: '20', style: 'opacity:0.5' })).toBe(false)
    expect(isTracker({ src: 'https://a/p.png', width: '100%' })).toBe(false)
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

  it('keeps data and cid urls', () => {
    const css = 'a{background:url(data:image/png;base64,AAAA)} b{background:url("cid:x")}'
    expect(blockCssUrls(css)).toEqual({ css, blocked: 0 })
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
