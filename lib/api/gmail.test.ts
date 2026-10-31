import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import {
  CURRENT_EXTRACT_VERSION,
  composeUrl,
  decodeBase64Url,
  getAllRSS,
  getRawMessage,
  gmailFetch,
  setTokenSource,
  sendReply,
  getThreadMail,
  markAsSpam,
  messageToMail,
  parseAddressField,
  parseMailbox,
  parseThreadUrl,
  threadToFeed,
  threadToMail,
  threadUrl,
  type GmailMessage,
  type GmailPart,
  type GmailThread,
} from './gmail'
import { getAccessToken, OAuthError } from '../auth/oauth'
import { fetchTokenFromBackground, bgMessager, tagOAuthError } from '../messager'

vi.stubGlobal('browser', fakeBrowser)

const b64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

function part(mimeType: string, text: string, headers: Record<string, string> = {}): GmailPart {
  return {
    mimeType,
    headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
    body: { size: text.length, data: b64(text) },
  }
}

function message(id: string, opts: { from?: string; subject?: string; date?: number; parts: GmailPart[]; labels?: string[] }): GmailMessage {
  return {
    id,
    threadId: 't1',
    labelIds: opts.labels ?? ['INBOX', 'UNREAD'],
    snippet: 'Hi &amp; welcome',
    internalDate: String(opts.date ?? Date.UTC(2026, 9, 30, 8, 0)),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: opts.from ?? '"Ann Example" <ann@example.com>' },
        { name: 'To', value: 'me@gmail.com, "Bob" <bob@example.com>' },
        { name: 'Subject', value: opts.subject ?? 'Hello' },
      ],
      parts: opts.parts,
    },
  }
}

const HTML = '<html><head><style>.x{color:red}</style></head><body><p class="x">Hi <b>there</b></p><script>alert(1)</script></body></html>'

describe('thread urls', () => {
  it('round-trips account and thread id', () => {
    const url = threadUrl('me+tag@gmail.com', '18c0ffee')
    expect(url).toBe('https://mail.google.com/mail/?authuser=me%2Btag%40gmail.com#inbox/18c0ffee')
    expect(parseThreadUrl(url)).toEqual({ account: 'me+tag@gmail.com', threadId: '18c0ffee' })
  })
  it('rejects anything else', () => {
    expect(parseThreadUrl('https://mail.google.com/mail/u/0/#inbox')).toBeNull()
    expect(parseThreadUrl('not a url')).toBeNull()
  })
  it('composes from the given account', () => {
    expect(composeUrl('me@gmail.com', { to: 'a@b.c' })).toBe(
      'https://mail.google.com/mail/?authuser=me%40gmail.com&view=cm&fs=1&to=a%40b.c',
    )
  })
})

describe('MIME decoding', () => {
  it('decodes base64url as UTF-8 by default', () => {
    expect(decodeBase64Url(b64('Grüße ✓'))).toBe('Grüße ✓')
  })
  it('honours a declared charset', () => {
    // "é" in ISO-8859-1
    expect(decodeBase64Url(btoa('\xe9'), 'iso-8859-1')).toBe('é')
  })
  it('parses mailboxes', () => {
    expect(parseMailbox('"Ann Example" <ann@example.com>')).toEqual({ name: 'Ann Example', email: 'ann@example.com' })
    expect(parseMailbox('ann@example.com')).toEqual({ name: 'ann@example.com', email: 'ann@example.com' })
  })
  it('parses address lists', () => {
    expect(parseAddressField('"A" <a@x.com>, "B" <b@y.com>')).toEqual(['A <a@x.com>', 'B <b@y.com>'])
    expect(parseAddressField('a@x.com, "Doe, Jane" <j@x.com>, "j@x.com" <j@x.com>')).toEqual([
      'a@x.com',
      'Doe, Jane <j@x.com>',
      'j@x.com',
    ])
    expect(parseAddressField('')).toEqual([])
  })
})

describe('messageToMail', () => {
  it("reads an invite's event from its text/calendar part", () => {
    const ics = 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nSUMMARY:Sync\r\nDTSTART:20261103T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR'
    const { message: mail } = messageToMail(message('m1', { parts: [part('text/plain', 'Invite'), part('text/calendar', ics)] }))
    expect(mail.event).toMatchObject({ title: 'Sync', start: '20261103T090000', utc: true })
    expect(mail.contentText).toBe('Invite')
  })

  it('prefers the HTML part, lifting out styles and scripts', () => {
    const { message: mail, styles } = messageToMail(
      message('m1', { parts: [part('text/plain', 'Hi there'), part('text/html', HTML)] }),
    )
    expect(styles).toEqual(['.x{color:red}'])
    expect(mail.contentHtml).toBe('<p class="x">Hi <b>there</b></p>')
    expect(mail.contentText).toBe('Hi there')
    expect(mail.senderName).toBe('Ann Example')
    expect(mail.senderEmail).toBe('ann@example.com')
    expect(mail.to).toEqual(['me@gmail.com', 'Bob <bob@example.com>'])
    expect(mail.time).toBe('2026-10-30T08:00:00.000Z')
  })

  it('escapes a plain-text-only message into a <pre>', () => {
    const { message: mail } = messageToMail(message('m1', { parts: [part('text/plain', 'a <b> & c')] }))
    expect(mail.contentHtml).toContain('a &lt;b&gt; &amp; c')
    expect(mail.contentHtml).toMatch(/^<pre/)
  })

  it('lists attachments but not inline images', () => {
    const msg = message('m1', {
      parts: [
        part('text/html', '<body><img src="cid:logo@x"></body>'),
        { mimeType: 'application/pdf', filename: 'a.pdf', body: { size: 10, attachmentId: 'att1' } },
        {
          mimeType: 'image/png',
          filename: 'logo.png',
          headers: [{ name: 'Content-ID', value: '<logo@x>' }],
          body: { size: 4, attachmentId: 'att2' },
        },
      ],
    })
    const { message: mail } = messageToMail(msg, new Map([['logo@x', 'data:image/png;base64,AAAA']]))
    expect(mail.attachments).toEqual([
      { fileName: 'a.pdf', mimeType: 'application/pdf', size: 10, messageId: 'm1', attachmentId: 'att1' },
    ])
    expect(mail.contentHtml).toContain('src="data:image/png;base64,AAAA"')
  })
})

describe('threadToFeed / threadToMail', () => {
  const thread: GmailThread = {
    id: 't1',
    historyId: '100',
    messages: [
      message('m1', { subject: 'Plans', date: Date.UTC(2026, 9, 29), parts: [part('text/plain', 'one')] }),
      message('m2', {
        from: 'Bob <bob@example.com>',
        subject: 'Re: Plans',
        date: Date.UTC(2026, 9, 30),
        parts: [part('text/plain', 'two')],
        labels: ['INBOX', 'IMPORTANT'],
      }),
      message('d1', { date: Date.UTC(2026, 9, 31), parts: [part('text/plain', 'draft')], labels: ['DRAFT'] }),
    ],
  }

  it('takes the subject from the first message and the rest from the last, skipping drafts', () => {
    expect(threadToFeed('me@gmail.com', thread)).toEqual({
      title: 'Plans',
      summary: 'Hi & welcome',
      url: threadUrl('me@gmail.com', 't1'),
      modified: '2026-10-30T00:00:00.000Z',
      author: { name: 'Bob', email: 'bob@example.com' },
      labels: ['INBOX', 'IMPORTANT'],
    })
    const mail = threadToMail(thread)
    expect(mail.messageCount).toBe(2)
    expect(mail.extractVersion).toBe(CURRENT_EXTRACT_VERSION)
    expect(mail.extractVersion).toBe(4)
    expect(mail.messages[1]!.identity.status).toBe('unverified')
    expect(mail.messages[1]!.labelIds).toEqual(['INBOX', 'IMPORTANT'])
  })
})

describe('Gmail API calls', () => {
  const ACCOUNT = 'me@gmail.com'
  const thread: GmailThread = {
    id: 't1',
    historyId: '100',
    messages: [message('m1', { parts: [part('text/plain', 'one')] })],
  }
  let fetchMock: ReturnType<typeof vi.fn>
  let mailboxHistory: string

  function routes(url: string, init?: RequestInit): unknown {
    const path = url.replace('https://gmail.googleapis.com/gmail/v1/users/me', '')
    if (path === '/profile') return { emailAddress: ACCOUNT, historyId: mailboxHistory }
    if (path.startsWith('/threads?')) return { threads: [{ id: 't1', historyId: '100' }] }
    if (path.startsWith('/threads/t1?format=full')) return thread
    if (path.startsWith('/threads/t1?format=metadata'))
      return {
        ...thread,
        messages: [
          {
            ...thread.messages[0],
            payload: {
              mimeType: 'text/html',
              headers: [
                { name: 'List-Unsubscribe', value: '<https://u.example/x>' },
                { name: 'Subject', value: 'Plans' },
                { name: 'Message-ID', value: '<m1@example.com>' },
              ].filter((h) => url.includes(`metadataHeaders=${h.name}`)),
            },
          },
        ],
      }
    if (path === '/threads/t1/modify' || path === '/messages/send') return { body: JSON.parse(String(init?.body)) }
    throw new Error('unexpected ' + path)
  }

  beforeEach(async () => {
    fakeBrowser.reset()
    mailboxHistory = '500'
    await fakeBrowser.storage.local.set({
      oauthClient: { clientId: 'cid' },
      oauthAccounts: [{ email: ACCOUNT, refreshToken: 'r', accessToken: 'a', expiresAt: Date.now() + 3600_000 }],
    })
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => Response.json(routes(url, init)))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('browser', fakeBrowser)
  })

  const calledPaths = () => fetchMock.mock.calls.map(([url]) => new URL(url).pathname.split('/users/me')[1])

  it('fetches the inbox once, then answers from the cache while historyId is unchanged', async () => {
    const [inbox] = await getAllRSS()
    expect(inbox!.email).toBe(ACCOUNT)
    expect(inbox!.feeds.map((it) => it.url)).toEqual([threadUrl(ACCOUNT, 't1')])
    expect(calledPaths()).toEqual(['/profile', '/threads', '/threads/t1'])
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer a')
    // The mail built while listing is handed over without another request,
    // and only the list is persisted - the mail is stored with the threads.
    fetchMock.mockClear()
    expect((await getThreadMail(threadUrl(ACCOUNT, 't1'))).messages[0]!.contentText).toBe('one')
    expect(fetchMock).not.toHaveBeenCalled()
    const { [`inbox:${ACCOUNT}`]: stored } = await fakeBrowser.storage.local.get(`inbox:${ACCOUNT}`)
    expect(JSON.stringify(stored)).not.toContain('contentHtml')

    await getAllRSS()
    expect(calledPaths()).toEqual(['/profile'])

    // Mailbox changed, but this thread didn't: listed again, not re-fetched.
    fetchMock.mockClear()
    mailboxHistory = '501'
    await getAllRSS()
    expect(calledPaths()).toEqual(['/profile', '/threads'])
  })

  it('marks one failing account failed instead of failing the poll', async () => {
    await fakeBrowser.storage.local.set({
      oauthAccounts: [
        { email: ACCOUNT, refreshToken: 'r', accessToken: 'a', expiresAt: Date.now() + 3600_000 },
        { email: 'down@gmail.com', refreshToken: 'r', accessToken: 'down', expiresAt: Date.now() + 3600_000 },
      ],
    })
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      (init?.headers as Record<string, string>).Authorization === 'Bearer down'
        ? new Response('backend error', { status: 503 })
        : Response.json(routes(url, init)),
    )
    const [ok, down] = await getAllRSS()
    expect(ok).toMatchObject({ email: ACCOUNT, feeds: [{ url: threadUrl(ACCOUNT, 't1') }] })
    expect(down).toEqual({ email: 'down@gmail.com', feeds: [], failed: true })

    fetchMock.mockImplementation(async () => new Response('backend error', { status: 503 }))
    await expect(getAllRSS()).rejects.toThrow('503')
  })

  it('skips accounts that need a fresh sign-in', async () => {
    await fakeBrowser.storage.local.set({
      oauthAccounts: [{ email: ACCOUNT, refreshToken: 'r', accessToken: 'a', expiresAt: 0, needsReauth: true }],
    })
    await expect(getAllRSS()).rejects.toThrow('no signed-in account')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries once with a refreshed token on 401', async () => {
    let first = true
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'b', expires_in: 3600 })
      if (first) {
        first = false
        return new Response('', { status: 401 })
      }
      return Response.json(routes(url, init))
    })
    await markAsSpam(threadUrl(ACCOUNT, 't1'))
    const modify = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/modify'))
    expect(modify.map(([, init]) => init.headers.Authorization)).toEqual(['Bearer a', 'Bearer b'])
    expect(JSON.parse(modify[1]![1].body)).toEqual({ addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] })
  })

  it('builds a header block planUnsubscribe can read', async () => {
    expect(await getRawMessage(threadUrl(ACCOUNT, 't1'))).toBe('List-Unsubscribe: <https://u.example/x>\r\n\r\n')
  })

  it('sends a reply into the thread, threaded on the newest message', async () => {
    await sendReply(threadUrl(ACCOUNT, 't1'), { to: ['bob@example.com'], cc: [] }, 'Sounds good')
    const [, init] = fetchMock.mock.calls.at(-1)!
    const { raw, threadId } = JSON.parse(String(init.body))
    expect(threadId).toBe('t1')
    const mime = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    expect(mime).toContain('To: bob@example.com\r\n')
    expect(mime).toContain('Subject: Re: Plans\r\n')
    expect(mime).toContain('In-Reply-To: <m1@example.com>\r\nReferences: <m1@example.com>\r\n')
  })
})

describe('token source', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    setTokenSource(getAccessToken)
  })

  it('uses the injected token source', async () => {
    setTokenSource(async () => 'T1')
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await gmailFetch('a@x', '/labels')
    expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer T1')
  })

  it('on 401 asks the source again, forcing only if unchanged', async () => {
    const tokens = ['T1', 'T1', 'T2']
    const source = vi.fn(async (_a: string, _f?: boolean) => tokens.shift()!)
    setTokenSource(source)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await gmailFetch('a@x', '/labels')
    expect(source.mock.calls).toEqual([['a@x'], ['a@x'], ['a@x', true]])
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe('Bearer T2')
  })

  describe('OAuthError round trip through the background message', () => {
    const roundTrip = async (thrown: unknown) => {
      const send = vi.spyOn(bgMessager, 'sendMessage').mockRejectedValue(
        // messaging rethrows only the message
        new Error((tagOAuthError(thrown) as Error).message),
      )
      try {
        return (await fetchTokenFromBackground('a@x').catch((e: unknown) => e)) as OAuthError
      } finally {
        send.mockRestore()
      }
    }

    it.each([
      ['code and description', new OAuthError('invalid_grant', 'revoked')],
      ['code only', new OAuthError('no_client')],
      ['description containing pipes and colons', new OAuthError('profile_403', 'a|b: c|')],
    ])('rebuilds %s', async (_name, original) => {
      const err = await roundTrip(original)
      expect(err).toBeInstanceOf(OAuthError)
      expect(err.code).toBe(original.code)
      expect(err.description).toBe(original.description)
      expect(err.message).toBe(original.message)
    })

    it('passes other errors through untouched', async () => {
      const other = new Error('boom')
      expect(tagOAuthError(other)).toBe(other)
      const err = await roundTrip(other)
      expect(err).not.toBeInstanceOf(OAuthError)
      expect(err.message).toBe('boom')
    })

    it('surfaces from gmailFetch without calling fetch', async () => {
      const send = vi.spyOn(bgMessager, 'sendMessage').mockRejectedValue(
        new Error((tagOAuthError(new OAuthError('invalid_grant', 'revoked')) as Error).message),
      )
      setTokenSource(fetchTokenFromBackground)
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      const err = (await gmailFetch('a@x', '/labels').catch((e: unknown) => e)) as OAuthError
      expect(err).toBeInstanceOf(OAuthError)
      expect(err.code).toBe('invalid_grant')
      expect(fetchMock).not.toHaveBeenCalled()
      send.mockRestore()
    })
  })
})
