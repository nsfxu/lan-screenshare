import { en, type Key, type Message, type Messages, type PluralMessage } from './en'
import { ptBR } from './pt-BR'

export type { Key, Message, Messages, PluralMessage }

/**
 * The app's languages. Adding one: a file next to en.ts typed as `Messages`
 * (typecheck lists every missing key), a line here, and its Chromium locale
 * in `electronLanguages` (electron-builder.json). See docs/en-US/development.md.
 */
export const LANGUAGES = [
  { id: 'en', name: 'English', chromium: 'en-US', messages: en },
  { id: 'pt-BR', name: 'Português (Brasil)', chromium: 'pt-BR', messages: ptBR }
] as const satisfies ReadonlyArray<{ id: string; name: string; chromium: string; messages: Messages }>

export type LanguageId = (typeof LANGUAGES)[number]['id']
/** What Settings keeps: a language, or 'system' to follow the computer's. */
export type LanguageSetting = 'system' | LanguageId

export const DEFAULT_LANGUAGE: LanguageId = 'en'

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === 'system' || LANGUAGES.some((l) => l.id === value)
}

/**
 * The language to show: the chosen one, or for 'system' the first of the
 * computer's languages (most preferred first, e.g. "pt-BR", "pt", "en-GB")
 * that we have, by exact tag and then by its base language ("pt-PT" gets
 * pt-BR, "en-GB" gets English). English when none match.
 */
export function resolveLanguage(setting: LanguageSetting, preferred: readonly string[]): LanguageId {
  if (setting !== 'system') return setting
  for (const tag of preferred) {
    const lower = tag.toLowerCase().replace('_', '-')
    const exact = LANGUAGES.find((l) => l.id.toLowerCase() === lower)
    if (exact) return exact.id
    const base = lower.split('-')[0]
    const sameBase = LANGUAGES.find((l) => l.id.toLowerCase().split('-')[0] === base)
    if (sameBase) return sameBase.id
  }
  return DEFAULT_LANGUAGE
}

// --- Typed keys and placeholders ---------------------------------------------

/** The `{name}`s in a message. */
type Placeholders<S> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never
type ParamsOf<M> = M extends string
  ? Placeholders<M>
  : M extends PluralMessage
    ? 'count' | Placeholders<M[keyof M]>
    : never
type Param = string | number
/** A key's placeholders, required when it has any (checked against en.ts). */
export type Args<K extends Key> = [ParamsOf<(typeof en)[K]>] extends [never]
  ? []
  : [params: Record<ParamsOf<(typeof en)[K]>, Param>]

export type TFunction = <K extends Key>(key: K, ...args: Args<K>) => string

const PLACEHOLDER = /\{(\w+)\}/g

/** The placeholder names a message uses (all its plural forms), sorted; for tests. */
export function placeholdersOf(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message)
  const names = new Set<string>()
  for (const text of texts) for (const m of text.matchAll(PLACEHOLDER)) names.add(m[1])
  if (typeof message !== 'string') names.add('count')
  return [...names].sort()
}

export interface Translator {
  readonly language: LanguageId
  /** A message with its placeholders filled in. */
  t: TFunction
  /**
   * The same, as pieces: text and the values given for its placeholders, as
   * they are (React elements, for a name in bold or a link inside a sentence).
   */
  parts<K extends Key>(key: K, params: Record<string, unknown>): unknown[]
  /** A number the language's way (Portuguese: decimal comma); `digits` after the point, at most. */
  number(n: number, digits?: number): string
  /** A time of day, hours and minutes. */
  time(ts: number): string
}

export function createTranslator(language: LanguageId): Translator {
  const entry = LANGUAGES.find((l) => l.id === language) ?? LANGUAGES[0]
  const messages: Messages = entry.messages
  const plurals = new Intl.PluralRules(entry.id)
  const numberFormats = new Map<number, Intl.NumberFormat>()
  const number = (n: number, digits = 2): string => {
    let format = numberFormats.get(digits)
    if (!format) {
      // No thousands separators: they'd turn a port or a year into "47.800".
      format = new Intl.NumberFormat(entry.id, { maximumFractionDigits: digits, useGrouping: false })
      numberFormats.set(digits, format)
    }
    return format.format(n)
  }
  const timeFormat = new Intl.DateTimeFormat(entry.id, { hour: '2-digit', minute: '2-digit' })

  /** The template for a key: its plural form for `count`; English if this language lacks it. */
  const template = (key: Key, params: Record<string, unknown> | undefined): string => {
    const message: Message | undefined = messages[key] ?? (en as Messages)[key]
    if (message === undefined) return key
    if (typeof message === 'string') return message
    const count = Number(params?.count ?? 0)
    return message[plurals.select(count)] ?? message.other
  }
  const show = (value: unknown): unknown => (typeof value === 'number' ? number(value) : value)

  const parts = (key: Key, params: Record<string, unknown>): unknown[] => {
    const out: unknown[] = []
    let last = 0
    const text = template(key, params)
    for (const m of text.matchAll(PLACEHOLDER)) {
      if (m.index > last) out.push(text.slice(last, m.index))
      out.push(m[1] in params ? show(params[m[1]]) : m[0])
      last = m.index + m[0].length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }

  const t = ((key: Key, params?: Record<string, Param>) => {
    const text = template(key, params)
    if (!params) return text
    return text.replace(PLACEHOLDER, (whole, name: string) => (name in params ? String(show(params[name])) : whole))
  }) as TFunction

  return { language: entry.id, t, parts, number, time: (ts) => timeFormat.format(ts) }
}

const translators = new Map<LanguageId, Translator>()

/** The translator for a language, made once. */
export function translatorFor(language: LanguageId): Translator {
  let found = translators.get(language)
  if (!found) {
    found = createTranslator(language)
    translators.set(language, found)
  }
  return found
}

/** English: what the room server writes for older apps, and the default for shared helpers. */
export const english = (): Translator => translatorFor('en')
