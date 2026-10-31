import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken } from '../auth/oauth'
import { setTokenSource, type GmailMessage } from './gmail'
import { decodeEntities, listThreadPage, modifyThreads } from './mailbox'

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

  it('modifyThreads posts each thread', async () => {
    await modifyThreads('me@gmail.com', ['a', 'b'], ['INBOX'], [])
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2)
    for (const [, init] of posts) {
      expect(JSON.parse(init.body)).toEqual({ addLabelIds: ['INBOX'], removeLabelIds: [] })
    }
  })
})

describe('decodeEntities', () => {
  it('decodes numeric and named entities', () => {
    expect(decodeEntities('It&#39;s &amp; &#x41; &lt;b&gt; &quot;q&quot; &apos;x&apos;&nbsp;y &#8211;')).toBe(
      'It\'s & A <b> "q" \'x\'\u00a0y \u2013',
    )
  })
  it('leaves unknown or malformed entities and does not double-decode', () => {
    expect(decodeEntities('&bogus; &#xZZ; &amp;lt;')).toBe('&bogus; &#xZZ; &lt;')
  })
})
