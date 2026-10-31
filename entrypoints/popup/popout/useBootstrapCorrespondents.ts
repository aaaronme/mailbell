import { useEffect } from 'react'
import { bootstrapCorrespondents } from '@/lib/mail/correspondents'

// Seeds the recipient suggestions of each account once; the sidebar may be closed.
export function useBootstrapCorrespondents(accounts: { email: string }[]) {
  const key = accounts.map((it) => it.email).join('\n')
  useEffect(() => {
    for (const email of key ? key.split('\n') : []) bootstrapCorrespondents(email).catch(() => {})
  }, [key])
}
