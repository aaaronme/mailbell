import { QueryClient } from '@tanstack/react-query'
import { isQuotaError } from './api/gmail'

const RETRIES = 3

// One shared instance between App.tsx (QueryClientProvider) and the detail
// route's loader (router.tsx) - the loader calls ensureQueryData on this
// same client so DetailPage's own useMailQuery() call sees already-warm
// data on its first render, instead of a separate, independent fetch.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Each retry of a refused call spends more of the quota it ran out of.
      retry: (failures, err) => failures < RETRIES && !isQuotaError(err),
    },
  },
})
