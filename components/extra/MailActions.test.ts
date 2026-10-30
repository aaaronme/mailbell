import { describe, expect, it } from 'vitest'
import { urlsFromSender } from './MailActions'

const thread = (url: string, account: string, email: string) =>
  ({ url, account, author: { name: '', email } }) as Parameters<typeof urlsFromSender>[1]

describe('urlsFromSender', () => {
  it("stays in the thread's account: another inbox may still want that sender", () => {
    const threads = [
      thread('a1', 'a@x.com', 'news@shop.com'),
      thread('a2', 'a@x.com', 'News@Shop.com'),
      thread('b1', 'b@x.com', 'news@shop.com'),
      thread('a3', 'a@x.com', 'friend@x.com'),
    ]
    expect(urlsFromSender(threads, threads[0]!)).toEqual(['a1', 'a2'])
  })
})
