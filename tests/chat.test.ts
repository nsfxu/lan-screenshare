import { describe, expect, it } from 'vitest'
import { CHAT_GROUP_MS, countUnread, startsGroup } from '../src/shared/chat'
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
