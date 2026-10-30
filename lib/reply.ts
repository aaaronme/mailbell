import { parseAddressField, parseMailbox, type ThreadMail } from './api/gmail'

type Message = ThreadMail['messages'][number]

export interface Recipients {
  to: string[]
  cc: string[]
}

const emailOf = (address: string) => parseMailbox(address).email.toLowerCase()

// Who a reply to `message` goes to, as Gmail does it: the sender (or their
// Reply-To), or the original recipients when the message is the account's
// own. Reply all adds everyone else in To and Cc, minus the account itself.
export function replyRecipients(message: Message, account: string, all: boolean): Recipients {
  const me = account.toLowerCase()
  const fromMe = message.senderEmail.toLowerCase() === me
  const sender = message.replyTo
    ? parseAddressField(message.replyTo)
    : [message.senderName === message.senderEmail ? message.senderEmail : `${message.senderName} <${message.senderEmail}>`]
  const to = fromMe ? message.to : sender
  if (!all) return { to, cc: [] }
  const seen = new Set([me, ...to.map(emailOf)])
  const cc = [...(fromMe ? [] : message.to), ...message.cc].filter((it) => {
    const email = emailOf(it)
    if (seen.has(email)) return false
    seen.add(email)
    return true
  })
  return { to, cc }
}

export function replySubject(subject: string) {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`
}

function utf8Base64(text: string) {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// RFC 2047: a header value with anything beyond ASCII goes as an encoded word.
function encodeWord(text: string) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${utf8Base64(text)}?=`
}

function encodeAddress(address: string) {
  const { name, email } = parseMailbox(address)
  if (name === email) return email
  const word = encodeWord(name)
  return `${word === name ? `"${name.replace(/["\\]/g, '\\$&')}"` : word} <${email}>`
}

// A plain-text reply as an RFC 822 message. In-Reply-To and References keep
// it in the thread for every mail client, not just Gmail; From is left to
// Gmail, which fills in the account's own name.
export function buildReply(reply: {
  recipients: Recipients
  subject: string
  inReplyTo?: string
  references?: string
  text: string
}): string {
  const headers = [
    `To: ${reply.recipients.to.map(encodeAddress).join(', ')}`,
    reply.recipients.cc.length ? `Cc: ${reply.recipients.cc.map(encodeAddress).join(', ')}` : null,
    `Subject: ${encodeWord(replySubject(reply.subject))}`,
    reply.inReplyTo ? `In-Reply-To: ${reply.inReplyTo}` : null,
    reply.references ? `References: ${reply.references}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  const body = utf8Base64(reply.text.replace(/\r?\n/g, '\r\n')).replace(/.{76}/g, '$&\r\n')
  return `${headers.filter((it) => it !== null).join('\r\n')}\r\n\r\n${body}\r\n`
}

export function toBase64Url(raw: string) {
  return utf8Base64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
