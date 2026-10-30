import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { bgMessager } from '@/lib/messager'
import { getBuiltInClient, getCustomClient, setCustomClient } from '@/lib/auth/oauth'
import { accountsQueryKey, useAccounts } from '@/lib/useAccounts'
import { mailQueryKey } from '@/lib/useMailQuery'

const clientQueryKey = ['oauthClient']

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
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

function AccountsSection() {
  const queryClient = useQueryClient()
  const accounts = useAccounts().data ?? []

  async function remove(email: string) {
    await bgMessager.sendMessage('removeAccount', email)
    await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
    await queryClient.invalidateQueries({ queryKey: mailQueryKey })
  }

  return (
    <Section title="Accounts">
      {accounts.length === 0 && <p className="text-muted-foreground">No account signed in.</p>}
      {accounts.map((account) => (
        <div key={account.email} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="truncate">{account.email}</div>
            {account.needsReauth && <div className="text-xs text-destructive">Signed out by Google</div>}
          </div>
          {account.needsReauth && (
            <Button size="sm" onClick={() => addAccount(account.email)}>
              Reconnect
            </Button>
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
    await setCustomClient(next)
    await bgMessager.sendMessage('refreshThreads', undefined)
    await Promise.all(
      [clientQueryKey, accountsQueryKey, mailQueryKey].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
    toast.success('OAuth client saved')
  }

  return (
    <Section title="Google OAuth client">
      <p className="text-xs text-muted-foreground">
        {clientQuery.data
          ? 'Using your own client.'
          : hasBuiltIn
            ? "Using Mailbell's built-in client. Use your own Google Cloud client instead to skip the unverified-app warning and its user limit."
            : 'This build has no built-in client: add your own Google Cloud client to sign in.'}{' '}
        <a
          className="underline"
          href="https://github.com/aaaronme/mailbell/blob/main/docs/SETUP.md"
          target="_blank"
        >
          How to create one
        </a>
      </p>
      <label className="flex flex-col gap-1 text-xs">
        Authorized redirect URI
        <div className="flex gap-1">
          <Input readOnly value={redirectUrl} className="text-xs" onFocus={(ev) => ev.target.select()} />
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
      <label className="flex flex-col gap-1 text-xs">
        Client ID
        <Input value={clientId} onChange={(ev) => setClientId(ev.target.value)} placeholder="….apps.googleusercontent.com" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
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
      <p className="text-xs text-muted-foreground">Changing the client signs out every account.</p>
    </Section>
  )
}

export function SettingsPage() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex items-center px-4 py-2 bg-background shadow-sm border-b border-border gap-2 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate({ to: '/' })}>
          <ArrowLeftIcon className="w-4 h-4" />
        </Button>
        <span className="font-medium text-foreground flex-1">Settings</span>
      </div>
      <div className="flex flex-col gap-6 p-4 text-sm">
        <AccountsSection />
        <ClientSection />
      </div>
    </div>
  )
}
