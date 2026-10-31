import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ThreadRow } from '../api/mailbox'
import { threadOptions } from './queries'

const FIRST = 10
const REACH = 3
const CONCURRENCY = 2

// The rows worth having ready: those around the selection, nearest first, then
// the top of the list. The selection itself is loaded by the open view.
export function preloadTargets(rows: string[], selected: number): string[] {
  const near = selected < 0 ? [] : Array.from({ length: REACH }, (_, i) => [selected + i + 1, selected - i - 1]).flat()
  const picked = [...near.map((i) => rows[i]), ...rows.slice(0, FIRST)]
  return [...new Set(picked)].filter((it): it is string => it !== undefined && it !== rows[selected])
}

// Warms the thread cache in the background, two requests at a time. Only reads.
export function usePreload(rows: ThreadRow[], selectedUrl?: string) {
  const queryClient = useQueryClient()
  const key = useMemo(() => {
    const urls = rows.map((it) => it.url)
    return preloadTargets(urls, selectedUrl ? urls.indexOf(selectedUrl) : -1).join('\n')
  }, [rows, selectedUrl])

  useEffect(() => {
    if (!key) return
    const queue = key.split('\n')
    let cancelled = false
    const worker = async () => {
      for (let url = queue.shift(); url && !cancelled; url = queue.shift()) {
        const options = threadOptions(url)
        if (queryClient.getQueryState(options.queryKey)?.data) continue
        await queryClient.prefetchQuery(options)
      }
    }
    for (let i = 0; i < CONCURRENCY; i++) void worker()
    return () => {
      cancelled = true
    }
  }, [key, queryClient])
}
