import { useEffect, useMemo, useRef } from 'react'
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

// Warms the thread cache in the background, two requests at a time across
// target changes. Only reads.
export function usePreload(rows: ThreadRow[], selectedUrl?: string) {
  const queryClient = useQueryClient()
  const key = useMemo(() => {
    const urls = rows.map((it) => it.url)
    return preloadTargets(urls, selectedUrl ? urls.indexOf(selectedUrl) : -1).join('\n')
  }, [rows, selectedUrl])
  // In-flight requests outlive an effect run, so the count does too.
  const pool = useRef({ active: 0, queue: [] as string[] })

  useEffect(() => {
    const state = pool.current
    state.queue = key ? key.split('\n') : []
    const pump = () => {
      while (state.active < CONCURRENCY && state.queue.length) {
        const options = threadOptions(state.queue.shift())
        if (queryClient.getQueryState(options.queryKey)?.data) continue
        state.active++
        void queryClient.prefetchQuery(options).finally(() => {
          state.active--
          pump()
        })
      }
    }
    pump()
    return () => {
      state.queue = []
    }
  }, [key, queryClient])
}
