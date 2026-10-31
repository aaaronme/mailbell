import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken } from '../auth/oauth'
import { setTokenSource } from '../api/gmail'

vi.mock('@/lib/messager', () => ({ bgMessager: { sendMessage: vi.fn(async () => undefined) } }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const target = (threadId: string) => ({ account: 'me@gmail.com', threadId, url: 'u' + threadId })

describe('undo', () => {
  let undo: typeof import('./undo')
  let toast: typeof import('sonner').toast
  let fetchMock: ReturnType<typeof vi.fn>
  const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string))

  beforeEach(async () => {
    undo = await import('./undo')
    ;({ toast } = await import('sonner'))
    vi.mocked(toast).mockClear()
    vi.mocked(toast.error).mockClear()
    setTokenSource(async () => 'T')
    fetchMock = vi.fn(async () => Response.json({}))
    vi.stubGlobal('fetch', fetchMock)
    // The module keeps the latest entry between tests.
    await undo.undoLatest()
    fetchMock.mockClear()
    vi.mocked(toast).mockClear()
  })
  afterEach(() => {
    setTokenSource(getAccessToken)
    vi.unstubAllGlobals()
  })

  it('offers Undo after success', async () => {
    await undo.runUndoable({ kind: 'archive' }, [target('A')])
    expect(toast).toHaveBeenCalledWith(
      'Archived',
      expect.objectContaining({ id: 'undo', duration: 6000, action: expect.objectContaining({ label: 'Undo' }) }),
    )
  })

  it('offers no undo after a failed action', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 500 }))
    await undo.runUndoable({ kind: 'archive' }, [target('A')])
    expect(toast.error).toHaveBeenCalledWith("Couldn't archive. Try again.")
    fetchMock.mockClear()
    await undo.undoLatest()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('undoes only the latest', async () => {
    await undo.runUndoable({ kind: 'archive' }, [target('A')])
    await undo.runUndoable({ kind: 'star' }, [target('B')])
    fetchMock.mockClear()
    await undo.undoLatest()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/threads/B/modify')
    expect(bodies()[0]).toEqual({ addLabelIds: [], removeLabelIds: ['STARRED'] })
    expect(toast).toHaveBeenLastCalledWith('Undone', { id: 'undo', duration: 2000 })
    fetchMock.mockClear()
    await undo.undoLatest()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('undoes a bulk action as one group', async () => {
    await undo.runUndoable({ kind: 'archive' }, [target('A'), target('B')])
    fetchMock.mockClear()
    await undo.undoLatest()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodies().every((b) => b.addLabelIds.includes('INBOX'))).toBe(true)
  })

  it('runSilent shows no toast and leaves the latest alone', async () => {
    await undo.runUndoable({ kind: 'archive' }, [target('A')])
    vi.mocked(toast).mockClear()
    await undo.runSilent({ kind: 'read' }, [target('B')])
    expect(toast).not.toHaveBeenCalled()
    fetchMock.mockClear()
    await undo.undoLatest()
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/threads/A/modify')
  })
})
