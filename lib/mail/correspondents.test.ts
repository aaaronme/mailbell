import { fakeBrowser } from '@webext-core/fake-browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken } from '../auth/oauth'
import { setTokenSource } from '../api/gmail'
import { addCorrespondents, bootstrapCorrespondents, getCorrespondents } from './correspondents'

const A = 'me@gmail.com'

beforeEach(async () => {
  vi.stubGlobal('browser', fakeBrowser)
  vi.stubGlobal('chrome', fakeBrowser)
  await fakeBrowser.storage.local.clear()
})
afterEach(() => {
  setTokenSource(getAccessToken)
  vi.unstubAllGlobals()
})

describe('correspondents store', () => {
  it('lower-cases and dedupes', async () => {
    await addCorrespondents(A, ['Bob@X.com', 'bob@x.com', 'ann@y.com'])
    await addCorrespondents(A, ['ANN@y.com'])
    expect([...(await getCorrespondents(A))].sort()).toEqual(['ann@y.com', 'bob@x.com'])
  })
  it('keeps accounts apart', async () => {
    await addCorrespondents(A, ['a@x.com'])
    expect((await getCorrespondents('other@gmail.com')).size).toBe(0)
  })
  it('caps at 5000, keeping the newest', async () => {
    await addCorrespondents(
      A,
      Array.from({ length: 5000 }, (_, i) => `u${i}@x.com`),
    )
    await addCorrespondents(A, ['new1@x.com', 'new2@x.com'])
    const got = await getCorrespondents(A)
    expect(got.size).toBe(5000)
    expect(got.has('new2@x.com')).toBe(true)
    expect(got.has('u0@x.com')).toBe(false)
    expect(got.has('u2@x.com')).toBe(true)
  })
})

describe('bootstrapCorrespondents', () => {
  it('reads recent Sent once', async () => {
    setTokenSource(async () => 'T')
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url)
      const path = u.pathname.split('/users/me')[1]
      if (path === '/messages') {
        expect(u.searchParams.get('labelIds')).toBe('SENT')
        expect(u.searchParams.get('maxResults')).toBe('200')
        return Response.json({ messages: [{ id: 'm1' }, { id: 'm2' }] })
      }
      expect(u.searchParams.get('format')).toBe('metadata')
      const to = path === '/messages/m1' ? 'Ann <Ann@Y.com>, "Doe, Jo" <jo@z.com>' : 'bob@x.com'
      return Response.json({
        id: 'x',
        threadId: 't',
        internalDate: '1',
        payload: {
          headers: [
            { name: 'To', value: to },
            { name: 'Cc', value: 'cc@w.com' },
          ],
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await bootstrapCorrespondents(A)
    expect([...(await getCorrespondents(A))].sort()).toEqual(['ann@y.com', 'bob@x.com', 'cc@w.com', 'jo@z.com'])
    const calls = fetchMock.mock.calls.length
    await bootstrapCorrespondents(A)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })
})
