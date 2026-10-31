import { queryOptions, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { gmailFetch, header, mapLimit, parseAddressField, parseMailbox, type GmailPart } from '../api/gmail'
import { registrableDomain } from './identity'

const KEY = 'correspondents'
const BOOTSTRAPPED_KEY = 'correspondentsBootstrapped'
const CAP = 5000

type Store = Record<string, string[]>

async function readAll(): Promise<Store> {
  const { [KEY]: stored } = await browser.storage.local.get<Record<string, Store>>(KEY)
  return stored ?? {}
}

// Writes are read-modify-write, so they're chained to keep two concurrent ones
// from losing each other's changes. This serialises within one JS context only;
// the popup, popout and background are separate contexts.
let writeChain: Promise<unknown> = Promise.resolve()

function serialised<T>(run: () => Promise<T>): Promise<T> {
  const result = writeChain.then(run, run)
  writeChain = result.catch(() => {})
  return result
}

// What addCorrespondents stores: trimmed, lower-case, no empties.
export const normaliseEmails = (emails: string[]) =>
  emails.map((it) => it.trim().toLowerCase()).filter(Boolean)

export function addCorrespondents(account: string, emails: string[]): Promise<void> {
  return serialised(async () => {
    const all = await readAll()
    const added = normaliseEmails(emails)
    const addedSet = new Set(added)
    // Re-adding moves an address to the newest end, so the cap drops the stalest.
    const kept = (all[account] ?? []).filter((it) => !addedSet.has(it))
    const next = [...new Set([...kept, ...added])].slice(-CAP)
    await browser.storage.local.set({ [KEY]: { ...all, [account]: next } })
  })
}

export async function getCorrespondents(account: string): Promise<Set<string>> {
  return new Set((await readAll())[account] ?? [])
}

const readBootstrapped = async () =>
  (await browser.storage.local.get<Record<string, string[]>>(BOOTSTRAPPED_KEY))[BOOTSTRAPPED_KEY] ?? []

const inFlight = new Map<string, Promise<void>>()

// Seeds the store from the last 200 Sent messages, once per account.
export function bootstrapCorrespondents(account: string): Promise<void> {
  let running = inFlight.get(account)
  if (!running) {
    running = seed(account).finally(() => inFlight.delete(account))
    inFlight.set(account, running)
  }
  return running
}

async function seed(account: string): Promise<void> {
  if ((await readBootstrapped()).includes(account)) return
  const { messages = [] } = await gmailFetch<{ messages?: { id: string }[] }>(
    account,
    '/messages?labelIds=SENT&maxResults=200',
  )
  const recipients = await mapLimit(messages, 4, async ({ id }) => {
    const message = await gmailFetch<{ payload: GmailPart }>(
      account,
      `/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`,
    )
    return ['To', 'Cc'].flatMap((name) =>
      parseAddressField(header(message.payload, name) ?? '').map((it) => parseMailbox(it).email),
    )
  })
  await addCorrespondents(account, recipients.flat())
  await serialised(async () =>
    browser.storage.local.set({ [BOOTSTRAPPED_KEY]: [...new Set([...(await readBootstrapped()), account])] }),
  )
}

export const correspondentsOptions = (account: string) =>
  queryOptions({ queryKey: ['correspondents', account], queryFn: () => getCorrespondents(account) })

export function useCorrespondents(account: string) {
  return useQuery(correspondentsOptions(account))
}

// The domains the account has written to, for lookalike checks; undefined
// until they load. Memoised on the set, not rebuilt per message.
export function useKnownDomains(account: string): Set<string> | undefined {
  const { data } = useCorrespondents(account)
  return useMemo(() => data && new Set([...data].map((it) => registrableDomain(it))), [data])
}
