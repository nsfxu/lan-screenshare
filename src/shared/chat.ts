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

/** A piece of a chat message: plain text, or a link to open in the browser. */
export type ChatPart = { text: string; href?: string }

const LINK = /\bhttps?:\/\/[^\s<>"'`]+/gi

/**
 * `text` split into plain text and http(s) links, for showing them clickable. Punctuation that
 * ends a sentence isn't part of a link, nor is a closing bracket it doesn't open ("(see https://x.y/a)").
 */
export function chatParts(text: string): ChatPart[] {
  const parts: ChatPart[] = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    let link = match[0]
    for (;;) {
      const end = link.slice(-1)
      const open = { ')': '(', ']': '[', '}': '{' }[end]
      if (/[.,;:!?*]/.test(end) || (open && link.split(open).length <= link.split(end).length - 1)) link = link.slice(0, -1)
      else break
    }
    const href = safeLink(link)
    if (!href) continue
    const start = match.index
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: link, href })
    last = start + link.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/** `url` if it's an http(s) address the browser can open, normalised; null otherwise. */
export function safeLink(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname ? parsed.href : null
  } catch {
    return null
  }
}
