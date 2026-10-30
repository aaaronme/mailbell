import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon } from 'lucide-react'
import { PageHeader, PageTitle } from '@/components/extra/PageHeader'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { bgMessager } from '@/lib/messager'
import { getBuiltInClient, getCustomClient } from '@/lib/auth/oauth'
import { useAccounts } from '@/lib/useAccounts'

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
    <section className="flex flex-col gap-3 border-b border-foreground/10 p-4">
      <h2 className="text-xs font-medium text-foreground/60">{title}</h2>
      {children}
    </section>
  )
}

function AccountsSection() {
  const queryClient = useQueryClient()
  const accounts = useAccounts().data ?? []

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
      <ClientSection />
    </div>
  )
}
