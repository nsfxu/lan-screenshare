import { english, type TFunction } from './i18n'
import type { ChatMessage, SystemEvent } from './types'

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

/** A system line in a language (the server writes it in English for apps before 2.4.0). */
export function systemText(event: SystemEvent, t: TFunction = english().t): string {
  switch (event.kind) {
    case 'joined':
      return t('system.joined', { name: event.name })
    case 'left':
      return t('system.left', { name: event.name })
    case 'removed':
      return t('system.removed', { name: event.name })
    case 'started-sharing':
      return t('system.startedSharing', { name: event.name })
    case 'stopped-sharing':
      return t('system.stoppedSharing', { name: event.name })
    case 'stream-stopped':
      return t('system.streamStopped', { name: event.name })
    case 'chat-muted':
      return t('system.chatMuted')
    case 'chat-unmuted':
      return t('system.chatUnmuted')
  }
}

/**
 * What a chat line says: a system line in our language when the room tells us
 * what it's about, its own text otherwise (older rooms, or an event we don't know).
 */
export function chatText(m: ChatMessage, t: TFunction): string {
  const event = m.system ? m.event : undefined
  if (event && typeof event === 'object' && (!('name' in event) || typeof event.name === 'string')) {
    const text = systemText(event, t) as string | undefined
    if (typeof text === 'string') return text
  }
  return m.text
}
