export interface Settings {
  // Off: only the toolbar badge counts new mail, with no toast and no sound.
  notifications: boolean
  pollMinutes: number
}

const STORAGE_KEY = 'settings'
const DEFAULTS: Settings = { notifications: true, pollMinutes: 0.5 }

// Gmail's quota allows far more; past 15 minutes the badge is just stale.
export const POLL_MINUTES = [0.5, 1, 5, 15]

export async function getSettings(): Promise<Settings> {
  const { [STORAGE_KEY]: stored } = await browser.storage.local.get<Record<string, Partial<Settings>>>(STORAGE_KEY)
  return { ...DEFAULTS, ...stored }
}

export async function updateSettings(patch: Partial<Settings>) {
  await browser.storage.local.set({ [STORAGE_KEY]: { ...(await getSettings()), ...patch } })
}

export function isSettingsChange(changes: Record<string, unknown>, area: string) {
  return area === 'local' && STORAGE_KEY in changes
}
