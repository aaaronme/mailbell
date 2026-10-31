import type { ThreadRow } from '../api/mailbox'

export interface AccountPages {
  account: string
  rows: ThreadRow[]
  exhausted: boolean
}

// One fetch of All inboxes: the rows of every account asked this round (kept
// flat under `rows` so optimistic patching can edit them like any list), and
// each of those accounts' next token (null = no more mail).
export interface AllInboxesPage {
  rows: ThreadRow[]
  tokens: Record<string, string | null>
}

const time = (row: ThreadRow) => Date.parse(row.date)

// A thread that gets new mail between two page fetches moves up and can come
// back in the next page too; the first, newer copy is the one shown.
export function uniqueRows(rows: ThreadRow[]): ThreadRow[] {
  const seen = new Set<string>()
  return rows.filter((it) => {
    const id = `${it.account}\n${it.threadId}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const newestFirst = (a: ThreadRow, b: ThreadRow) =>
  time(b) - time(a) || a.account.localeCompare(b.account) || a.threadId.localeCompare(b.threadId)

// Regroups fetched pages per account. An account no page has asked yet is
// neither loaded nor exhausted.
export function toAccountPages(pages: AllInboxesPage[], accounts: string[]): AccountPages[] {
  return accounts.map((account) => {
    const asked = pages.filter((it) => account in it.tokens)
    return {
      account,
      rows: uniqueRows(pages.flatMap((it) => it.rows.filter((r) => r.account === account))),
      exhausted: asked.length > 0 && asked.at(-1)!.tokens[account] === null,
    }
  })
}

// Every account is complete down to its oldest loaded row, so only rows at or
// after the latest of those are certain to be in order: an account that could
// still hold mail between its oldest row and the cutoff would otherwise be
// skipped past. An account with nothing loaded is complete down to nowhere.
export function mergeInboxes(pages: AccountPages[]): { rows: ThreadRow[]; limiting: string[] } {
  const open = pages.filter((it) => !it.exhausted)
  const oldest = new Map(
    open.map((it) => [it.account, it.rows.length ? Math.min(...it.rows.map(time)) : Infinity] as const),
  )
  const cutoff = open.length ? Math.max(...oldest.values()) : -Infinity
  return {
    rows: pages
      .flatMap((it) => it.rows)
      .filter((it) => time(it) >= cutoff)
      .sort(newestFirst),
    limiting: open
      .filter((it) => oldest.get(it.account) === cutoff)
      .map((it) => it.account)
      .sort(),
  }
}
