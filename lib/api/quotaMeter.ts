import { debugLog } from '../debugLog'

const WINDOW_MS = 60_000
// A project created since May 2026 gets 6,000 units per user per minute, so
// half of that is worth a line even before Gmail refuses anything.
const HIGH_USE_UNITS = 3_000
// How long background work leaves an account alone after each refusal in a row.
// The quota refills over a minute, so the last step outlasts that.
const PAUSES_MS = [30_000, 60_000, 120_000]

// What each call costs. First match wins, so a path's longer forms go first.
// https://developers.google.com/workspace/gmail/api/reference/quota
const COSTS: [RegExp, string, number][] = [
  [/^GET \/profile/, 'getProfile', 1],
  [/^GET \/history/, 'history.list', 2],
  [/^GET \/labels\/[^?]/, 'labels.get', 1],
  [/^GET \/labels/, 'labels.list', 1],
  [/^GET \/threads\/[^?]+\?(.*&)?format=full/, 'threads.get(full)', 120],
  [/^GET \/threads\/[^?]/, 'threads.get', 40],
  [/^GET \/threads/, 'threads.list', 10],
  [/^POST \/threads\/[^/]+\/modify/, 'threads.modify', 10],
  [/^POST \/threads\/[^/]+\/trash/, 'threads.trash', 20],
  [/^POST \/threads\/[^/]+\/untrash/, 'threads.untrash', 10],
  [/^GET \/messages\/[^/]+\/attachments\//, 'attachments.get', 20],
  [/^GET \/messages\/[^?]+\?(.*&)?format=(full|raw|html)/, 'messages.get(full)', 60],
  [/^GET \/messages\/[^?]/, 'messages.get', 20],
  [/^GET \/messages/, 'messages.list', 5],
  [/^POST \/messages\/send/, 'messages.send', 100],
]

export function costOf(request: string): { method: string; units: number } {
  const known = COSTS.find(([pattern]) => pattern.test(request))
  return known ? { method: known[1], units: known[2] } : { method: request.split('?')[0]!, units: 0 }
}

interface Sent {
  at: number
  request: string
  units: number
}

// Tells the pages apart: each has its own meter, and two popout tabs have the
// same address.
const PAGE_ID = Math.random().toString(36).slice(2, 6)
const pageName = () => `${location.pathname}${location.hash} ${PAGE_ID}`

// Counts what this page asked of Gmail in the last minute, per account. Gmail
// says only that the limit is out, not who spent it, and the background and
// each view spend it separately, so each reports its own share. Requests are
// counted when sent: Google doesn't say whether a refused one costs anything.
export function createQuotaMeter(log: (line: string) => void, now: () => number = Date.now) {
  const sent = new Map<string, Sent[]>()
  const reportedAt = new Map<string, number>()
  const pauses = new Map<string, { until: number; strikes: number }>()

  const paused = (account: string) => (pauses.get(account)?.until ?? -Infinity) > now()

  function report(account: string, why: string) {
    const last = reportedAt.get(account)
    if (last !== undefined && now() - last < WINDOW_MS) return
    reportedAt.set(account, now())
    const recent = sent.get(account) ?? []
    const byMethod = new Map<string, { count: number; units: number }>()
    const byRequest = new Map<string, number>()
    for (const { request, units } of recent) {
      const { method } = costOf(request)
      const entry = byMethod.get(method) ?? { count: 0, units: 0 }
      byMethod.set(method, { count: entry.count + 1, units: entry.units + units })
      byRequest.set(request, (byRequest.get(request) ?? 0) + 1)
    }
    const total = recent.reduce((sum, it) => sum + it.units, 0)
    // A background restart empties the meter, so say how long it really covers.
    const seconds = recent.length ? Math.round((now() - recent[0]!.at) / 1000) : 0
    const methods = [...byMethod]
      .sort(([, a], [, b]) => b.units - a.units)
      .map(([method, { count, units }]) => `${method} x${count}=${units}`)
      .join(', ')
    const [request, times] = [...byRequest].sort(([, a], [, b]) => b - a)[0] ?? []
    log(
      `quota: ${why} ${account}, ${pageName()} used ${total} units in ${seconds}s: ${methods || 'nothing'}` +
        (times && times > 1 ? `; most repeated x${times}: ${request}` : ''),
    )
  }

  return {
    record(account: string, requests: string[]) {
      const cutoff = now() - WINDOW_MS
      const recent = (sent.get(account) ?? []).filter((it) => it.at > cutoff)
      recent.push(...requests.map((request) => ({ at: now(), request, units: costOf(request).units })))
      sent.set(account, recent)
      if (recent.reduce((sum, it) => sum + it.units, 0) >= HIGH_USE_UNITS) report(account, 'high use on')
    },
    limitHit(account: string) {
      report(account, 'limit hit on')
      // A batch is refused many times over at once; that is one strike.
      if (paused(account)) return
      const strikes = pauses.get(account)?.strikes ?? 0
      pauses.set(account, { until: now() + PAUSES_MS[Math.min(strikes, PAUSES_MS.length - 1)]!, strikes: strikes + 1 })
    },
    // Only for work nobody is waiting on: what the user asks for still goes,
    // and its answer is what ends a pause early.
    paused,
    clear: (account: string) => void pauses.delete(account),
  }
}

export const quotaMeter = createQuotaMeter((line) => void debugLog(line))
