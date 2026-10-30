import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { bgMessager } from '@/lib/messager'
import { getBuiltInClient, getClient, getCustomClient } from '@/lib/auth/oauth'

export const customClientQueryKey = ['oauthClient', 'custom']
const clientQueryKey = ['oauthClient', 'effective']

// The client sign-in will use: the user's own, else the one built into the
// release. Null means nobody can sign in until the user adds one.
export function useClient() {
  return useQuery({ queryKey: clientQueryKey, queryFn: getClient })
}

export const SETUP_GUIDE_URL = 'https://github.com/aaaronme/mailbell/blob/main/docs/SETUP.md'

// The redirect URI to register with Google. It depends on the extension's ID,
// so a self-loaded build and the store release each show their own.
export function RedirectUri() {
  const redirectUrl = browser.identity.getRedirectURL()
  return (
    <div className="flex items-center gap-1">
      <Input
        readOnly
        aria-label="Authorized redirect URI"
        value={redirectUrl}
        className="font-mono text-xs"
        onFocus={(ev) => ev.target.select()}
      />
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
  )
}

// Client ID and secret. `onSaved` runs after a client was saved (not removed).
export function ClientForm({ submitLabel = 'Save', onSaved }: { submitLabel?: string; onSaved?: () => void }) {
  const queryClient = useQueryClient()
  const customQuery = useQuery({ queryKey: customClientQueryKey, queryFn: getCustomClient })
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  useEffect(() => {
    setClientId(customQuery.data?.clientId ?? '')
    setClientSecret(customQuery.data?.clientSecret ?? '')
  }, [customQuery.data])

  async function save(next: { clientId: string; clientSecret: string } | null) {
    await bgMessager.sendMessage('setOAuthClient', next)
    await queryClient.invalidateQueries()
    toast.success(next ? 'OAuth client saved' : 'OAuth client removed')
    if (next) onSaved?.()
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(ev) => {
        ev.preventDefault()
        if (clientId.trim()) void save({ clientId, clientSecret })
      }}
    >
      <label className="flex flex-col gap-1.5 text-xs text-foreground/60">
        Client ID
        <Input value={clientId} onChange={(ev) => setClientId(ev.target.value)} placeholder="….apps.googleusercontent.com" />
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-foreground/60">
        Client secret
        <Input type="password" value={clientSecret} onChange={(ev) => setClientSecret(ev.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={!clientId.trim()}>
          {submitLabel}
        </Button>
        {customQuery.data && (
          <Button size="sm" variant="secondary" type="button" onClick={() => save(null)}>
            {getBuiltInClient() ? 'Use built-in client' : 'Remove'}
          </Button>
        )}
      </div>
    </form>
  )
}
