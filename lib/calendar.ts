// Meetings in mail: a calendar invite's event (its text/calendar part) and
// video-call links, for "Join" and "Add to calendar" in the thread view.

export interface CalendarEvent {
  title: string
  // iCalendar's own form, YYYYMMDD or YYYYMMDDTHHMMSS: converting needs the
  // time zone, which Google Calendar can do for us.
  start: string
  end?: string
  // UTC (a trailing Z in the invite).
  utc: boolean
  // TZID, when it's one the browser knows (IANA). Outlook's Windows names
  // ("W. Europe Standard Time") aren't, and are read as local time instead -
  // what an invite usually is for its recipient anyway.
  timeZone?: string
  location?: string
}

// RFC 5545: long lines continue on the next one after a space or tab.
function unfold(ics: string) {
  return ics.replace(/\r?\n[ \t]/g, '')
}

function unescape(value: string) {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
}

function knownTimeZone(tz: string | undefined) {
  if (!tz) return undefined
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return undefined
  }
}

// The invite's first event, or null for a cancellation or one sent by Google
// Calendar, which puts it into the Gmail account's own calendar already.
export function parseInvite(ics: string): CalendarEvent | null {
  const lines = unfold(ics).split(/\r?\n/)
  const props = (from: number, to: number) => {
    const map = new Map<string, { params: string; value: string }>()
    for (const line of lines.slice(from, to)) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/)
      if (m && !map.has(m[1]!)) map.set(m[1]!, { params: m[2]!, value: m[3]! })
    }
    return map
  }
  const begin = lines.indexOf('BEGIN:VEVENT')
  const end = lines.indexOf('END:VEVENT')
  if (begin === -1 || end < begin) return null
  const calendar = props(0, begin)
  if (calendar.get('METHOD')?.value === 'CANCEL' || calendar.get('PRODID')?.value.includes('Google Calendar')) return null
  const event = props(begin, end)
  const dtstart = event.get('DTSTART')
  if (!dtstart || !/^\d{8}(T\d{6}Z?)?$/.test(dtstart.value)) return null
  const tzid = dtstart.params.match(/TZID="?([^";]+)"?/)?.[1]
  const dtend = event.get('DTEND')?.value
  return {
    title: unescape(event.get('SUMMARY')?.value ?? ''),
    start: dtstart.value.replace(/Z$/, ''),
    end: dtend && /^\d{8}(T\d{6}Z?)?$/.test(dtend) ? dtend.replace(/Z$/, '') : undefined,
    utc: dtstart.value.endsWith('Z'),
    timeZone: knownTimeZone(tzid),
    location: event.has('LOCATION') ? unescape(event.get('LOCATION')!.value) || undefined : undefined,
  }
}

const allDay = (event: CalendarEvent) => event.start.length === 8

function nextDay(date: string) {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8) + 1))
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

// Google Calendar's prefilled "new event" page, in the given account.
export function addToCalendarUrl(event: CalendarEvent, account: string, details?: string) {
  const z = event.utc ? 'Z' : ''
  const end = event.end ?? (allDay(event) ? nextDay(event.start) : event.start)
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates: `${event.start}${z}/${end}${z}` })
  if (event.timeZone) params.set('ctz', event.timeZone)
  if (event.location) params.set('location', event.location)
  if (details) params.set('details', details)
  params.set('authuser', account)
  return `https://calendar.google.com/calendar/render?${params}`
}

// When the event is, for display: in the reader's time where that's known
// (UTC), else as the invite wrote it.
export function formatEventTime(event: CalendarEvent) {
  const [y, mo, d, h, mi] = [0, 4, 6, 9, 11].map((at, i) => +event.start.slice(at, at + (i ? 2 : 4)))
  const date = event.utc ? new Date(Date.UTC(y!, mo! - 1, d!, h, mi)) : new Date(y!, mo! - 1, d!, h, mi)
  const day = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  if (allDay(event)) return day
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}${event.timeZone ? ` (${event.timeZone})` : ''}`
}

const MEETING_LINKS: [string, RegExp][] = [
  ['Google Meet', /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/],
  ['Zoom', /https:\/\/(?:[\w-]+\.)?zoom\.us\/(?:j|my|w)\/[^\s"'<>]+/],
  ['Teams', /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>]+/],
  ['Webex', /https:\/\/[\w-]+\.webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s"'<>]*/],
]

// The first video-call link in the texts, which may be HTML.
export function findMeetingLink(texts: string[]): { service: string; url: string } | null {
  for (const text of texts) {
    const plain = text.replace(/&amp;/g, '&')
    for (const [service, pattern] of MEETING_LINKS) {
      const url = plain.match(pattern)?.[0]
      if (url) return { service, url }
    }
  }
  return null
}
