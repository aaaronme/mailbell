import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setTokenSource, threadUrl } from '../api/gmail'
import type { ThreadRow } from '../api/mailbox'
import { preloadTargets, usePreload } from './preload'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`)

describe('preloadTargets', () => {
  it('puts the neighbours nearest first, then the first rows', () => {
    const all = ids(30)
    const out = preloadTargets(all, 12)
    expect(out).toEqual([...[13, 11, 14, 10, 15, 9].map((i) => all[i]), ...all.slice(0, 9)])
    expect(out).toHaveLength(15)
  })

  it('is the first rows alone with nothing selected', () => {
    expect(preloadTargets(ids(5), -1)).toEqual(ids(5))
    expect(preloadTargets(ids(30), -1)).toEqual(ids(10))
  })

  it('stays inside the list near its edges', () => {
    expect(preloadTargets(ids(4), 3)).toEqual(['t2', 't1', 't0'])
  })
})

const A = 'a@example.com'
const row = (id: string) => ({ account: A, threadId: id, url: threadUrl(A, id), labelIds: ['INBOX'] }) as ThreadRow

describe('usePreload', () => {
  let paths: string[]
  let release: (() => void)[]
  let inFlight: number
  let peak: number

  beforeEach(() => {
    paths = []
    release = []
    inFlight = 0
    peak = 0
    setTokenSource(async () => 'T')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(input).pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
        paths.push(`${init?.method ?? 'GET'} ${path}`)
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise<void>((resolve) => release.push(resolve))
        inFlight--
        const id = path.slice('/threads/'.length)
        return Response.json({
          id,
          messages: [{ id: 'm', labelIds: ['INBOX'], internalDate: '1', payload: { headers: [] } }],
        })
      }),
    )
  })

  const mount = (rows: ThreadRow[], selected?: string) => {
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
    return renderHook((props?: { rows: ThreadRow[]; selected?: string }) => usePreload(props!.rows, props!.selected), {
      wrapper,
      initialProps: { rows, selected },
    })
  }
  const drain = async () => {
    while (release.length) release.shift()!()
    await new Promise((r) => setTimeout(r, 20))
  }

  it('loads at most two at a time and never modifies', async () => {
    await mount(ids(6).map(row), threadUrl(A, 't2'))
    await vi.waitFor(() => expect(paths.length).toBe(2))
    for (let i = 0; i < 8; i++) await drain()
    expect(peak).toBe(2)
    expect(paths.length).toBe(5)
    expect(paths.every((it) => it.startsWith('GET /threads/'))).toBe(true)
    expect(paths.some((it) => it.includes('/modify'))).toBe(false)
    expect(paths).not.toContain('GET /threads/t2')
  })

  it('abandons queued loads when the targets change', async () => {
    const view = await mount(ids(30).map(row), threadUrl(A, 't12'))
    await vi.waitFor(() => expect(paths.length).toBe(2))
    await view.rerender({ rows: ids(30).map(row), selected: threadUrl(A, 't25') })
    for (let i = 0; i < 40; i++) await drain()
    expect(peak).toBeLessThanOrEqual(2)
    expect(paths).toContain('GET /threads/t24')
    // Only the two already in flight finished from the old targets.
    expect(paths).not.toContain('GET /threads/t14')
  })
})
