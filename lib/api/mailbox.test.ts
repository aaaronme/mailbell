import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken } from '../auth/oauth'
import { setTokenSource, type GmailMessage } from './gmail'
import { decodeEntities, getThreadRowWithLabels, listHistory, listThreadPage, modifyThreads } from './mailbox'

function msg(id: string, date: number, from: string, labels: string[], contentType: string): GmailMessage {
  return {
    id,
    threadId: 't1',
    labelIds: labels,
    snippet: 'snip ' + id,
    internalDate: String(date),
    payload: {
      mimeType: contentType,
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: 'me@gmail.com' },
        { name: 'Subject', value: 'Hello' },
        { name: 'Content-Type', value: contentType },
        ...(id === 'm2' ? [{ name: 'Authentication-Results', value: 'mx; dkim=pass' }] : []),
      ],
    },
  }
}

describe('mailbox api', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    setTokenSource(async () => 'T')
    fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname.split('/users/me')[1]
      if (path === '/threads') return Response.json({ threads: [{ id: 't1' }], nextPageToken: 'next' })
      if (path === '/threads/t1')
        return Response.json({
          id: 't1',
          historyId: '1',
          messages: [
            msg('m1', 1000, 'Ann <a@x.com>', ['INBOX'], 'multipart/mixed; boundary=x'),
            msg('m2', 2000, 'Bob <b@x.com>', ['INBOX', 'UNREAD'], 'multipart/alternative'),
          ],
        })
      return Response.json({})
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    setTokenSource(getAccessToken)
    vi.unstubAllGlobals()
  })

  it('listThreadPage builds rows from metadata', async () => {
    const page = await listThreadPage('me@gmail.com', { labelIds: ['INBOX'], includeSpamTrash: false })
    expect(page.nextPageToken).toBe('next')
    expect(page.rows).toHaveLength(1)
    const row = page.rows[0]!
    expect(row.from.email).toBe('b@x.com')
    expect(row.labelIds).toContain('UNREAD')
    expect(row.hasAttachment).toBe(true)
    expect(row.messageCount).toBe(2)
    expect(row.authResults).toBe('mx; dkim=pass')
    expect(row.date).toBe(new Date(2000).toISOString())
  })

  it('listThreadPage leaves out excluded categories', async () => {
    await listThreadPage('me@gmail.com', {
      labelIds: ['INBOX'],
      excludeLabelIds: ['CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS'],
      includeSpamTrash: false,
    })
    const list = new URL(fetchMock.mock.calls.find(([url]) => new URL(url).pathname.endsWith('/threads'))![0])
    expect(list.searchParams.getAll('labelIds')).toEqual(['INBOX'])
    expect(list.searchParams.get('q')).toBe('-category:social -category:promotions')
  })

  it('listThreadPage asks for a short first page, then full ones', async () => {
    const query = { labelIds: ['INBOX'], includeSpamTrash: false }
    await listThreadPage('me@gmail.com', query)
    await listThreadPage('me@gmail.com', query, 'next')
    const sizes = fetchMock.mock.calls
      .map(([url]) => new URL(url))
      .filter((it) => it.pathname.endsWith('/threads'))
      .map((it) => it.searchParams.get('maxResults'))
    expect(sizes).toEqual(['15', '50'])
  })

  it('listThreadPage fetches a first page of rows all at once, later ones 4 at a time', async () => {
    let inFlight = 0
    let most = 0
    const ids = Array.from({ length: 15 }, (_, i) => ({ id: `t${i}` }))
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname.split('/users/me')[1]!
      if (path === '/threads') return Response.json({ threads: ids })
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return Response.json({ id: path.slice(9), messages: [msg('m', 1, 'a@x.com', ['INBOX'], 'text/plain')] })
    })
    const query = { labelIds: ['INBOX'], includeSpamTrash: false }
    await listThreadPage('me@gmail.com', query)
    expect(most).toBe(15)
    most = 0
    await listThreadPage('me@gmail.com', query, 'next')
    expect(most).toBe(4)
  })

  it('modifyThreads posts each thread', async () => {
    await modifyThreads('me@gmail.com', ['a', 'b'], ['INBOX'], [])
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2)
    for (const [, init] of posts) {
      expect(JSON.parse(init.body)).toEqual({ addLabelIds: ['INBOX'], removeLabelIds: [] })
    }
  })

  it('a draft in progress does not bump the row date', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({
        id: 't1',
        historyId: '1',
        messages: [
          msg('m1', 1000, 'Ann <a@x.com>', ['INBOX'], 'text/plain'),
          msg('m2', 5000, 'Me <me@gmail.com>', ['DRAFT'], 'text/plain'),
        ],
      }),
    )
    const { row, messageLabels } = await getThreadRowWithLabels('me@gmail.com', 't1')
    expect(row.date).toBe(new Date(1000).toISOString())
    expect(messageLabels).toEqual([['INBOX'], ['DRAFT']])
  })

  it('listHistory follows pages and asks for the four change types', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const params = new URL(url).searchParams
      return params.get('pageToken')
        ? Response.json({ history: [{ messagesDeleted: [] }], historyId: '9' })
        : Response.json({ history: [{ messagesAdded: [] }], historyId: '9', nextPageToken: 'p2' })
    })
    expect(await listHistory('me@gmail.com', '5')).toEqual({
      history: [{ messagesAdded: [] }, { messagesDeleted: [] }],
      historyId: '9',
    })
    const first = new URL(String(fetchMock.mock.calls[0]![0])).searchParams
    expect(first.get('startHistoryId')).toBe('5')
    expect(first.getAll('historyTypes')).toEqual(['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'])
  })

  it('listHistory maps a 404 to expired', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }))
    expect(await listHistory('me@gmail.com', '5')).toBe('expired')
  })
})

describe('decodeEntities', () => {
  it('leaves names inherited from Object.prototype alone', () => {
    expect(decodeEntities('&constructor; &toString; &__proto__;')).toBe('&constructor; &toString; &__proto__;')
  })

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('It&#39;s &amp; &#x41; &lt;b&gt; &quot;q&quot; &apos;x&apos;&nbsp;y &#8211;')).toBe(
      'It\'s & A <b> "q" \'x\'\u00a0y \u2013',
    )
  })
  it('leaves unknown or malformed entities and does not double-decode', () => {
    expect(decodeEntities('&bogus; &#xZZ; &amp;lt;')).toBe('&bogus; &#xZZ; &lt;')
  })
})
