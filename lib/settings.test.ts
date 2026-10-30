import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { getSettings, updateSettings } from './settings'

vi.stubGlobal('browser', fakeBrowser)

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset())

  it('defaults until changed, then keeps the other settings', async () => {
    expect(await getSettings()).toEqual({ notifications: true, pollMinutes: 0.5 })
    await updateSettings({ pollMinutes: 5 })
    await updateSettings({ notifications: false })
    expect(await getSettings()).toEqual({ notifications: false, pollMinutes: 5 })
  })
})
