import { Button } from '@/components/ui/button'
import { clearDebugLogs, getDebugLogs } from '@/lib/debugLog'
import { CopyIcon, RotateCwIcon, Trash2Icon } from 'lucide-react'
import { PageHeader, PageTitle } from '@/components/extra/PageHeader'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

const debugLogsQueryKey = ['debugLogs']

export function DebugLogPage() {
  const queryClient = useQueryClient()
  const logsQuery = useQuery({ queryKey: debugLogsQueryKey, queryFn: getDebugLogs })
  const logs = logsQuery.data ?? []

  async function copy() {
    await navigator.clipboard.writeText(logs.join('\n'))
    toast.success('Copied')
  }

  async function clear() {
    await clearDebugLogs()
    await queryClient.invalidateQueries({ queryKey: debugLogsQueryKey })
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        back
        title={
          <PageTitle>
            Debug log<span className="ml-1.5 font-sans text-sm text-foreground/40 tabular-nums">{logs.length}</span>
          </PageTitle>
        }
      >
        <Button size="icon" variant="ghost" title="Refresh" onClick={() => logsQuery.refetch()}>
          <RotateCwIcon />
        </Button>
        <Button size="icon" variant="ghost" title="Copy" onClick={copy}>
          <CopyIcon />
        </Button>
        <Button size="icon" variant="ghost" title="Clear" onClick={clear}>
          <Trash2Icon />
        </Button>
      </PageHeader>
      <pre className="flex-1 p-4 font-mono text-xs break-all whitespace-pre-wrap text-foreground/80">
        {logs.length > 0 ? logs.join('\n') : 'No log entries yet.'}
      </pre>
    </div>
  )
}
