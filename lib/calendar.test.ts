import { describe, expect, it } from 'vitest'
import { addToCalendarUrl, findMeetingLink, parseInvite } from './calendar'

const invite = (event: string, calendar = 'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN\r\nMETHOD:REQUEST') =>
  `BEGIN:VCALENDAR\r\n${calendar}\r\nBEGIN:VEVENT\r\n${event}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`

describe('parseInvite', () => {
  it('reads the event, unfolding and unescaping', () => {
    const ics = invite('SUMMARY:Planning\\, Q4\r\n review\r\nDTSTART;TZID=Europe/Berlin:20261103T100000\r\nDTEND;TZID=Europe/Berlin:20261103T110000\r\nLOCATION:Room 1')
    expect(parseInvite(ics)).toEqual({
      title: 'Planning, Q4review',
      start: '20261103T100000',
      end: '20261103T110000',
      utc: false,
      timeZone: 'Europe/Berlin',
      location: 'Room 1',
    })
  })

  it("keeps UTC, drops a Windows time zone, skips cancellations and Google's own invites", () => {
    expect(parseInvite(invite('SUMMARY:A\r\nDTSTART:20261103T090000Z'))).toMatchObject({ start: '20261103T090000', utc: true })
    expect(parseInvite(invite('SUMMARY:A\r\nDTSTART;TZID="W. Europe Standard Time":20261103T100000'))?.timeZone).toBeUndefined()
    expect(parseInvite(invite('SUMMARY:A\r\nDTSTART:20261103T090000Z', 'METHOD:CANCEL'))).toBeNull()
    expect(parseInvite(invite('SUMMARY:A\r\nDTSTART:20261103T090000Z', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN'))).toBeNull()
  })
})

describe('addToCalendarUrl', () => {
  it('prefills a timed event in its zone, and an all-day one with an exclusive end', () => {
    const timed = new URL(addToCalendarUrl({ title: 'Planning', start: '20261103T100000', end: '20261103T110000', utc: false, timeZone: 'Europe/Berlin' }, 'me@gmail.com', 'https://meet.google.com/abc-defg-hij'))
    expect(Object.fromEntries(timed.searchParams)).toEqual({
      action: 'TEMPLATE',
      text: 'Planning',
      dates: '20261103T100000/20261103T110000',
      ctz: 'Europe/Berlin',
      details: 'https://meet.google.com/abc-defg-hij',
      authuser: 'me@gmail.com',
    })
    const day = new URL(addToCalendarUrl({ title: 'Offsite', start: '20261231', utc: false }, 'me@gmail.com'))
    expect(day.searchParams.get('dates')).toBe('20261231/20270101')
  })
})

describe('findMeetingLink', () => {
  it('finds the first call link, in HTML too', () => {
    expect(findMeetingLink(['no link', '<a href="https://us02web.zoom.us/j/123?pwd=x&amp;from=a">Join</a>'])).toEqual({
      service: 'Zoom',
      url: 'https://us02web.zoom.us/j/123?pwd=x&from=a',
    })
    expect(findMeetingLink(['Join at https://meet.google.com/abc-defg-hij today'])?.service).toBe('Google Meet')
    expect(findMeetingLink(['https://zoom.us/pricing'])).toBeNull()
  })
})
