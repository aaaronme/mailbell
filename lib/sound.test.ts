import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'

vi.stubGlobal('browser', fakeBrowser)

const { getNotificationSound, setNotificationSound, playNotificationSound, MAX_SOUND_BYTES } =
  await import('./sound')

describe('notification sound', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.unstubAllGlobals()
    vi.stubGlobal('browser', fakeBrowser)
  })

  it('stores the picked file and plays it on notify', async () => {
    const play = vi.fn(async () => {})
    const Audio = vi.fn(function (this: { play: typeof play }) {
      this.play = play
    })
    vi.stubGlobal('Audio', Audio)
    await setNotificationSound(new File(['abc'], 'New Mail.wav', { type: 'audio/wav' }))
    expect((await getNotificationSound())?.name).eq('New Mail.wav')
    await playNotificationSound('custom')
    expect(Audio).toHaveBeenCalledWith(expect.stringMatching(/^data:audio\/wav;base64,/))
    expect(play).toHaveBeenCalledOnce()

    await playNotificationSound('chime')
    expect(Audio).toHaveBeenLastCalledWith(expect.stringMatching(/\/sounds\/chime\.wav$/))

    // The system sound, or a custom choice with its file gone: nothing of ours.
    await fakeBrowser.storage.local.remove('notificationSound')
    await playNotificationSound('custom')
    await playNotificationSound('system')
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('rejects files that are too large', async () => {
    const big = new File([new Uint8Array(MAX_SOUND_BYTES + 1)], 'big.wav')
    await expect(setNotificationSound(big)).rejects.toThrow('larger than')
    expect(await getNotificationSound()).toBeNull()
  })
})
