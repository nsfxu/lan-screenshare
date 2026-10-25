import { describe, expect, it } from 'vitest'
import {
  CHAT_GROUP_MS,
  chatParts,
  completeMention,
  countUnread,
  excerpt,
  mentionQuery,
  mentionRanges,
  mentions,
  safeLink,
  startsGroup,
  suggestNames
} from '../src/shared/chat'
import type { ChatMessage } from '../src/shared/types'

const msg = (id: string, userId: string, ts: number, system = false): ChatMessage => ({
  id,
  userId,
  name: userId,
  color: '#fff',
  text: id,
  ts,
  system
})

describe('chat', () => {
  it('groups messages from the same person close together', () => {
    const a1 = msg('1', 'alice', 0)
    expect(startsGroup(undefined, a1)).toBe(true)
    expect(startsGroup(a1, msg('2', 'alice', 60_000))).toBe(false)
    expect(startsGroup(a1, msg('3', 'alice', CHAT_GROUP_MS))).toBe(true)
    expect(startsGroup(a1, msg('4', 'bob', 1000))).toBe(true)
    expect(startsGroup(msg('5', 'system', 0, true), msg('6', 'alice', 1000))).toBe(true)
  })

  it("counts others' messages not seen yet, without system lines or our own", () => {
    const list = [msg('1', 'alice', 0), msg('2', 'me', 1), msg('3', 'bob', 2), msg('4', 'x', 3, true)]
    expect(countUnread(list, new Set(['1']), 'me')).toBe(1)
    expect(countUnread(list, new Set(), 'me')).toBe(2)
  })
})

describe('links in chat', () => {
  it('splits http(s) links from the text around them', () => {
    expect(chatParts('see https://example.com/a?b=1 now')).toEqual([
      { text: 'see ' },
      { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { text: ' now' }
    ])
    expect(chatParts('no links here')).toEqual([{ text: 'no links here' }])
    expect(chatParts('')).toEqual([])
  })

  it("leaves out the sentence's punctuation and brackets the link doesn't open", () => {
    expect(chatParts('Look: http://10.0.0.5:8080/x.')).toEqual([
      { text: 'Look: ' },
      { text: 'http://10.0.0.5:8080/x', href: 'http://10.0.0.5:8080/x' },
      { text: '.' }
    ])
    expect(chatParts('(see https://example.com/a)')[1].text).toBe('https://example.com/a')
    expect(chatParts('https://en.wikipedia.org/wiki/Foo_(bar)')[0].text).toBe('https://en.wikipedia.org/wiki/Foo_(bar)')
    expect(chatParts('two: https://a.io, https://b.io!').filter((p) => p.href).map((p) => p.text)).toEqual([
      'https://a.io',
      'https://b.io'
    ])
  })

  it('only ever links http and https', () => {
    for (const text of ['javascript:alert(1)', 'file:///C:/Windows', 'ftp://example.com', 'data:text/html,hi']) {
      expect(chatParts(text)).toEqual([{ text }])
    }
    expect(safeLink('https://example.com')).toBe('https://example.com/')
    expect(safeLink('javascript:alert(1)')).toBeNull()
    expect(safeLink('https://')).toBeNull()
    expect(safeLink(`https://example.com/${'a'.repeat(3000)}`)).toBeNull()
    expect(safeLink(42)).toBeNull()
  })
})

describe('mentions', () => {
  const names = ['Ana', 'Ana Clara', 'Bob', 'Zé']

  it('find @ and a name, the longest that fits, in any case, never inside a word', () => {
    expect(mentionRanges('@ana clara and @BOB, hi', names)).toEqual([
      { start: 0, end: 10, name: 'Ana Clara' },
      { start: 15, end: 19, name: 'Bob' }
    ])
    expect(mentionRanges('mail bob@bob.com or @Bobby', names)).toEqual([])
    expect(mentionRanges('oi @Zé!', names)).toEqual([{ start: 3, end: 6, name: 'Zé' }])
  })

  it('split a message into text, links and mentions', () => {
    expect(chatParts('@Bob see https://a.io @Ana', names)).toEqual([
      { text: '@Bob', mention: 'Bob' },
      { text: ' see ' },
      { text: 'https://a.io', href: 'https://a.io/' },
      { text: ' ' },
      { text: '@Ana', mention: 'Ana' }
    ])
    // A name inside a link isn't a mention.
    expect(chatParts('https://x.io/@Bob', names)).toEqual([{ text: 'https://x.io/@Bob', href: 'https://x.io/@Bob' }])
  })

  it('tell whether a message mentions you', () => {
    expect(mentions('thanks @bob', 'Bob', names)).toBe(true)
    expect(mentions('thanks @Ana Clara', 'Ana', names)).toBe(false)
    expect(mentions('thanks @Ana', 'Ana', names)).toBe(true)
    expect(mentions('thanks Bob', 'Bob', names)).toBe(false)
  })

  it('suggest people while typing @ and complete the name', () => {
    expect(mentionQuery('hi @an', 6)).toEqual({ start: 3, query: 'an' })
    expect(mentionQuery('mail@an', 7)).toBeNull()
    expect(mentionQuery('hi there', 8)).toBeNull()
    expect(suggestNames(names, 'an')).toEqual(['Ana', 'Ana Clara'])
    expect(suggestNames(names, 'cla')).toEqual(['Ana Clara'])
    expect(suggestNames(names, '')).toEqual(names)
    expect(completeMention('hi @an and', 6, 'Ana Clara')).toEqual({ text: 'hi @Ana Clara and', caret: 14 })
  })

  it('shorten a quoted message to one line', () => {
    expect(excerpt('line one\n\nline   two')).toBe('line one line two')
    expect(excerpt('x'.repeat(200), 10)).toBe('xxxxxxxxx…')
  })
})
