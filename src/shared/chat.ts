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

/** A piece of a chat message: plain text, a link to open in the browser, or someone mentioned (@Name). */
export type ChatPart = { text: string; href?: string; mention?: string }

const LINK = /\bhttps?:\/\/[^\s<>"'`]+/gi

/**
 * `text` split into plain text, http(s) links, for showing them clickable, and mentions of `names`
 * (see mentionRanges). Punctuation that ends a sentence isn't part of a link, nor is a closing
 * bracket it doesn't open ("(see https://x.y/a)").
 */
export function chatParts(text: string, names: readonly string[] = []): ChatPart[] {
  return linkParts(text).flatMap((part) => (part.href ? [part] : mentionParts(part.text, names)))
}

function mentionParts(text: string, names: readonly string[]): ChatPart[] {
  const parts: ChatPart[] = []
  let last = 0
  for (const { start, end, name } of mentionRanges(text, names)) {
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: text.slice(start, end), mention: name })
    last = end
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

function linkParts(text: string): ChatPart[] {
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

/** A letter or digit: a mention can't start right after one (an e-mail address) nor end before one. */
const WORD = /[\p{L}\p{N}_]/u

/**
 * Where `text` mentions someone: "@" and one of `names` (any case), not inside a word. Names can have
 * spaces ("@Ana Clara"), so the longest name that fits wins.
 */
export function mentionRanges(text: string, names: readonly string[]): { start: number; end: number; name: string }[] {
  const byLength = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  const found: { start: number; end: number; name: string }[] = []
  for (let i = text.indexOf('@'); i >= 0; i = text.indexOf('@', i + 1)) {
    if (i > 0 && WORD.test(text[i - 1])) continue
    const rest = text.slice(i + 1).toLocaleLowerCase()
    const name = byLength.find((n) => rest.startsWith(n.toLocaleLowerCase()) && !WORD.test(text[i + 1 + n.length] ?? ''))
    if (!name) continue
    found.push({ start: i, end: i + 1 + name.length, name })
    i += name.length
  }
  return found
}

/** Whether `text` mentions `name`, among the `names` of the people around. */
export function mentions(text: string, name: string, names: readonly string[]): boolean {
  const lower = name.trim().toLocaleLowerCase()
  return !!lower && mentionRanges(text, [...names, name]).some((r) => r.name.toLocaleLowerCase() === lower)
}

/** The "@…" being typed just before the caret, if any: where it starts and what's typed after the @. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null
  const query = before.slice(at + 1)
  if (query.length > 32 || /[@\n]/.test(query) || /\s\s/.test(query)) return null
  return { start: at, query }
}

/** People whose name starts (or has a word starting) with what's typed after the @, at most `max`. */
export function suggestNames(names: readonly string[], query: string, max = 6): string[] {
  const q = query.toLocaleLowerCase()
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const starts = unique.filter((n) => n.toLocaleLowerCase().startsWith(q))
  const words = unique.filter((n) => !starts.includes(n) && n.toLocaleLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
  return [...starts, ...words].slice(0, max)
}

/** `text` with the "@…" being typed (see mentionQuery) replaced by "@name ", and where the caret goes. */
export function completeMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const q = mentionQuery(text, caret)
  if (!q) return { text, caret }
  const inserted = `@${name} `
  return { text: text.slice(0, q.start) + inserted + text.slice(caret).replace(/^ /, ''), caret: q.start + inserted.length }
}

/** A message shortened to one line, for quoting it above a reply. */
export function excerpt(text: string, max = 120): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}
