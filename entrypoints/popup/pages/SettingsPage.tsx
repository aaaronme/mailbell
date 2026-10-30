import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, ChevronDownIcon, CopyIcon } from 'lucide-react'
import { PageHeader, PageTitle } from '@/components/extra/PageHeader'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { bgMessager } from '@/lib/messager'
import { getBuiltInClient, getCustomClient } from '@/lib/auth/oauth'
import { useAccounts } from '@/lib/useAccounts'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  accountSettings,
  getSettings,
  POLL_MINUTES,
  SOUNDS,
  updateAccountSettings,
  updateSettings,
  type AccountSettings,
  type NotifyFor,
  type Settings,
  type SoundId,
} from '@/lib/settings'
import { getNotificationSound, previewSound, setNotificationSound } from '@/lib/sound'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isPopoutTab } from '../view'

const clientQueryKey = ['oauthClient']
const settingsQueryKey = ['settings']
const soundQueryKey = ['notificationSound']

// Starts Google's sign-in in the background. In the toolbar popup the call
// never resolves here: the popup closes as soon as the sign-in window opens,
// and the background finishes on its own.
export async function addAccount(loginHint?: string) {
  try {
    const email = await bgMessager.sendMessage('addAccount', loginHint)
    toast.success(`Signed in as ${email}`)
  } catch (err) {
    console.error(err)
    toast.error(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-foreground/10 p-4">
      <h2 className="text-xs font-medium text-foreground/60">{title}</h2>
      {children}
    </section>
  )
}

function AccountsSection() {
  const queryClient = useQueryClient()
  const accounts = useAccounts().data ?? []
  const { settings } = useSettings()

  async function remove(email: string) {
    await bgMessager.sendMessage('removeAccount', email)
    await queryClient.invalidateQueries()
  }

  return (
    <Section title="Accounts">
      {accounts.length === 0 && <p className="text-foreground/60">No account signed in.</p>}
      {accounts.map((account) => (
        <div key={account.email} className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{account.email}</div>
            {account.needsReauth && <div className="text-xs text-destructive">Signed out by Google</div>}
          </div>
          {account.needsReauth ? (
            <Button size="sm" onClick={() => addAccount(account.email)}>
              Reconnect
            </Button>
          ) : (
            settings?.notifications && <AccountNotifications email={account.email} />
          )}
          <Button size="sm" variant="secondary" onClick={() => remove(account.email)}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" onClick={() => addAccount()}>
          Add account
        </Button>
      </div>
    </Section>
  )
}

// Per account: notify or not, and with which sound.
function AccountNotifications({ email }: { email: string }) {
  const { settings, updateAccount } = useSettings()
  if (!settings) return null
  const account = accountSettings(settings, email)
  return (
    <>
      {canPlaySounds && account.notifications && (
        <SoundSelect
          value={account.sound}
          defaultLabel={`Default (${SOUND_LABELS[settings.sound]})`}
          onChange={(sound) => updateAccount(email, { sound })}
        />
      )}
      <Switch
        title="Notifications for this account"
        checked={account.notifications}
        onCheckedChange={(notifications) => updateAccount(email, { notifications })}
      />
    </>
  )
}

// A label on the left, its control on the right, an optional hint below.
function Row({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-8 items-center gap-3">
        <div className="min-w-0 flex-1">{label}</div>
        {children}
      </div>
      {hint && <p className="text-xs text-foreground/40">{hint}</p>}
    </div>
  )
}

function formatMinutes(minutes: number) {
  return minutes < 1 ? `${minutes * 60} s` : `${minutes} min`
}

function useSettings() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: settingsQueryKey, queryFn: getSettings }).data
  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: settingsQueryKey })
  }
  return {
    settings,
    update: (patch: Partial<Settings>) => updateSettings(patch).then(invalidate),
    updateAccount: (account: string, patch: Partial<AccountSettings>) => updateAccountSettings(account, patch).then(invalidate),
  }
}

// Only Firefox's background page can play audio (see lib/sound.ts).
const canPlaySounds = import.meta.env.FIREFOX

function NotificationsSection() {
  const { settings, update } = useSettings()

  if (!settings) return null
  const { quietHours } = settings
  return (
    <Section title="Notifications">
      <Row label="Desktop notifications" hint={settings.notifications ? undefined : 'New mail only updates the unread count on the toolbar icon.'}>
        <Switch checked={settings.notifications} onCheckedChange={(notifications) => update({ notifications })} />
      </Row>
      {settings.notifications && (
        <>
          <Row
            label="Notify for"
            hint={settings.notifyFor === 'primary' ? "Mail Gmail doesn't sort into Social, Promotions, Updates or Forums." : undefined}
          >
            <Choice<NotifyFor>
              options={[
                ['all', 'All new mail'],
                ['primary', 'Primary'],
                ['important', 'Important'],
              ]}
              value={settings.notifyFor}
              onChange={(notifyFor) => update({ notifyFor })}
            />
          </Row>
          {canPlaySounds && (
            <Row
              label="Sound"
              hint={
                settings.sound === 'system'
                  ? undefined
                  : 'To avoid hearing two sounds, turn off "Play sound for notifications" for Firefox in macOS System Settings → Notifications.'
              }
            >
              <SoundSelect value={settings.sound} onChange={(sound) => update({ sound: sound ?? 'system' })} />
            </Row>
          )}
          <Row label="Quiet hours" hint={quietHours.enabled ? 'No notifications in between; the unread count still updates.' : undefined}>
            {quietHours.enabled && (
              <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                <Input
                  type="time"
                  aria-label="Quiet from"
                  className="w-28 tabular-nums"
                  value={quietHours.start}
                  onChange={(ev) => ev.target.value && update({ quietHours: { ...quietHours, start: ev.target.value } })}
                />
                to
                <Input
                  type="time"
                  aria-label="Quiet until"
                  className="w-28 tabular-nums"
                  value={quietHours.end}
                  onChange={(ev) => ev.target.value && update({ quietHours: { ...quietHours, end: ev.target.value } })}
                />
              </div>
            )}
            <Switch checked={quietHours.enabled} onCheckedChange={(enabled) => update({ quietHours: { ...quietHours, enabled } })} />
          </Row>
        </>
      )}
      <Row label="Check for new mail every">
        <Choice
          options={POLL_MINUTES.map((minutes) => [minutes, formatMinutes(minutes)])}
          value={settings.pollMinutes}
          onChange={(pollMinutes) => update({ pollMinutes })}
        />
      </Row>
    </Section>
  )
}

// A row of buttons, the chosen one filled.
function Choice<T>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex gap-1">
      {options.map(([option, label]) => (
        <Button
          key={String(option)}
          size="sm"
          variant={value === option ? 'default' : 'ghost'}
          className="tabular-nums"
          onClick={() => onChange(option)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

const SOUND_LABELS: Record<SoundId, string> = {
  system: 'System sound',
  chime: 'Chime',
  ping: 'Ping',
  pop: 'Pop',
  bell: 'Bell',
  custom: 'Your file',
}

// Picks a sound and plays it. With `defaultLabel`, undefined is a choice too
// (an account using the default sound).
function SoundSelect({
  value,
  onChange,
  defaultLabel,
}: {
  value: SoundId | undefined
  onChange: (sound: SoundId | undefined) => void
  defaultLabel?: string
}) {
  const queryClient = useQueryClient()
  const custom = useQuery({ queryKey: soundQueryKey, queryFn: getNotificationSound }).data ?? null
  const fileInput = useRef<HTMLInputElement>(null)

  function choose(sound: SoundId | undefined) {
    onChange(sound)
    if (sound) void previewSound(sound)
  }

  async function pick(file: File | undefined) {
    if (!file) return
    try {
      await setNotificationSound(file)
      await queryClient.invalidateQueries({ queryKey: soundQueryKey })
      choose('custom')
    } catch (err) {
      console.error(err)
      toast.error(String(err))
    }
  }

  function chooseFile() {
    // Firefox closes the toolbar popup as soon as a file dialog opens, so the
    // picker only works in the standalone tab.
    if (isPopoutTab) {
      fileInput.current?.click()
      return
    }
    void browser.tabs.create({ url: browser.runtime.getURL('/popup.html?view=tab&page=/settings') })
    window.close()
  }

  const label = (sound: SoundId) => (sound === 'custom' && custom ? custom.name : SOUND_LABELS[sound])
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" className="max-w-48">
            <span className="truncate">{value ? label(value) : defaultLabel}</span>
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {defaultLabel && <SoundItem label={defaultLabel} checked={!value} onSelect={() => choose(undefined)} />}
          {SOUNDS.filter((sound) => sound !== 'custom' || custom).map((sound) => (
            <SoundItem key={sound} label={label(sound)} checked={value === sound} onSelect={() => choose(sound)} />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={chooseFile}>{custom ? 'Choose another file…' : 'Choose file…'}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input ref={fileInput} type="file" accept="audio/*" className="hidden" onChange={(ev) => pick(ev.target.files?.[0])} />
    </>
  )
}

function SoundItem({ label, checked, onSelect }: { label: string; checked: boolean; onSelect: () => void }) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <CheckIcon className={cn(!checked && 'invisible')} />
      <span className="truncate">{label}</span>
    </DropdownMenuItem>
  )
}

function ClientSection() {
  const queryClient = useQueryClient()
  const clientQuery = useQuery({ queryKey: clientQueryKey, queryFn: getCustomClient })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  useEffect(() => {
    setClientId(clientQuery.data?.clientId ?? '')
    setClientSecret(clientQuery.data?.clientSecret ?? '')
  }, [clientQuery.data])
  const redirectUrl = browser.identity.getRedirectURL()
  const hasBuiltIn = !!getBuiltInClient()

  async function save(next: { clientId: string; clientSecret: string } | null) {
    await bgMessager.sendMessage('setOAuthClient', next)
    await queryClient.invalidateQueries()
    toast.success('OAuth client saved')
  }

  return (
    <Section title="Google OAuth client">
      <p className="text-xs text-foreground/60">
        {clientQuery.data
          ? 'Using your own client.'
          : hasBuiltIn
            ? "Using Mailbell's built-in client. Use your own Google Cloud client instead to skip the unverified-app warning and its user limit."
            : 'This build has no built-in client: add your own Google Cloud client to sign in.'}{' '}
        <a
          className="text-foreground underline underline-offset-2"
          href="https://github.com/aaaronme/mailbell/blob/main/docs/SETUP.md"
          target="_blank"
        >
          How to create one
        </a>
      </p>
      <label className="flex flex-col gap-1.5 text-xs text-foreground/60">
        Authorized redirect URI
        <div className="flex items-center gap-1">
          <Input readOnly value={redirectUrl} className="font-mono text-xs" onFocus={(ev) => ev.target.select()} />
          <Button
            size="icon"
            variant="ghost"
            title="Copy"
            onClick={async () => {
              await navigator.clipboard.writeText(redirectUrl)
              toast.success('Copied')
            }}
          >
            <CopyIcon />
          </Button>
        </div>
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-foreground/60">
        Client ID
        <Input value={clientId} onChange={(ev) => setClientId(ev.target.value)} placeholder="….apps.googleusercontent.com" />
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-foreground/60">
        Client secret
        <Input type="password" value={clientSecret} onChange={(ev) => setClientSecret(ev.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={!clientId.trim()} onClick={() => save({ clientId, clientSecret })}>
          Save
        </Button>
        {clientQuery.data && (
          <Button size="sm" variant="secondary" onClick={() => save(null)}>
            Use built-in client
          </Button>
        )}
      </div>
      {/* No confirm(): Firefox's toolbar popup can't show dialogs. */}
      <p className="text-xs text-foreground/40">Changing the client signs out every account.</p>
    </Section>
  )
}

export function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader back title={<PageTitle>Settings</PageTitle>} />
      <AccountsSection />
      <NotificationsSection />
      <ClientSection />
    </div>
  )
}
