import { beforeEach, describe, expect, it } from 'vitest'
import { costOf, createQuotaMeter } from './quotaMeter'

describe('costOf', () => {
  it.each([
    ['GET /profile', 'getProfile', 1],
    ['GET /history?startHistoryId=1', 'history.list', 2],
    ['GET /labels', 'labels.list', 1],
    ['GET /labels/INBOX', 'labels.get', 1],
    ['GET /threads?labelIds=INBOX&maxResults=50', 'threads.list', 10],
    ['GET /threads/t1?format=metadata&metadataHeaders=From', 'threads.get', 40],
    ['GET /threads/t1?format=full', 'threads.get(full)', 120],
    ['POST /threads/t1/modify', 'threads.modify', 10],
    ['POST /threads/t1/trash', 'threads.trash', 20],
    ['POST /threads/t1/untrash', 'threads.untrash', 10],
    ['GET /messages?labelIds=SENT&maxResults=200', 'messages.list', 5],
    ['GET /messages/m1?format=metadata&metadataHeaders=To', 'messages.get', 20],
    ['GET /messages/m1?format=full', 'messages.get(full)', 60],
    ['GET /messages/m1/attachments/a1', 'attachments.get', 20],
    ['POST /messages/send', 'messages.send', 100],
  ])('%s', (request, method, units) => {
    expect(costOf(request)).toEqual({ method, units })
  })

  it('counts a call it has no price for as free, under its own name', () => {
    expect(costOf('GET /drafts?maxResults=1')).toEqual({ method: 'GET /drafts', units: 0 })
  })
})

describe('createQuotaMeter', () => {
  let time: number
  let lines: string[]
  let meter: ReturnType<typeof createQuotaMeter>

  beforeEach(() => {
    time = 1_000_000
    lines = []
    meter = createQuotaMeter((line) => lines.push(line), () => time)
  })

  it('says what the page spent on the account when the limit is hit', () => {
    meter.record('a@x', ['GET /profile'])
    time += 20_000
    meter.record('a@x', ['GET /threads/t1?format=full', 'GET /threads/t1?format=full', 'GET /threads/t2?format=metadata'])
    meter.limitHit('a@x')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('limit hit on a@x')
    expect(lines[0]).toContain('used 281 units in 20s')
    expect(lines[0]).toContain('threads.get(full) x2=240, threads.get x1=40, getProfile x1=1')
    expect(lines[0]).toContain('most repeated x2: GET /threads/t1?format=full')
  })

  it('forgets what is older than a minute', () => {
    meter.record('a@x', ['GET /threads/t1?format=full'])
    time += 61_000
    meter.record('a@x', ['GET /profile'])
    meter.limitHit('a@x')
    expect(lines[0]).toContain('used 1 units in 0s')
  })

  it('keeps accounts apart', () => {
    meter.record('a@x', ['GET /threads/t1?format=full'])
    meter.record('b@x', ['GET /profile'])
    meter.limitHit('b@x')
    expect(lines[0]).toContain('b@x')
    expect(lines[0]).toContain('used 1 units')
  })

  it('reports at most once a minute per account', () => {
    meter.limitHit('a@x')
    meter.limitHit('a@x')
    meter.limitHit('b@x')
    expect(lines).toHaveLength(2)
    time += 60_000
    meter.limitHit('a@x')
    expect(lines).toHaveLength(3)
  })

  it('pauses an account after a refusal, for longer each time, up to a cap', () => {
    expect(meter.paused('a@x')).toBe(false)
    for (const seconds of [30, 60, 120, 120]) {
      meter.limitHit('a@x')
      expect(meter.paused('a@x')).toBe(true)
      expect(meter.paused('b@x')).toBe(false)
      time += seconds * 1000 - 1
      expect(meter.paused('a@x')).toBe(true)
      time += 1
      expect(meter.paused('a@x')).toBe(false)
    }
  })

  it('starts over once Gmail answers again', () => {
    meter.limitHit('a@x')
    time += 30_000
    meter.limitHit('a@x')
    meter.clear('a@x')
    expect(meter.paused('a@x')).toBe(false)
    meter.limitHit('a@x')
    time += 30_000
    expect(meter.paused('a@x')).toBe(false)
  })

  it('reports heavy use before Gmail refuses anything', () => {
    meter.record('a@x', Array.from({ length: 24 }, (_, i) => `GET /threads/t${i}?format=full`))
    expect(lines).toHaveLength(0)
    meter.record('a@x', ['GET /threads/t24?format=full'])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('high use on a@x')
    expect(lines[0]).toContain('used 3000 units')
  })
})
