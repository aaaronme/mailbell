import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import { getSettings, notificationSound, updateAccountSettings, updateSettings, type Settings } from './settings'

vi.stubGlobal('browser', fakeBrowser)

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset())

  it('defaults until changed, then keeps the other settings', async () => {
    expect(await getSettings()).toMatchObject({ notifications: true, pollMinutes: 0.5, accounts: {} })
    await updateSettings({ pollMinutes: 5 })
    await updateSettings({ notifications: false })
    await updateAccountSettings('a@gmail.com', { sound: 'ping' })
    await updateAccountSettings('a@gmail.com', { notifications: false })
    expect(await getSettings()).toMatchObject({
      notifications: false,
      pollMinutes: 5,
      accounts: { 'a@gmail.com': { notifications: false, sound: 'ping' } },
    })
  })
})

describe('notificationSound', () => {
  let settings: Settings
  const mail = { account: 'a@gmail.com', labels: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'] }
  const at = (time: string) => new Date(`2026-10-30T${time}:00`)
  beforeEach(async () => {
    fakeBrowser.reset()
    settings = await getSettings()
  })

  it('uses the account sound over the default', () => {
    expect(notificationSound({ ...settings, sound: 'chime' }, mail)).toBe('chime')
    settings.accounts['a@gmail.com'] = { notifications: true, sound: 'bell' }
    expect(notificationSound(settings, mail)).toBe('bell')
    expect(notificationSound(settings, { ...mail, account: 'b@gmail.com' })).toBe('system')
  })

  it('stays silent when notifications are off, globally or for the account', () => {
    expect(notificationSound({ ...settings, notifications: false }, mail)).toBeNull()
    settings.accounts['a@gmail.com'] = { notifications: false }
    expect(notificationSound(settings, mail)).toBeNull()
  })

  it('filters by Primary or Important', () => {
    const promo = { ...mail, labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }
    const important = { ...mail, labels: ['INBOX', 'IMPORTANT', 'CATEGORY_UPDATES'] }
    const primary = { ...settings, notifyFor: 'primary' as const }
    expect(notificationSound(primary, mail)).not.toBeNull()
    // No category labels: inbox tabs off, everything is Primary.
    expect(notificationSound(primary, { ...mail, labels: undefined })).not.toBeNull()
    expect(notificationSound(primary, promo)).toBeNull()
    const onlyImportant = { ...settings, notifyFor: 'important' as const }
    expect(notificationSound(onlyImportant, important)).not.toBeNull()
    expect(notificationSound(onlyImportant, mail)).toBeNull()
  })

  it('stays silent in quiet hours, overnight or not', () => {
    const night = { ...settings, quietHours: { enabled: true, start: '22:00', end: '07:00' } }
    expect(notificationSound(night, mail, at('23:30'))).toBeNull()
    expect(notificationSound(night, mail, at('06:59'))).toBeNull()
    expect(notificationSound(night, mail, at('07:00'))).not.toBeNull()
    expect(notificationSound(night, mail, at('12:00'))).not.toBeNull()
    const lunch = { ...settings, quietHours: { enabled: true, start: '12:00', end: '13:00' } }
    expect(notificationSound(lunch, mail, at('12:30'))).toBeNull()
    expect(notificationSound(lunch, mail, at('13:30'))).not.toBeNull()
    expect(notificationSound({ ...lunch, quietHours: { ...lunch.quietHours, enabled: false } }, mail, at('12:30'))).not.toBeNull()
  })
})
