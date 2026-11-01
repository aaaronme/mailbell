import { threadToFeed, threadToMail, type GmailMessage, type GmailPart, type GmailThread } from '@/lib/api/gmail'
import type { EmailThread } from '@/lib/StateManager'

// Sample mail for the store screenshots. Every person, company and domain is
// made up; the one real brand is the phishing mail's display name.

export const PERSONAL = 'alex.rivera@gmail.com'
export const WORK = 'alex@northwind-studio.com'
export const SIDE = 'hello@fernleaf.app'
export const ACCOUNTS = [PERSONAL, WORK, SIDE]

// Monday morning, early November.
export const NOW = new Date(2026, 10, 2, 10, 24)

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)
const at = (month: number, day: number, h: number, min = 0) => new Date(2026, month - 1, day, h, min)

interface Mail {
  from: string
  to?: string
  cc?: string
  date: Date
  html: string
  auth?: 'pass' | 'fail'
  attachment?: { name: string; mime: string; size: number }
}

interface Thread {
  id: string
  account: string
  subject: string
  labels: string[]
  messages: Mail[]
}

const domainOf = (from: string) => from.replace(/.*@/, '').replace(/>.*/, '')

function authResults(from: string, auth: 'pass' | 'fail') {
  const d = domainOf(from)
  return auth === 'pass'
    ? `mx.google.com; dkim=pass header.d=${d}; spf=pass smtp.mailfrom=${d}; dmarc=pass header.from=${d}`
    : `mx.google.com; dkim=none; spf=fail smtp.mailfrom=${d}; dmarc=fail (p=NONE) header.from=${d}`
}

const b64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

const snippetOf = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)

function toGmail(thread: Thread): GmailThread {
  return {
    id: thread.id,
    historyId: '1000',
    messages: thread.messages.map((mail, i): GmailMessage => {
      const last = i === thread.messages.length - 1
      const headers = [
        { name: 'From', value: mail.from },
        { name: 'To', value: mail.to ?? thread.account },
        ...(mail.cc ? [{ name: 'Cc', value: mail.cc }] : []),
        { name: 'Subject', value: i === 0 ? thread.subject : `Re: ${thread.subject}` },
        { name: 'Date', value: mail.date.toUTCString() },
        ...(mail.auth ? [{ name: 'Authentication-Results', value: authResults(mail.from, mail.auth) }] : []),
      ]
      const html: GmailPart = { mimeType: 'text/html', body: { size: mail.html.length, data: b64(mail.html) } }
      const payload: GmailPart = mail.attachment
        ? {
            mimeType: 'multipart/mixed',
            headers: [...headers, { name: 'Content-Type', value: 'multipart/mixed; boundary="b1"' }],
            parts: [
              html,
              {
                mimeType: mail.attachment.mime,
                filename: mail.attachment.name,
                body: { size: mail.attachment.size, attachmentId: `att-${thread.id}-${i}` },
              },
            ],
          }
        : { ...html, headers: [...headers, { name: 'Content-Type', value: 'text/html; charset=utf-8' }] }
      // Read and unread are the thread's newest message's.
      const labels = last ? thread.labels : thread.labels.filter((it) => it !== 'UNREAD')
      return {
        id: `${thread.id}${i}`,
        threadId: thread.id,
        labelIds: labels,
        snippet: snippetOf(mail.html),
        internalDate: String(mail.date.getTime()),
        payload,
      }
    }),
  }
}

const p = (...paras: string[]) => paras.map((it) => `<p>${it}</p>`).join('\n')
const sign = (name: string) => `<p>${name}</p>`

const PRIYA = 'Priya Raman <priya@northwind-studio.com>'
const MARCUS = 'Marcus Bell <marcus@northwind-studio.com>'

export const NEWSLETTER = '18f3c2a9d07e4b15'
export const PHISHING = '18f3b9e1c44a2d70'
export const LAUNCH_PLAN = '18f3c4b8e21a9f03'

const NEWSLETTER_HTML = `
<style>
  .nl { font-family: Georgia, 'Times New Roman', serif; color: #2b2622; max-width: 600px; margin: 0 auto; }
  .nl .img { background: #e9e4da; color: #8a8174; display: flex; align-items: center; justify-content: center; font: 13px/1.4 -apple-system, sans-serif; }
  .nl h1 { font-size: 28px; line-height: 1.2; margin: 24px 0 8px; font-weight: normal; }
  .nl .kicker { font: 600 11px/1 -apple-system, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #b0563b; }
  .nl p { font-size: 16px; line-height: 1.6; }
  .nl .row { display: flex; gap: 16px; margin-top: 24px; }
  .nl .row > div { flex: 1; }
  .nl .row h3 { font-size: 17px; margin: 10px 0 4px; font-weight: normal; }
  .nl .foot { font: 12px/1.5 -apple-system, sans-serif; color: #8a8174; border-top: 1px solid #e3ddd2; margin-top: 32px; padding-top: 16px; }
</style>
<div class="nl">
  <div style="text-align:center;font-size:30px;letter-spacing:.02em;padding:6px 0 14px;border-bottom:2px solid #2b2622">Fieldnotes <i>Weekly</i></div>
  <div class="img" style="height:240px;margin-top:20px"><img src="https://cdn.fieldnotes.blog/142/hero-map.jpg" alt="A folded trail map on a café table" width="600" height="240"></div>
  <div class="kicker" style="margin-top:24px">Issue #142 · The long read</div>
  <h1>The quiet return of the paper map</h1>
  <p>Hikers, cyclists and a surprising number of city walkers are folding maps back into their pockets. We spent a month with the people who draw them, and asked why a sheet of paper still beats a phone at the top of a ridge.</p>
  <div class="row">
    <div><div class="img" style="height:120px"><img src="https://cdn.fieldnotes.blog/142/print-shop.jpg" alt="Inside a print shop" width="280" height="120"></div><h3>Inside the last map press in the valley</h3></div>
    <div><div class="img" style="height:120px"><img src="https://cdn.fieldnotes.blog/142/compass.jpg" alt="A compass on a map" width="280" height="120"></div><h3>Five routes worth learning by heart</h3></div>
  </div>
  <div class="foot">You're receiving this because you subscribed at fieldnotes.blog. <a href="https://fieldnotes.blog/unsubscribe?u=8812">Unsubscribe</a> · <a href="https://fieldnotes.blog/preferences">Preferences</a><img src="https://t.fieldnotes.blog/open.gif?u=8812" width="1" height="1" alt=""></div>
</div>`

const PHISHING_HTML = `
<div style="font-family:Arial,sans-serif;max-width:560px">
  <img src="https://paypa1-support.com/assets/logo.png" alt="PayPal" width="120">
  <p>Dear Customer,</p>
  <p>We noticed unusual activity on your account and have temporarily limited what you can do with it. To restore full access, please confirm your information within 24 hours.</p>
  <p><a href="https://paypa1-support.com/secure/account-review?case=PP-4471-209" style="background:#0070ba;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:bold">Confirm your account</a></p>
  <p>If you do not confirm, your account will be permanently suspended.</p>
  <p>Thank you,<br>Account Security Team</p>
</div>`

const LAUNCH_HTML = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2328">
  <p>Hi all,</p>
  <p>Final version of the Q4 launch plan is attached. Changes since Friday's review:</p>
  <ul>
    <li><b>Launch moves to Tue 17 Nov</b> so the press embargo lifts after the Harbor &amp; Pine keynote.</li>
    <li>Pricing page copy is locked; Jonas is finishing the last two illustrations.</li>
    <li>Support gets the FAQ and macros on Thursday for a dry run.</li>
  </ul>
  <table style="border-collapse:collapse;margin:12px 0;font-size:13px">
    <tr style="background:#f3f4f6"><th style="text-align:left;padding:6px 12px;border:1px solid #d8dee4">Milestone</th><th style="text-align:left;padding:6px 12px;border:1px solid #d8dee4">Owner</th><th style="text-align:left;padding:6px 12px;border:1px solid #d8dee4">Due</th></tr>
    <tr><td style="padding:6px 12px;border:1px solid #d8dee4">Final design QA</td><td style="padding:6px 12px;border:1px solid #d8dee4">Jonas</td><td style="padding:6px 12px;border:1px solid #d8dee4">Thu 5 Nov</td></tr>
    <tr><td style="padding:6px 12px;border:1px solid #d8dee4">Press kit to partners</td><td style="padding:6px 12px;border:1px solid #d8dee4">Marcus</td><td style="padding:6px 12px;border:1px solid #d8dee4">Mon 9 Nov</td></tr>
    <tr><td style="padding:6px 12px;border:1px solid #d8dee4">Go / no-go</td><td style="padding:6px 12px;border:1px solid #d8dee4">Alex</td><td style="padding:6px 12px;border:1px solid #d8dee4">Fri 13 Nov</td></tr>
  </table>
  <p>Can you give it a last read before Thursday's sync? Comments in the doc are fine, or just reply here.</p>
  <p>Thanks,<br>Priya</p>
</div>`

const THREADS: Thread[] = [
  {
    id: '18f3c51d7a2e6b90',
    account: PERSONAL,
    subject: 'Your sign-in code',
    labels: ['INBOX', 'UNREAD'],
    messages: [
      {
        from: 'Larkspur Credit Union <alerts@larkspurcu.com>',
        date: minutesAgo(3),
        auth: 'pass',
        html: p('Use code <b>482913</b> to sign in to online banking.', 'This code expires in 10 minutes. If you didn\'t try to sign in, call us at the number on the back of your card.'),
      },
    ],
  },
  {
    id: LAUNCH_PLAN,
    account: WORK,
    subject: 'Q4 launch plan: final review before Thursday',
    labels: ['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT'],
    messages: [
      {
        from: PRIYA,
        to: 'design@northwind-studio.com',
        date: at(10, 30, 16, 5),
        auth: 'pass',
        html: p('Hi team,', "Here's the draft plan for the Q4 launch. Main open question is the date: the 10th clashes with the Harbor &amp; Pine keynote.", 'Priya'),
      },
      {
        from: MARCUS,
        to: 'design@northwind-studio.com',
        date: at(10, 30, 17, 42),
        auth: 'pass',
        html: p('Moving to the 17th works for press. I can have the kit to partners by the 9th.', 'Marcus'),
      },
      {
        from: PRIYA,
        to: 'design@northwind-studio.com',
        cc: 'Marcus Bell <marcus@northwind-studio.com>, Jonas Weber <jonas@weberdesign.co>',
        date: minutesAgo(26),
        auth: 'pass',
        html: LAUNCH_HTML,
        attachment: { name: 'Q4-launch-plan-v3.pdf', mime: 'application/pdf', size: 1_284_000 },
      },
    ],
  },
  {
    id: '18f3c3f0b5d18e27',
    account: SIDE,
    subject: 'Payout of $1,284.50 is on its way',
    labels: ['INBOX', 'UNREAD'],
    messages: [
      {
        from: 'Juniper Payments <receipts@junipay.com>',
        date: minutesAgo(44),
        auth: 'pass',
        html: p('Your payout of <b>$1,284.50</b> for Fernleaf is on its way to your account ending in 4471.', 'It should arrive by Wednesday, 4 November.'),
      },
    ],
  },
  {
    id: '18f3c2e7a94b0c55',
    account: PERSONAL,
    subject: 'Dinner Saturday?',
    labels: ['INBOX', 'UNREAD'],
    messages: [
      {
        from: 'Daniel Okafor <daniel.okafor@gmail.com>',
        date: at(11, 1, 19, 20),
        html: p('Are you two around on Saturday? Thinking of finally trying the new place on Elm St.'),
      },
      {
        from: 'Daniel Okafor <daniel.okafor@gmail.com>',
        date: minutesAgo(72),
        html: p('Booked a table for four at 7:30. Can you and Sam make it? Mina says she\'ll bring the good bread.', 'D.'),
      },
    ],
  },
  {
    id: '18f3c1a0e3d47b62',
    account: WORK,
    subject: 'Revised homepage mockups',
    labels: ['INBOX', 'UNREAD', 'Label_N4'],
    messages: [
      {
        from: 'Jonas Weber <jonas@weberdesign.co>',
        date: minutesAgo(97),
        auth: 'pass',
        html: p('Hi Alex,', 'Attached are the v4 mockups with the lighter hero and the new pricing cards. I kept the old nav as an alternative on the last page.', 'Jonas'),
        attachment: { name: 'homepage-mockups-v4.pdf', mime: 'application/pdf', size: 8_420_000 },
      },
    ],
  },
  {
    id: '18f3c0d2f81a5e34',
    account: SIDE,
    subject: 'Feature request: export to CSV',
    labels: ['INBOX', 'UNREAD', 'Label_F1'],
    messages: [
      {
        from: 'Hannah Cole <hannah@colebakery.com>',
        to: SIDE,
        date: minutesAgo(129),
        html: p('Hi! We use Fernleaf to plan our weekly orders and love it. Any chance of exporting the plan to CSV so I can send it to our supplier?', 'Hannah'),
      },
    ],
  },
  {
    id: PHISHING,
    account: PERSONAL,
    subject: 'Your account has been limited',
    labels: ['INBOX', 'UNREAD'],
    messages: [{ from: 'PayPal <service@paypa1-support.com>', date: minutesAgo(146), auth: 'fail', html: PHISHING_HTML }],
  },
  {
    id: '18f3a8c41e07d2b9',
    account: WORK,
    subject: 'Brand refresh: round 2 feedback',
    labels: ['INBOX', 'Label_N2'],
    messages: [
      { from: 'Leo Martins <leo@harborandpine.com>', date: at(10, 29, 11, 0), auth: 'pass', html: p('Thanks for the first round. A few notes from our side attached.') },
      { from: 'Alex Rivera <alex@northwind-studio.com>', to: 'leo@harborandpine.com', date: at(10, 29, 15, 30), html: p('Got it, we\'ll fold these in.') },
      { from: 'Leo Martins <leo@harborandpine.com>', date: at(11, 1, 18, 30), auth: 'pass', html: p('The team loves the warmer palette. Can we see the wordmark with slightly tighter spacing before Friday?', 'Leo') },
    ],
  },
  {
    id: NEWSLETTER,
    account: PERSONAL,
    subject: 'Issue #142: The quiet return of the paper map',
    labels: ['INBOX'],
    messages: [{ from: 'Fieldnotes Weekly <hello@fieldnotes.blog>', date: at(11, 1, 7, 0), auth: 'pass', html: NEWSLETTER_HTML }],
  },
  {
    id: '18f39b2e5c81f4a6',
    account: SIDE,
    subject: 'Build #318 passed on main',
    labels: ['INBOX'],
    messages: [{ from: 'Fernleaf CI <ci@fernleaf.app>', to: SIDE, date: at(10, 31, 22, 14), auth: 'pass', html: p('All 214 checks passed in 3m 12s. Deployed to staging.') }],
  },
  {
    id: '18f397a6d02c3e81',
    account: WORK,
    subject: 'Offsite agenda + room bookings',
    labels: ['INBOX', 'STARRED'],
    messages: [{ from: MARCUS, date: at(10, 31, 12, 5), auth: 'pass', html: p('Draft agenda for the 19th is in the shared folder. I\'ve booked the big room at the Foundry for the afternoon.') }],
  },
  {
    id: '18f38e40a7b6c1d2',
    account: PERSONAL,
    subject: 'Your trip to Lisbon: check-in opens tomorrow',
    labels: ['INBOX', 'STARRED', 'Label_G2'],
    messages: [
      {
        from: 'Alder Air <itinerary@alderair.com>',
        date: at(10, 30, 9, 15),
        auth: 'pass',
        html: p('Flight AD 214 · Boston to Lisbon · Thu 12 Nov, 19:40. Your boarding documents are attached.'),
        attachment: { name: 'itinerary-AD214.pdf', mime: 'application/pdf', size: 214_000 },
      },
    ],
  },
  {
    id: '18f38a9c3d5e0f17',
    account: SIDE,
    subject: 'Interview request: indie apps roundup',
    labels: ['INBOX', 'Label_F2'],
    messages: [{ from: 'Sofia Marquez <sofia@thelowdown.news>', to: SIDE, date: at(10, 30, 8, 2), auth: 'pass', html: p('I\'m putting together a piece on small teams building planning tools. Would you have 20 minutes next week?') }],
  },
  {
    id: '18f37f1b6e2a9c48',
    account: WORK,
    subject: 'Kickoff notes and next steps',
    labels: ['INBOX', 'Label_N3'],
    messages: [{ from: 'Ruth Adeyemi <ruth@meridianclinics.org>', date: at(10, 29, 16, 40), auth: 'pass', html: p('Thanks for a great kickoff. Notes attached; we\'ll send the patient-journey research by Wednesday.'), attachment: { name: 'kickoff-notes.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 48_000 } }],
  },
  {
    id: '18f37a0d4c9b2e63',
    account: PERSONAL,
    subject: 'Photos from the weekend',
    labels: ['INBOX', 'Label_G1'],
    messages: [{ from: 'Elena Rivera <elena.rivera58@gmail.com>', date: at(10, 28, 20, 11), html: p('A few from the lake. The one of Sam with the kayak is my favourite.'), attachment: { name: 'lake-weekend.zip', mime: 'application/zip', size: 24_600_000 } }],
  },
  {
    id: '18f375e8b1a4d09c',
    account: WORK,
    subject: 'Your October payslip is ready',
    labels: ['INBOX'],
    messages: [{ from: 'Northwind Payroll <payroll@northwind-studio.com>', date: at(10, 28, 9, 0), auth: 'pass', html: p('Your payslip for October 2026 is available in the payroll portal.') }],
  },
  {
    id: '18f36c93f7e2a15b',
    account: SIDE,
    subject: 'Small bug on Android',
    labels: ['INBOX', 'Label_F3'],
    messages: [{ from: 'Kofi Mensah <kofi.mensah@fastmail.com>', to: SIDE, date: at(10, 27, 14, 37), html: p('Love the app! Small thing: the week view cuts off Sunday on my Pixel in landscape.') }],
  },
  {
    id: '18f3651a2b8c7d40',
    account: PERSONAL,
    subject: 'Your order has been delivered',
    labels: ['INBOX', 'Label_G3'],
    messages: [{ from: 'Greenway Grocers <orders@greenwaygrocers.com>', date: at(10, 26, 17, 52), auth: 'pass', html: p('Order #GW-58210 was left at your front door at 5:48 pm.') }],
  },
  {
    id: '18f362b7c0d9e1a4',
    account: PERSONAL,
    subject: 'Sunday ride: coast loop, 9am at the bakery',
    labels: ['INBOX'],
    messages: [{ from: 'Oakridge Cycling Club <rides@oakridgecc.org>', date: at(10, 26, 8, 30), auth: 'pass', html: p('62 km, mostly flat, coffee stop at the harbour. Bring lights, sunset is early now.') }],
  },
  {
    id: '18f35e04a8b3c7f1',
    account: PERSONAL,
    subject: 'Moved the dentist to Thursday',
    labels: ['INBOX', 'Label_G1'],
    messages: [{ from: 'Sam Rivera <sam.rivera.k@gmail.com>', date: at(10, 25, 21, 3), html: p('They had a 4:15 slot on Thursday so I took it. Can you do pickup from school that day?') }],
  },
  {
    id: '18f35a91d6e2f0b8',
    account: PERSONAL,
    subject: 'Your hold is ready for pickup',
    labels: ['INBOX'],
    messages: [{ from: 'Maple Street Library <holds@maplestreetlibrary.org>', date: at(10, 24, 10, 12), auth: 'pass', html: p('"The Overstory" is waiting for you at the front desk until Saturday, 31 October.') }],
  },
  {
    id: '18f356c2e9a1b4d3',
    account: PERSONAL,
    subject: 'Receipt for October rent',
    labels: ['INBOX', 'Label_G3'],
    messages: [{ from: 'Brookline Property Co. <billing@brooklineprop.com>', date: at(10, 23, 9, 5), auth: 'pass', html: p('We received your payment of $2,150.00 for unit 4B. Thank you!'), attachment: { name: 'receipt-oct-2026.pdf', mime: 'application/pdf', size: 92_000 } }],
  },
  {
    id: '18f3601e9d3a4b27',
    account: PERSONAL,
    subject: 'Congratulations, you have been selected!',
    labels: ['SPAM', 'UNREAD'],
    messages: [{ from: 'Rewards Center <win@prize-claims.biz>', date: at(11, 1, 3, 12), html: p('Claim your reward now.') }],
  },
]

const USER_LABELS: Record<string, { id: string; name: string; color: string }[]> = {
  [PERSONAL]: [
    { id: 'Label_G1', name: 'Family', color: '#16a766' },
    { id: 'Label_G2', name: 'Travel', color: '#4a86e8' },
    { id: 'Label_G3', name: 'Receipts', color: '#a479e2' },
  ],
  [WORK]: [
    { id: 'Label_N1', name: 'Clients', color: '#f691b3' },
    { id: 'Label_N2', name: 'Clients/Harbor & Pine', color: '#f691b3' },
    { id: 'Label_N3', name: 'Clients/Meridian', color: '#f691b3' },
    { id: 'Label_N4', name: 'Design reviews', color: '#ffad47' },
  ],
  [SIDE]: [
    { id: 'Label_F1', name: 'Customers', color: '#2da2bb' },
    { id: 'Label_F2', name: 'Press', color: '#fad165' },
    { id: 'Label_F3', name: 'Bugs', color: '#fb4c2f' },
  ],
}

const SYSTEM_LABELS = ['INBOX', 'STARRED', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'IMPORTANT', 'UNREAD']

const gmailThreads = new Map(THREADS.map((it) => [it.id, toGmail(it)]))

function labelsOf(account: string) {
  const threads = THREADS.filter((it) => it.account === account)
  const counts = (id: string) => {
    const own = threads.filter((it) => it.labels.includes(id))
    return { threadsTotal: own.length, threadsUnread: own.filter((it) => it.labels.includes('UNREAD')).length }
  }
  return [
    ...SYSTEM_LABELS.map((id) => ({ id, name: id, type: 'system', ...counts(id) })),
    ...USER_LABELS[account]!.map(({ id, name, color }) => ({
      id,
      name,
      type: 'user',
      color: { backgroundColor: color, textColor: '#ffffff' },
      ...counts(id),
    })),
  ]
}

// The Gmail API as each account sees it; the bearer token is the account.
export async function gmailApi(input: string, init?: RequestInit): Promise<Response> {
  const bearer = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
  const account = bearer.replace(/^Bearer /, '')
  const url = new URL(input)
  const path = url.pathname.replace(/^.*\/gmail\/v1\/users\/me/, '')
  if (path === '/profile') return Response.json({ emailAddress: account, historyId: '1000' })
  if (path === '/history') return Response.json({ history: [], historyId: '1000' })
  if (path === '/labels') return Response.json({ labels: labelsOf(account).map(({ id, name, type }) => ({ id, name, type })) })
  if (path.startsWith('/labels/')) {
    const id = decodeURIComponent(path.slice('/labels/'.length))
    return Response.json(labelsOf(account).find((it) => it.id === id) ?? {})
  }
  if (path === '/threads') {
    const wanted = url.searchParams.getAll('labelIds')
    const spamTrash = url.searchParams.get('includeSpamTrash') === 'true'
    const ids = THREADS.filter(
      (it) =>
        it.account === account &&
        wanted.every((l) => it.labels.includes(l)) &&
        (spamTrash || !it.labels.some((l) => l === 'SPAM' || l === 'TRASH')),
    )
      .sort((a, b) => b.messages.at(-1)!.date.getTime() - a.messages.at(-1)!.date.getTime())
      .map((it) => ({ id: it.id }))
    return Response.json({ threads: ids, resultSizeEstimate: ids.length })
  }
  const thread = path.match(/^\/threads\/([^/]+)$/)
  if (thread) {
    const found = gmailThreads.get(thread[1]!)
    return found ? Response.json(found) : new Response('{}', { status: 404 })
  }
  if (path === '/messages') return Response.json({ messages: [] })
  return Response.json({})
}

// What the background would have stored for the toolbar popup: the unread
// inbox threads, newest first.
export function popupThreads(skip: string[] = []): EmailThread[] {
  return THREADS.filter((it) => it.labels.includes('INBOX') && it.labels.includes('UNREAD') && !skip.includes(it.id))
    .map((it) => {
      const gmail = gmailThreads.get(it.id)!
      return { ...threadToMail(gmail), ...threadToFeed(it.account, gmail), account: it.account }
    })
    .sort((a, b) => b.modified.localeCompare(a.modified))
}

// Signed in, with the setup already behind them.
export function storageSeed(theme: object) {
  return {
    oauthAccounts: ACCOUNTS.map((email) => ({ email, refreshToken: 'r', accessToken: 't', expiresAt: 0 })),
    correspondentsBootstrapped: ACCOUNTS,
    // People Alex has written to, so their mail isn't flagged as a first contact.
    correspondents: {
      [PERSONAL]: ['daniel.okafor@gmail.com', 'hello@fieldnotes.blog', 'elena.rivera58@gmail.com'],
      [WORK]: ['priya@northwind-studio.com', 'marcus@northwind-studio.com', 'jonas@weberdesign.co', 'leo@harborandpine.com', 'ruth@meridianclinics.org'],
      [SIDE]: ['hannah@colebakery.com', 'kofi.mensah@fastmail.com'],
    },
    theme,
  }
}
