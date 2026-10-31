import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { fakeBrowser } from '@webext-core/fake-browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { threadToMail, type GmailMessage } from '@/lib/api/gmail'
import type { EmailThread } from '@/lib/StateManager'

vi.stubGlobal('browser', fakeBrowser)
vi.stubGlobal('chrome', fakeBrowser)

const { ThreadView } = await import('./ThreadView')
const { getTrustedSenders } = await import('@/lib/mail/remoteContent')
const { getCorrespondents } = await import('@/lib/mail/correspondents')

const ACCOUNT = 'me@gmail.com'
const b64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

function thread(opts: {
  from?: string
  to?: string
  html?: string
  labels?: string[]
  headers?: Record<string, string>
}): EmailThread {
  const msg: GmailMessage = {
    id: 'm1',
    threadId: 't1',
    labelIds: opts.labels ?? ['INBOX'],
    internalDate: String(Date.UTC(2026, 9, 30, 8, 0)),
    payload: {
      mimeType: 'text/html',
      headers: [
        { name: 'From', value: opts.from ?? 'Ann <ann@example.com>' },
        { name: 'To', value: opts.to ?? ACCOUNT },
        { name: 'Subject', value: 'Hello' },
        ...Object.entries(opts.headers ?? {}).map(([name, value]) => ({ name, value })),
      ],
      body: { size: 1, data: b64(opts.html ?? '<p>Hi</p>') },
    },
  }
  const mail = threadToMail({ id: 't1', historyId: '1', messages: [msg] })
  return {
    ...mail,
    account: ACCOUNT,
    title: 'Hello',
    summary: '',
    url: 'https://mail.google.com/mail/?authuser=me%40gmail.com#inbox/t1',
    modified: '2026-10-30T08:00:00.000Z',
    author: { name: 'Ann', email: 'ann@example.com' },
  }
}

const VERIFIED = (domain: string) => ({
  'Authentication-Results': `mx.google.com; dkim=pass header.d=${domain}; spf=pass smtp.mailfrom=${domain}; dmarc=pass header.from=${domain}`,
})

const wrap = (t: EmailThread, client: QueryClient, onEngage?: () => void) => (
  <QueryClientProvider client={client}>
    <ThreadView thread={t} onEngage={onEngage} />
  </QueryClientProvider>
)

function renderView(t: EmailThread, onEngage?: () => void) {
  return render(wrap(t, new QueryClient(), onEngage))
}

const shadowOf = (container: Element) => [...container.querySelectorAll('*')].find((it) => it.shadowRoot)?.shadowRoot

describe('ThreadView', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('verified sender shows check with domain wording', async () => {
    const view = await renderView(
      thread({ from: 'Gov <notices@springfield.gov>', headers: VERIFIED('springfield.gov') }),
    )
    await expect.element(view.getByTitle('Sent from springfield.gov (verified)')).toBeVisible()
  })

  it('emphasises the registrable domain', async () => {
    const view = await renderView(thread({ from: 'Gov <notices@mail.springfield.gov.x7.ru>' }))
    await expect.element(view.getByText('x7.ru', { exact: true })).toBeVisible()
    const strong = view.container.querySelectorAll('.font-medium')
    expect([...strong].some((it) => it.textContent === 'x7.ru')).toBe(true)
  })

  it('replies-go-to warning', async () => {
    const view = await renderView(thread({ headers: { 'Reply-To': 'x@gmail.com' } }))
    await expect.element(view.getByText('Replies go to x@gmail.com', { exact: false })).toBeVisible()
  })

  it('spam mail opens as safe text', async () => {
    const view = await renderView(thread({ labels: ['SPAM'], html: '<p><a href="https://evil.ru">Login</a></p>' }))
    await expect.element(view.getByText('This is in Spam')).toBeVisible()
    await expect.element(view.getByText('This is in Spam')).toBeVisible()
    await expect.element(view.getByTitle('https://evil.ru')).toHaveTextContent('evil.ru')
    expect(view.container.querySelector('a[href]')).toBeNull()
    await view.getByRole('button', { name: 'Show formatted' }).click()
    await vi.waitFor(() => expect(shadowOf(view.container)?.querySelector('a')?.textContent).toBe('Login'))
  })

  it('a safe-text link opens a menu to copy or open its full url', async () => {
    const href = 'https://evil.ru/c/long-tracking-path'
    const view = await renderView(thread({ labels: ['SPAM'], html: `<p><a href="${href}">Login</a></p>` }))
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const openTab = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never)
    await view.getByTitle(href).click()
    await view.getByRole('menuitem', { name: 'Copy link' }).click()
    expect(copy).toHaveBeenCalledWith(href)
    await view.getByTitle(href).click({ button: 'right' })
    await view.getByRole('menuitem', { name: 'Open link' }).click()
    expect(openTab).toHaveBeenCalledWith({ url: href })
  })

  it('remote images bar', async () => {
    const view = await renderView(thread({ html: '<p>Hi</p><img src="https://cdn.example.com/a.png" width="200">' }))
    await expect.element(view.getByText('Images are hidden to protect your privacy')).toBeVisible()
    expect(shadowOf(view.container)?.querySelector('img')?.getAttribute('src')).not.toBe('https://cdn.example.com/a.png')
    await view.getByRole('button', { name: 'Show images' }).click()
    await expect.element(view.getByText('Images are hidden to protect your privacy')).not.toBeInTheDocument()
    expect(shadowOf(view.container)?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/a.png')
  })

  it('shows the bar for a mail whose only remote content is in a style block', async () => {
    const t = thread({ html: '<p>Hi</p>' })
    t.styles = ['.x{background:url(https://cdn.example.com/a.png)}']
    const view = await renderView(t)
    await expect.element(view.getByText('Images are hidden to protect your privacy')).toBeVisible()
  })

  it('always show from this sender persists', async () => {
    const view = await renderView(thread({ html: '<img src="https://cdn.example.com/a.png" width="200">' }))
    await view.getByRole('button', { name: 'Always show from this sender' }).click()
    await vi.waitFor(async () => expect((await getTrustedSenders(ACCOUNT)).has('ann@example.com')).toBe(true))
    await expect.element(view.getByText('Images are hidden to protect your privacy')).not.toBeInTheDocument()
  })

  it('records recipients of mail sent by the account as correspondents', async () => {
    await renderView(thread({ from: `Me <${ACCOUNT}>`, to: 'Bob <bob@example.com>' }))
    await vi.waitFor(async () => expect((await getCorrespondents(ACCOUNT)).has('bob@example.com')).toBe(true))
  })

  it('flags a first-time sender', async () => {
    const view = await renderView(thread({}))
    await expect.element(view.getByText("You haven't written to this address before")).toBeVisible()
  })

  it('resets per-mail state when the same view is given another thread', async () => {
    const client = new QueryClient()
    const html = '<img src="https://cdn.example.com/a.png" width="200">'
    const a = thread({ html })
    const view = await render(wrap(a, client))
    await view.getByRole('button', { name: 'Show images' }).click()
    await expect.element(view.getByText('Images are hidden to protect your privacy')).not.toBeInTheDocument()
    await view.rerender(wrap({ ...thread({ html }), url: 'https://mail.google.com/mail/?authuser=me%40gmail.com#inbox/t2' }, client))
    await expect.element(view.getByText('Images are hidden to protect your privacy')).toBeVisible()
  })

  it('resets Show formatted when the same view is given another thread', async () => {
    const client = new QueryClient()
    const make = () => thread({ labels: ['SPAM'], html: '<p>Hi</p>' })
    const view = await render(wrap(make(), client))
    await view.getByRole('button', { name: 'Show formatted' }).click()
    await expect.element(view.getByRole('button', { name: 'Show formatted' })).not.toBeInTheDocument()
    await view.rerender(wrap({ ...make(), url: 'https://mail.google.com/mail/?authuser=me%40gmail.com#inbox/t2' }, client))
    await expect.element(view.getByRole('button', { name: 'Show formatted' })).toBeVisible()
  })

  it('does not write correspondents again for an equal messages array', async () => {
    const client = new QueryClient()
    const make = () => thread({ from: `Me <${ACCOUNT}>`, to: 'Bob <bob@example.com>' })
    const view = await render(wrap(make(), client))
    await vi.waitFor(async () => expect((await getCorrespondents(ACCOUNT)).has('bob@example.com')).toBe(true))
    await vi.waitFor(() => expect(client.getQueryData(['correspondents', ACCOUNT])).toBeDefined())
    const set = vi.spyOn(fakeBrowser.storage.local, 'set')
    set.mockClear()
    await view.rerender(wrap(make(), client))
    await new Promise((r) => setTimeout(r, 100))
    expect(set).not.toHaveBeenCalled()
  })

  it('calls onEngage for pointer, wheel, scroll and focus inside the view', async () => {
    const onEngage = vi.fn()
    const view = await renderView(thread({ html: '<p>Hi</p>' }), onEngage)
    const root = view.container.firstElementChild!
    const inner = root.querySelector('button')!
    inner.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(onEngage).toHaveBeenCalledTimes(1)
    inner.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))
    expect(onEngage).toHaveBeenCalledTimes(2)
    inner.dispatchEvent(new Event('scroll'))
    expect(onEngage).toHaveBeenCalledTimes(3)
    inner.focus()
    expect(onEngage.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  it('merges the reply-to and first-time warnings into one line', async () => {
    const view = await renderView(thread({ headers: { 'Reply-To': 'x@gmail.com' } }))
    await expect
      .element(view.getByText("Replies go to x@gmail.com, and you haven't written to this address before"))
      .toBeVisible()
  })

  it('lists mailed-by, signed-by and security under Details', async () => {
    const view = await renderView(
      thread({
        from: 'Gov <notices@springfield.gov>',
        headers: {
          ...VERIFIED('springfield.gov'),
          'Return-Path': '<bounce@mailer.example.org>',
          Received: 'from a by mx.google.com with ESMTPS id 1; Fri, 30 Oct 2026 08:00:00 +0000',
        },
      }),
    )
    const details = view.getByRole('button', { name: 'Details' })
    await expect.element(details).toHaveAttribute('aria-expanded', 'false')
    await details.click()
    await expect.element(details).toHaveAttribute('aria-expanded', 'true')
    await expect.element(view.getByText('Mailed by')).toBeVisible()
    await expect.element(view.getByText('example.org')).toBeVisible()
    await expect.element(view.getByText('Signed by')).toBeVisible()
    await expect.element(view.getByText('Security')).toBeVisible()
    await expect.element(view.getByText('TLS', { exact: true })).toBeVisible()
  })

  it('shows images for a trusted sender without the bar', async () => {
    await fakeBrowser.storage.local.set({ trustedSenders: { [ACCOUNT]: ['ann@example.com'] } })
    const view = await renderView(thread({ html: '<img src="https://cdn.example.com/a.png" width="200">' }))
    await vi.waitFor(() =>
      expect(shadowOf(view.container)?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.com/a.png'),
    )
    await expect.element(view.getByText('Images are hidden to protect your privacy')).not.toBeInTheDocument()
  })

  it('never shows the suspicious view for mail the account sent', async () => {
    const view = await renderView(thread({ from: `Me <${ACCOUNT}>`, labels: ['SPAM', 'SENT'], html: '<p>Hi</p>' }))
    await expect.element(view.getByText('Hi')).toBeVisible()
    await expect.element(view.getByRole('button', { name: 'Show formatted' })).not.toBeInTheDocument()
  })

  it('ignores empty recipients when recording correspondents', async () => {
    await fakeBrowser.storage.local.set({ correspondents: { [ACCOUNT]: ['bob@example.com'] } })
    const client = new QueryClient()
    const t = thread({ from: `Me <${ACCOUNT}>`, to: 'bob@example.com' })
    t.messages[0]!.to = ['bob@example.com', '  ']
    await render(wrap(t, client))
    await vi.waitFor(() => expect(client.getQueryData(['correspondents', ACCOUNT])).toBeDefined())
    const set = vi.spyOn(fakeBrowser.storage.local, 'set')
    set.mockClear()
    await new Promise((r) => setTimeout(r, 100))
    expect(set.mock.calls.filter(([items]) => 'correspondents' in items)).toEqual([])
  })
})
