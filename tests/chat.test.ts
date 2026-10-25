import { describe, expect, it } from 'vitest'
import { CHAT_GROUP_MS, chatParts, countUnread, safeLink, startsGroup } from '../src/shared/chat'
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
