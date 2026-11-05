import { afterEach, expect, it, vi } from 'vitest'
import { gmailFetch, setTokenSource } from './api/gmail'
import { queryClient } from './queryClient'

afterEach(() => vi.unstubAllGlobals())

const retry = queryClient.getDefaultOptions().queries!.retry as (failures: number, err: Error) => boolean

async function failureFrom(answer: Response): Promise<Error> {
  setTokenSource(async () => 'T')
  vi.stubGlobal('fetch', vi.fn(async () => answer))
  return gmailFetch<Error>('retry@x', '/profile').catch((err: Error) => err)
}

it('retries an ordinary failure a few times', async () => {
  const err = await failureFrom(new Response('backend error', { status: 503 }))
  expect(retry(0, err)).toBe(true)
  expect(retry(3, err)).toBe(false)
})

it('does not retry a call Gmail refused for quota', async () => {
  const err = await failureFrom(Response.json({ error: { message: 'Quota exceeded' } }, { status: 403 }))
  expect(retry(0, err)).toBe(false)
})
