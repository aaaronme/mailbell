import { debugLog } from '../debugLog'

// Google OAuth 2.0 for a browser extension: authorization code flow with PKCE,
// run through browser.identity.launchWebAuthFlow, which hands the redirect back
// to us at browser.identity.getRedirectURL() (Firefox:
// https://<id>.extensions.allizom.org/, Chrome: https://<id>.chromiumapp.org/).
// That URL has to be registered as an authorized redirect URI on a Google
// "Web application" OAuth client. Web clients still demand their client
// secret at the token endpoint even with PKCE; an extension cannot keep a
// secret, and Google treats it as non-confidential for installed apps.

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
// Refresh this long before the access token actually expires, so a request
// never goes out with a token that dies in flight.
const EXPIRY_MARGIN_MS = 60_000

export interface OAuthClient {
  clientId: string
  clientSecret?: string
}

export interface Account {
  email: string
  refreshToken: string
  accessToken: string
  // epoch ms
  expiresAt: number
  // Google refused the refresh token (revoked, expired, client changed): the
  // user has to sign in again before this account can be polled.
  needsReauth?: boolean
}

const CLIENT_KEY = 'oauthClient'
const ACCOUNTS_KEY = 'oauthAccounts'

// Built into the release by the publisher (.env, see .env.example). Users can
// override it with their own client in Settings.
export function getBuiltInClient(): OAuthClient | null {
  const clientId = import.meta.env.WXT_GOOGLE_CLIENT_ID
  if (!clientId) return null
  return { clientId, clientSecret: import.meta.env.WXT_GOOGLE_CLIENT_SECRET || undefined }
}

export async function getCustomClient(): Promise<OAuthClient | null> {
  const { [CLIENT_KEY]: client } = await browser.storage.local.get<{ [CLIENT_KEY]?: OAuthClient }>(CLIENT_KEY)
  return client?.clientId ? client : null
}

export async function getClient(): Promise<OAuthClient | null> {
  return (await getCustomClient()) ?? getBuiltInClient()
}

// Refresh tokens belong to the client that issued them: the caller signs every
// account out after switching (background's setOAuthClient).
export async function setCustomClient(client: OAuthClient | null): Promise<void> {
  if (client?.clientId.trim()) {
    await browser.storage.local.set({
      [CLIENT_KEY]: { clientId: client.clientId.trim(), clientSecret: client.clientSecret?.trim() || undefined },
    })
  } else {
    await browser.storage.local.remove(CLIENT_KEY)
  }
}

export async function getAccounts(): Promise<Account[]> {
  const { [ACCOUNTS_KEY]: accounts } = await browser.storage.local.get<{ [ACCOUNTS_KEY]?: Account[] }>(ACCOUNTS_KEY)
  return accounts ?? []
}

// Every change to the account list is a read-modify-write of one key, and two
// accounts refresh concurrently during a poll: queue them, or the second
// write drops the first one's new token.
let accountWrites: Promise<unknown> = Promise.resolve()
function updateAccounts(fn: (accounts: Account[]) => Account[]): Promise<Account[]> {
  const next = accountWrites.then(async () => {
    const accounts = fn(await getAccounts())
    await browser.storage.local.set({ [ACCOUNTS_KEY]: accounts })
    return accounts
  })
  accountWrites = next.catch(() => {})
  return next
}

function updateAccount(email: string, patch: Partial<Account>) {
  return updateAccounts((accounts) => accounts.map((it) => (it.email === email ? { ...it, ...patch } : it)))
}

export async function removeAccount(email: string): Promise<void> {
  let account: Account | undefined
  await updateAccounts((accounts) => {
    account = accounts.find((it) => it.email === email)
    return accounts.filter((it) => it.email !== email)
  })
  if (account) {
    // Best effort: the local sign-out already happened either way.
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(account.refreshToken)}`, { method: 'POST' }).catch(
      (err) => debugLog('removeAccount: revoke failed ->', err),
    )
  }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function buildAuthUrl(
  client: OAuthClient,
  redirectUri: string,
  challenge: string,
  state: string,
  loginHint?: string,
): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // offline + consent: Google only issues a refresh token on consent.
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
  })
  if (loginHint) params.set('login_hint', loginHint)
  return `${AUTH_ENDPOINT}?${params}`
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  // Space-separated: what the user actually granted, which with granular
  // consent can be less than what was asked for.
  scope?: string
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    readonly description?: string,
  ) {
    super(description ? `${code}: ${description}` : code)
  }
}

async function postToken(client: OAuthClient, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: client.clientId, ...params })
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  const resp = await fetch(TOKEN_ENDPOINT, { method: 'POST', body })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new OAuthError(json.error ?? `http_${resp.status}`, json.error_description)
  }
  return json as TokenResponse
}

// Needs the gmail scope only: the profile endpoint names the mailbox.
async function fetchEmail(accessToken: string): Promise<string> {
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!resp.ok) {
    // Google says why in the body, e.g. that the Gmail API is disabled in the
    // client's Cloud project, with a link to enable it.
    const json = await resp.json().catch(() => ({}))
    throw new OAuthError(`profile_${resp.status}`, json.error?.message)
  }
  return ((await resp.json()) as { emailAddress: string }).emailAddress
}

// Interactive: opens Google's sign-in window. Must run in the background - the
// toolbar popup closes as soon as that window takes focus.
export async function signIn(loginHint?: string): Promise<Account> {
  const client = await getClient()
  if (!client) throw new OAuthError('no_client', 'No OAuth client configured')
  const redirectUri = browser.identity.getRedirectURL()
  const { verifier, challenge } = await createPkcePair()
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const result = await browser.identity.launchWebAuthFlow({
    url: buildAuthUrl(client, redirectUri, challenge, state, loginHint),
    interactive: true,
  })
  if (!result) throw new OAuthError('cancelled')
  const params = new URL(result).searchParams
  if (params.get('state') !== state) throw new OAuthError('state_mismatch')
  const code = params.get('code')
  if (!code) throw new OAuthError(params.get('error') ?? 'no_code')
  const token = await postToken(client, {
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  if (!token.refresh_token) throw new OAuthError('no_refresh_token')
  if (!token.scope?.split(' ').includes(GMAIL_SCOPE)) {
    throw new OAuthError('scope_not_granted', 'Gmail access was not granted. Sign in again and tick the Gmail checkbox.')
  }
  const account: Account = {
    email: await fetchEmail(token.access_token),
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  }
  await updateAccounts((accounts) => [...accounts.filter((it) => it.email !== account.email), account])
  return account
}

// One refresh per account at a time: a poll fans out a request per thread, and
// each would otherwise spend the refresh token on its own.
const refreshing = new Map<string, Promise<string>>()

export async function getAccessToken(email: string, forceRefresh = false): Promise<string> {
  const account = (await getAccounts()).find((it) => it.email === email)
  if (!account) throw new OAuthError('no_account', email)
  if (account.needsReauth) throw new OAuthError('needs_reauth', email)
  if (!forceRefresh && account.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return account.accessToken
  }
  let pending = refreshing.get(email)
  if (!pending) {
    pending = refresh(account).finally(() => refreshing.delete(email))
    refreshing.set(email, pending)
  }
  return pending
}

async function refresh(account: Account): Promise<string> {
  const client = await getClient()
  if (!client) throw new OAuthError('no_client')
  try {
    const token = await postToken(client, { refresh_token: account.refreshToken, grant_type: 'refresh_token' })
    await updateAccount(account.email, {
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      // Google may rotate it.
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    })
    return token.access_token
  } catch (err) {
    // invalid_grant is final (revoked, expired, wrong client); anything else
    // (network, 5xx) is worth retrying on the next poll.
    if (err instanceof OAuthError && err.code === 'invalid_grant') {
      await debugLog('oauth: refresh token rejected, needs sign-in ->', account.email)
      await updateAccount(account.email, { needsReauth: true })
    }
    throw err
  }
}
