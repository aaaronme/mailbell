import { describe, expect, it } from 'vitest'
import { labelTree, listQuery } from './folders'
import type { GmailLabel } from '../api/mailbox'

const user = (id: string, name: string): GmailLabel => ({ id, name, type: 'user' })

describe('listQuery', () => {
  it('adds category and unread to the inbox', () => {
    expect(listQuery('INBOX', { category: 'social', unread: true })).toEqual({
      labelIds: ['INBOX', 'CATEGORY_SOCIAL', 'UNREAD'],
      includeSpamTrash: false,
    })
  })
  it('includes spam and trash for their own folders', () => {
    expect(listQuery('TRASH', {})).toEqual({ labelIds: ['TRASH'], includeSpamTrash: true })
  })
  it('has no labels for all mail', () => {
    expect(listQuery('ALL', {})).toEqual({ labelIds: [], includeSpamTrash: false })
  })
  it('lets a search replace the folder', () => {
    expect(listQuery('INBOX', { q: 'from:bob' })).toEqual({ labelIds: [], q: 'from:bob', includeSpamTrash: false })
  })
})

describe('labelTree', () => {
  it('nests by slash and sorts by name', () => {
    const tree = labelTree([user('1', 'Work'), user('2', 'Work/Clients'), user('3', 'Home')])
    expect(tree.map((it) => it.name)).toEqual(['Home', 'Work'])
    expect(tree[1]!.children).toHaveLength(1)
    expect(tree[1]!.children[0]).toMatchObject({ id: '2', name: 'Clients', path: 'Work/Clients' })
  })
  it('makes a synthetic parent for an orphan', () => {
    const tree = labelTree([user('2', 'Orphan/Child'), { id: 'INBOX', name: 'INBOX', type: 'system' }])
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ id: '', name: 'Orphan', path: 'Orphan' })
    expect(tree[0]!.children[0]!.id).toBe('2')
  })
})
