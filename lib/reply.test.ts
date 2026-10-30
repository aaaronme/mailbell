import { describe, expect, it } from 'vitest'
import { buildReply, replyRecipients, replySubject, toBase64Url } from './reply'

const message = {
  senderName: 'Bob',
  senderEmail: 'bob@example.com',
  time: '',
  to: ['Me <me@gmail.com>', 'Carol <carol@example.com>'],
  cc: ['dave@example.com', 'BOB@example.com'],
  contentHtml: '',
}

describe('replyRecipients', () => {
  it('replies to the sender, or to everyone but the account', () => {
    expect(replyRecipients(message, 'me@gmail.com', false)).toEqual({ to: ['Bob <bob@example.com>'], cc: [] })
    expect(replyRecipients(message, 'me@gmail.com', true)).toEqual({
      to: ['Bob <bob@example.com>'],
      cc: ['Carol <carol@example.com>', 'dave@example.com'],
    })
  })

  it('honours Reply-To, and follows up on the account’s own message', () => {
    expect(replyRecipients({ ...message, replyTo: 'List <list@example.com>' }, 'me@gmail.com', false).to).toEqual([
      'List <list@example.com>',
    ])
    const mine = { ...message, senderEmail: 'me@gmail.com', to: ['Bob <bob@example.com>'], cc: [] }
    expect(replyRecipients(mine, 'me@gmail.com', false).to).toEqual(['Bob <bob@example.com>'])
  })
})

describe('buildReply', () => {
  it('threads the reply and encodes what isn’t ASCII', () => {
    const raw = buildReply({
      recipients: { to: ['Jörg <j@example.com>'], cc: ['Doe, Jane <jane@example.com>'] },
      subject: 'Grüße',
      inReplyTo: '<m2@example.com>',
      references: '<m1@example.com> <m2@example.com>',
      text: 'Danke!\nBis bald',
    })
    const [head, body] = raw.split('\r\n\r\n')
    expect(head!.split('\r\n')).toEqual([
      `To: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode('Jörg')))}?= <j@example.com>`,
      'Cc: "Doe, Jane" <jane@example.com>',
      `Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode('Re: Grüße')))}?=`,
      'In-Reply-To: <m2@example.com>',
      'References: <m1@example.com> <m2@example.com>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ])
    expect(new TextDecoder().decode(Uint8Array.from(atob(body!.trim()), (c) => c.charCodeAt(0)))).toBe('Danke!\r\nBis bald')
    expect(toBase64Url(raw)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('adds Re: only once', () => {
    expect(replySubject('Plans')).toBe('Re: Plans')
    expect(replySubject('RE: Plans')).toBe('RE: Plans')
  })
})
