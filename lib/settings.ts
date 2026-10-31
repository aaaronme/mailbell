import { queryOptions } from '@tanstack/react-query'

// The user's preferences, one object in storage.local. Read by the popup's
// Settings page and by the background on each poll and notification.

// 'system' plays no sound of our own: the OS plays its notification sound.
// 'custom' is the user's file (lib/sound.ts).
export const SOUNDS = ['system', 'chime', 'ping', 'pop', 'bell', 'custom'] as const
export type SoundId = (typeof SOUNDS)[number]

// What earns a notification. Primary is Gmail's Primary tab: anything not
// sorted into Social, Promotions, Updates or Forums.
export type NotifyFor = 'all' | 'primary' | 'important'

export interface AccountSettings {
  notifications: boolean
  // Unset: the default sound.
  sound?: SoundId
}

export interface Settings {
  notifications: boolean
  notifyFor: NotifyFor
  sound: SoundId
  // No toast and no sound in between; the badge still counts. "HH:MM", and
  // start after end means overnight.
  quietHours: { enabled: boolean; start: string; end: string }
  // By address; an account without an entry uses the defaults.
  accounts: Record<string, AccountSettings>
  pollMinutes: number
  // When opening a mail marks it read.
  markRead: 'delay' | 'immediate' | 'manual'
  // Remote images and styles in mail: 'ask' blocks them until the user allows
  // it for a message or trusts the sender.
  remoteImages: 'ask' | 'always' | 'replied'
}

const STORAGE_KEY = 'settings'
const DEFAULTS: Settings = {
  notifications: true,
  notifyFor: 'all',
  sound: 'system',
  quietHours: { enabled: false, start: '22:00', end: '07:00' },
  accounts: {},
  pollMinutes: 0.5,
  markRead: 'delay',
  remoteImages: 'ask',
}
const DEFAULT_ACCOUNT: AccountSettings = { notifications: true }

export const POLL_MINUTES = [0.5, 1, 5, 15]

export async function getSettings(): Promise<Settings> {
  const { [STORAGE_KEY]: stored } = await browser.storage.local.get<Record<string, Partial<Settings>>>(STORAGE_KEY)
  // A copy: DEFAULTS' nested objects mustn't be shared with callers.
  return { ...structuredClone(DEFAULTS), ...stored }
}

export async function updateSettings(patch: Partial<Settings>) {
  await browser.storage.local.set({ [STORAGE_KEY]: { ...(await getSettings()), ...patch } })
}

export function accountSettings(settings: Settings, account: string): AccountSettings {
  return { ...DEFAULT_ACCOUNT, ...settings.accounts[account] }
}

export async function updateAccountSettings(account: string, patch: Partial<AccountSettings>) {
  const settings = await getSettings()
  await updateSettings({ accounts: { ...settings.accounts, [account]: { ...accountSettings(settings, account), ...patch } } })
}

export function isSettingsChange(changes: Record<string, unknown>, area: string) {
  return area === 'local' && STORAGE_KEY in changes
}

const OTHER_TABS = ['CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']

function inQuietHours({ enabled, start, end }: Settings['quietHours'], now: Date) {
  if (!enabled) return false
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return start <= end ? start <= time && time < end : time >= start || time < end
}

// The sound to notify a new mail with, or null to not notify it at all.
export function notificationSound(
  settings: Settings,
  mail: { account: string; labels?: string[] },
  now = new Date(),
): SoundId | null {
  const account = accountSettings(settings, mail.account)
  const labels = mail.labels ?? []
  const wanted =
    settings.notifyFor === 'all' ||
    (settings.notifyFor === 'important' && labels.includes('IMPORTANT')) ||
    (settings.notifyFor === 'primary' && !labels.some((it) => OTHER_TABS.includes(it)))
  if (!settings.notifications || !account.notifications || !wanted || inQuietHours(settings.quietHours, now)) {
    return null
  }
  return account.sound ?? settings.sound
}

// One query for every reader of the settings, so a write invalidates them all.
export const settingsOptions = queryOptions({ queryKey: ['settings'], queryFn: getSettings })
