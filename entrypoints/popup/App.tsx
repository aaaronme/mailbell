import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { router } from './router'
import { bgMessager, popupMessager } from '@/lib/messager'
import { mailQueryKey } from '@/lib/useMailQuery'
import { queryClient } from '@/lib/queryClient'
import { useEffectOnce } from '@/lib/utils/useEffectOnce'

function AppContent() {
  const queryClient = useQueryClient()
  useEffectOnce(() => {
    // Lives here, not in a specific route's component: this has to run once
    // per popup session, not once per visit to whichever route happens to
    // mount it. useMailQuery already reads whatever background last wrote
    // as soon as any component using it mounts - no separate "show cached
    // snapshot" pull needed. This only needs to (a) invalidate the query
    // when background pushes 'refreshPopup', so any mounted useMailQuery
    // re-reads storage, and (b) kick off an actual fresh remote fetch:
    // background's own alarm runs on its own schedule, and the popup could
    // sit on stale data until it fires.
    popupMessager.onMessage('refreshPopup', () => {
      queryClient.invalidateQueries({ queryKey: mailQueryKey })
    })
    // An ordinary poll: the refresh button is what re-reads every thread.
    bgMessager.sendMessage('poll', undefined).catch((err) => console.error('poll failed', err))
    return () => {
      popupMessager.removeAllListeners()
    }
  })
  return <RouterProvider router={router} />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster closeButton={true} />
      <AppContent />
    </QueryClientProvider>
  )
}

export default App
