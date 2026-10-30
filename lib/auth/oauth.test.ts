import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from '@webext-core/fake-browser'
import {
  buildAuthUrl,
  createPkcePair,
  getAccessToken,
  getAccounts,
  getClient,
  OAuthError,
  setCustomClient,
  signIn,
} from './oauth'

vi.stubGlobal('browser', fakeBrowser)

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const ACCOUNT = { email: 'me@gmail.com', refreshToken: 'r1', accessToken: 'a1', expiresAt: 0 }

describe('PKCE', () => {
  it('derives the S256 challenge from the verifier', async () => {
    const { verifier, challenge } = await createPkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(challenge).toBe(expected)
  })

  it('asks for offline access with the gmail scope', () => {
    const url = new URL(buildAuthUrl({ clientId: 'cid' }, 'https://x.extensions.allizom.org/', 'ch', 'st', 'me@gmail.com'))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid',
      redirect_uri: 'https://x.extensions.allizom.org/',
      response_type: 'code',
      scope: GMAIL_SCOPE,
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      access_type: 'offline',
      state: 'st',
      login_hint: 'me@gmail.com',
    })
  })
})

describe('tokens', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    fakeBrowser.reset()
    await setCustomClient({ clientId: 'cid', clientSecret: 'sec' })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('browser', fakeBrowser)
  })

  it('a custom client overrides the built-in one', async () => {
    await setCustomClient({ clientId: ' other ', clientSecret: '' })
    expect(await getClient()).toEqual({ clientId: 'other', clientSecret: undefined })
  })

  it("concurrent refreshes of two accounts keep both accounts' tokens", async () => {
    await fakeBrowser.storage.local.set({ oauthAccounts: [ACCOUNT, { ...ACCOUNT, email: 'b@gmail.com', refreshToken: 'r2' }] })
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const refresh = (init.body as URLSearchParams).get('refresh_token')
      return Response.json({ access_token: `new-${refresh}`, expires_in: 3600 })
    })
    await Promise.all([getAccessToken('me@gmail.com'), getAccessToken('b@gmail.com')])
    expect((await getAccounts()).map((it) => it.accessToken)).toEqual(['new-r1', 'new-r2'])
  })

  it('returns a fresh token without a request', async () => {
    await fakeBrowser.storage.local.set({ oauthAccounts: [{ ...ACCOUNT, expiresAt: Date.now() + 3600_000 }] })
    expect(await getAccessToken('me@gmail.com')).toBe('a1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes an expired token once for concurrent callers', async () => {
    await fakeBrowser.storage.local.set({ oauthAccounts: [ACCOUNT] })
    fetchMock.mockImplementation(async () => Response.json({ access_token: 'a2', expires_in: 3600 }))
    expect(await Promise.all([getAccessToken('me@gmail.com'), getAccessToken('me@gmail.com')])).toEqual(['a2', 'a2'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams
    expect(Object.fromEntries(body)).toEqual({
      client_id: 'cid',
      client_secret: 'sec',
      refresh_token: 'r1',
      grant_type: 'refresh_token',
    })
    expect((await getAccounts())[0]).toMatchObject({ accessToken: 'a2', refreshToken: 'r1' })
  })

  it('marks the account for re-auth on invalid_grant only', async () => {
    await fakeBrowser.storage.local.set({ oauthAccounts: [ACCOUNT] })
    fetchMock.mockImplementation(async () => Response.json({ error: 'server_error' }, { status: 503 }))
    await expect(getAccessToken('me@gmail.com')).rejects.toBeInstanceOf(OAuthError)
    expect((await getAccounts())[0]!.needsReauth).toBeUndefined()

    fetchMock.mockImplementation(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }))
    await expect(getAccessToken('me@gmail.com')).rejects.toThrow('invalid_grant')
    expect((await getAccounts())[0]!.needsReauth).toBe(true)
    await expect(getAccessToken('me@gmail.com')).rejects.toThrow('needs_reauth')
  })

  it('signs in through the web auth flow and stores the account', async () => {
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
    vi.spyOn(fakeBrowser.identity, 'launchWebAuthFlow').mockImplementation(async ({ url }) => {
      const state = new URL(url).searchParams.get('state')
      return `https://x.extensions.allizom.org/?state=${state}&code=c1`
    })
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/profile')
        ? Response.json({ emailAddress: 'me@gmail.com' })
        : Response.json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: GMAIL_SCOPE }),
    )
    await fakeBrowser.storage.local.set({ oauthAccounts: [{ ...ACCOUNT, needsReauth: true }] })
    const account = await signIn('me@gmail.com')
    expect(account).toMatchObject({ email: 'me@gmail.com', refreshToken: 'r1', accessToken: 'a1' })
    // Replaces the stale entry instead of adding a second one.
    expect(await getAccounts()).toEqual([account])
    const body = Object.fromEntries(fetchMock.mock.calls[0]![1].body as URLSearchParams)
    expect(body).toMatchObject({ code: 'c1', grant_type: 'authorization_code', redirect_uri: 'https://x.extensions.allizom.org/' })
    expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("explains a sign-in that can't read Gmail", async () => {
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
    vi.spyOn(fakeBrowser.identity, 'launchWebAuthFlow').mockImplementation(async ({ url }) => {
      const state = new URL(url).searchParams.get('state')
      return `https://x.extensions.allizom.org/?state=${state}&code=c1`
    })
    // Gmail unticked on the consent screen.
    fetchMock.mockImplementation(async () => Response.json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'openid' }))
    await expect(signIn()).rejects.toThrow('scope_not_granted')

    // Gmail API off in the client's Cloud project: Google's reason comes through.
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/profile')
        ? Response.json({ error: { code: 403, message: 'Gmail API has not been used in project 1 or it is disabled.' } }, { status: 403 })
        : Response.json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: GMAIL_SCOPE }),
    )
    await expect(signIn()).rejects.toThrow('profile_403: Gmail API has not been used in project 1 or it is disabled.')
    expect(await getAccounts()).toEqual([])
  })

  it('rejects a redirect with the wrong state', async () => {
    vi.spyOn(fakeBrowser.identity, 'getRedirectURL').mockReturnValue('https://x.extensions.allizom.org/')
    vi.spyOn(fakeBrowser.identity, 'launchWebAuthFlow').mockImplementation(async () => 'https://x.extensions.allizom.org/?state=no&code=c1')
    await expect(signIn()).rejects.toThrow('state_mismatch')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
