import { debugLog } from '@/lib/debugLog'
import type { SoundId } from '@/lib/settings'
import type { PublicPath } from 'wxt/browser'

// The user's own sound file, kept as a data URL: an extension can't read a
// file:// path later, so the file's bytes have to be stored when it's picked.
export interface NotificationSound {
  name: string
  dataUrl: string
}

const STORAGE_KEY = 'notificationSound'
export const MAX_SOUND_BYTES = 2 * 1024 * 1024

export async function getNotificationSound(): Promise<NotificationSound | null> {
  const { [STORAGE_KEY]: sound = null } = await browser.storage.local.get<Record<string, NotificationSound | null>>(
    STORAGE_KEY,
  )
  return sound
}

export async function setNotificationSound(file: File): Promise<NotificationSound> {
  if (file.size > MAX_SOUND_BYTES) {
    throw new Error(`Sound file is larger than ${MAX_SOUND_BYTES / 1024 / 1024} MB`)
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  const sound = { name: file.name, dataUrl }
  await browser.storage.local.set({ [STORAGE_KEY]: sound })
  return sound
}

// The audio for a sound choice: a bundled file, the user's file, or null for
// the system sound (or a custom choice whose file is gone).
async function soundUrl(id: SoundId): Promise<string | null> {
  if (id === 'system') return null
  if (id === 'custom') return (await getNotificationSound())?.dataUrl ?? null
  return browser.runtime.getURL(`/sounds/${id}.wav` as PublicPath)
}

export async function previewSound(id: SoundId) {
  const url = await soundUrl(id)
  if (url) await new Audio(url).play()
}

// Needs a page with Audio: Firefox's background is an event page and has one;
// Chrome's service worker doesn't.
export async function playNotificationSound(id: SoundId) {
  if (typeof Audio === 'undefined') return
  const url = await soundUrl(id)
  if (!url) return
  try {
    await new Audio(url).play()
    await debugLog('playNotificationSound: played ->', id)
  } catch (err) {
    await debugLog('playNotificationSound: failed ->', String(err))
  }
}
