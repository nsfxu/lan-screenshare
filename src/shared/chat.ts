import type { ChatMessage } from './types'

/** Messages from the same person within this long are shown under one name and picture. */
export const CHAT_GROUP_MS = 5 * 60_000

/** Whether `m` starts a new group: someone else wrote before it, time passed, or a system line came between. */
export function startsGroup(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  return !prev || prev.system || m.system || prev.userId !== m.userId || m.ts - prev.ts >= CHAT_GROUP_MS
}

/** Messages from others we haven't seen (system lines don't count). */
export function countUnread(messages: readonly ChatMessage[], seen: ReadonlySet<string>, selfId: string): number {
  return messages.filter((m) => !m.system && m.userId !== selfId && !seen.has(m.id)).length
}
