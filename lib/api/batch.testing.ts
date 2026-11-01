import { vi } from 'vitest'

// Loose, so a bare vi.fn() fits.
type Fetch = (input: string, init?: RequestInit) => Promise<Response> | Response

// For tests: a fetch that answers a Gmail batch by sending each of its parts to
// `fetch` as a request of its own, so one per-path handler serves both.
export function answerBatches(handler: Fetch | ReturnType<typeof vi.fn>) {
  const fetch = handler as Fetch
  return vi.fn(async (input: string, init?: RequestInit) => {
    if (!new URL(input).pathname.startsWith('/batch/gmail/v1')) return fetch(input, init)
    const { Authorization } = (init?.headers ?? {}) as Record<string, string>
    const parts = [...String(init?.body).matchAll(/Content-ID: <(item-\d+)>\r\n\r\nGET (\S+)/g)]
    const answers = await Promise.all(
      parts.map(async ([, id, path]) => {
        const resp = await fetch(`https://gmail.googleapis.com${path}`, { headers: Authorization ? { Authorization } : {} })
        return (
          `--answer\r\nContent-Type: application/http\r\nContent-ID: <response-${id}>\r\n\r\n` +
          `HTTP/1.1 ${resp.status} X\r\nContent-Type: application/json\r\n\r\n${await resp.text()}\r\n`
        )
      }),
    )
    return new Response(answers.join('') + '--answer--', {
      headers: { 'Content-Type': 'multipart/mixed; boundary=answer' },
    })
  })
}
