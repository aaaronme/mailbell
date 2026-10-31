import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { defaultParseSearch } from '@tanstack/react-router'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)

const { openPopoutOn, popoutUrl } = await import('./openPopout')
const { popupMessager } = await import('./messager')
const { validateMailSearch } = await import('@/entrypoints/popup/popout/mailSearch')

// Every reserved character a URL can carry, to prove the hash survives them.
const threadUrl = 'https://mail.google.com/mail/?authuser=a%40b.com&x=1#inbox/FMfcg?a=b&c=d#e'
const account = 'a@b.com'

describe('openPopoutOn', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  it('opens a new tab when no popout listens', async () => {
    vi.spyOn(popupMessager, 'sendMessage').mockRejectedValue(new Error('no receiver'))
    const create = vi.spyOn(fakeBrowser.tabs, 'create')
    await openPopoutOn(threadUrl)
    expect(create).toHaveBeenCalledTimes(1)
    const url = new URL(create.mock.calls[0]![0]!.url!)
    expect(url.pathname).toBe('/popup.html')
    expect(url.search).toBe('?view=tab')
    const search = defaultParseSearch(url.hash.slice(url.hash.indexOf('?')))
    expect(validateMailSearch(search)).toMatchObject({ account, folder: 'INBOX', thread: threadUrl })
  })

  it('opens a new tab when the message goes unanswered', async () => {
    vi.spyOn(popupMessager, 'sendMessage').mockResolvedValue(undefined as never)
    const create = vi.spyOn(fakeBrowser.tabs, 'create')
    await openPopoutOn(threadUrl)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('reuses an open popout', async () => {
    const send = vi.spyOn(popupMessager, 'sendMessage').mockResolvedValue(true as never)
    const create = vi.spyOn(fakeBrowser.tabs, 'create')
    await openPopoutOn(threadUrl)
    expect(send).toHaveBeenCalledWith('openThread', threadUrl)
    expect(create).not.toHaveBeenCalled()
  })

  it('builds a popout url for the thread', () => {
    expect(popoutUrl(threadUrl)).toContain('/popup.html?view=tab#/mail?')
  })
})
