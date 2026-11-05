import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)

const { claimMailTab, retireMailTab } = await import('./mailTab')
const { popupMessager } = await import('./messager')

describe('mail tab', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  // The lock outlives each test, as it does the tab that holds it.
  it('goes to the first tab alone, which comes forward when asked', async () => {
    const listen = vi.spyOn(popupMessager, 'onMessage')
    const update = vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never)
    const focus = vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as never)
    vi.spyOn(fakeBrowser.tabs, 'getCurrent').mockResolvedValue({ id: 3, windowId: 7 } as never)

    expect(await claimMailTab()).toBe(true)
    expect(await claimMailTab()).toBe(false)

    expect(listen).toHaveBeenCalledTimes(1)
    const [type, answer] = listen.mock.calls[0]!
    expect(type).toBe('focusMailTab')
    expect(await (answer as () => Promise<boolean>)()).toBe(true)
    expect(update).toHaveBeenCalledWith(3, { active: true })
    expect(focus).toHaveBeenCalledWith(7, { focused: true })
  })

  it('closes this tab once the open one has come forward', async () => {
    vi.spyOn(popupMessager, 'sendMessage').mockResolvedValue(true as never)
    vi.spyOn(fakeBrowser.tabs, 'getCurrent').mockResolvedValue({ id: 4 } as never)
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never)
    expect(await retireMailTab()).toBe(true)
    expect(remove).toHaveBeenCalledWith(4)
  })

  it('stays open when the open tab does not answer', async () => {
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never)
    vi.spyOn(popupMessager, 'sendMessage').mockRejectedValue(new Error('no receiver'))
    expect(await retireMailTab()).toBe(false)
    vi.spyOn(popupMessager, 'sendMessage').mockResolvedValue(undefined as never)
    expect(await retireMailTab()).toBe(false)
    expect(remove).not.toHaveBeenCalled()
  })

  it('stays open when it cannot close', async () => {
    vi.spyOn(popupMessager, 'sendMessage').mockResolvedValue(true as never)
    vi.spyOn(fakeBrowser.tabs, 'getCurrent').mockResolvedValue({ id: 4 } as never)
    vi.spyOn(fakeBrowser.tabs, 'remove').mockRejectedValue(new Error('no'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await retireMailTab()).toBe(false)
  })

  it('gives up on an open tab that never answers', async () => {
    vi.spyOn(popupMessager, 'sendMessage').mockReturnValue(new Promise(() => {}) as never)
    expect(await retireMailTab(1)).toBe(false)
  })
})
