import { useCallback, useEffect, useRef } from 'react'
import { parseThreadUrl } from '../api/gmail'
import type { OpenThread } from '../api/mailbox'
import type { Settings } from '../settings'
import { runSilent } from './undo'

const DELAY_MS = 2000

// Marks the open thread read per the setting. A selection is a thread url:
// leaving it and coming back starts over, but within one it is marked once.
export function useMarkRead(thread: OpenThread | undefined, mode: Settings['markRead']): { engage(): void; keepUnread(): void } {
  const latest = useRef(thread)
  latest.current = thread
  const marked = useRef<string | undefined>(undefined)
  const url = thread?.url

  const mark = useCallback(() => {
    const it = latest.current
    const parsed = it && parseThreadUrl(it.url)
    if (!it || !parsed || marked.current === it.url || !it.labelIds.includes('UNREAD')) return
    marked.current = it.url
    void runSilent({ kind: 'read' }, [{ account: it.account, threadId: parsed.threadId, url: it.url }]).catch(() => {
      // Retryable by the next engage.
      marked.current = undefined
    })
  }, [])

  useEffect(() => {
    marked.current = undefined
  }, [url])

  useEffect(() => {
    if (!url) return
    if (mode === 'immediate') mark()
    if (mode === 'delay') {
      const timer = setTimeout(mark, DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [url, mode, mark])

  const engage = useCallback(() => {
    if (mode !== 'manual') mark()
  }, [mode, mark])
  // The reader chose to leave this selection unread; nothing marks it again.
  const keepUnread = useCallback(() => {
    marked.current = latest.current?.url
  }, [])
  return { engage, keepUnread }
}
