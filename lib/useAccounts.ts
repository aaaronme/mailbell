import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getAccounts } from './auth/oauth'

export const accountsQueryKey = ['oauthAccounts'] as const

// The signed-in accounts as the popup shows them - never the tokens.
export async function fetchAccounts() {
  return (await getAccounts()).map(({ email, needsReauth }) => ({ email, needsReauth: !!needsReauth }))
}

export function useAccounts() {
  const queryClient = useQueryClient()
  // Sign-in finishes in the background, usually after the popup reopened.
  useEffect(() => {
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && 'oauthAccounts' in changes) {
        void queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      }
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  }, [queryClient])
  return useQuery({ queryKey: accountsQueryKey, queryFn: fetchAccounts })
}
