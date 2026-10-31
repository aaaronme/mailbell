import { useQuery } from '@tanstack/react-query'
import { gmailFetch, header, mapLimit, parseAddressField, parseMailbox, type GmailPart } from '../api/gmail'

const KEY = 'correspondents'
const BOOTSTRAPPED_KEY = 'correspondentsBootstrapped'
const CAP = 5000

type Store = Record<string, string[]>

async function readAll(): Promise<Store> {
  const { [KEY]: stored } = await browser.storage.local.get<Record<string, Store>>(KEY)
  return stored ?? {}
}

// Writes are read-modify-write on one key, so they're chained to keep two
// concurrent adds from losing each other's addresses.
let writeChain: Promise<unknown> = Promise.resolve()

export function addCorrespondents(account: string, emails: string[]): Promise<void> {
  const run = async () => {
    const all = await readAll()
    const added = emails.map((it) => it.trim().toLowerCase()).filter(Boolean)
    // Re-adding moves an address to the newest end, so the cap drops the stalest.
    const kept = (all[account] ?? []).filter((it) => !added.includes(it))
    const next = [...new Set([...kept, ...added])].slice(-CAP)
    await browser.storage.local.set({ [KEY]: { ...all, [account]: next } })
  }
  const result = writeChain.then(run, run)
  writeChain = result.catch(() => {})
  return result
}

export async function getCorrespondents(account: string): Promise<Set<string>> {
  return new Set((await readAll())[account] ?? [])
}

// Seeds the store from the last 200 Sent messages, once per account.
export async function bootstrapCorrespondents(account: string): Promise<void> {
  const read = async () =>
    (await browser.storage.local.get<Record<string, string[]>>(BOOTSTRAPPED_KEY))[BOOTSTRAPPED_KEY] ?? []
  if ((await read()).includes(account)) return
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
  await browser.storage.local.set({ [BOOTSTRAPPED_KEY]: [...new Set([...(await read()), account])] })
}

export function useCorrespondents(account: string) {
  return useQuery({ queryKey: ['correspondents', account], queryFn: () => getCorrespondents(account) })
}
