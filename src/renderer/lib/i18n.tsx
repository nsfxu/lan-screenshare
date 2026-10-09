import { Fragment, useSyncExternalStore, type ReactNode } from 'react'
import {
  english,
  resolveLanguage,
  translatorFor,
  type Key,
  type LanguageSetting,
  type TFunction,
  type Translator
} from '../../shared/i18n'

/**
 * The page's language: set from Settings (and the computer's languages for
 * "System"), read by components with useT() and by other code with t().
 */
let current: Translator = english()
let systemLanguages: readonly string[] = []
const listeners = new Set<() => void>()

/** The computer's languages (from the main process), most preferred first. */
export function setSystemLanguages(languages: readonly string[]): void {
  systemLanguages = languages
}

/** Show the app in `setting`'s language from now on. */
export function applyLanguage(setting: LanguageSetting): void {
  const next = translatorFor(resolveLanguage(setting, systemLanguages))
  document.documentElement.lang = next.language
  if (next === current) return
  current = next
  listeners.forEach((cb) => cb())
}

/** What 'System' means on this computer: the language it resolves to. */
export function systemLanguage(): Translator['language'] {
  return resolveLanguage('system', systemLanguages)
}

/** The current translator, for code outside components (it changes when the language does). */
export function translator(): Translator {
  return current
}

/** A message in the current language (outside components; they use useT). */
export const t: TFunction = (key, ...args) => current.t(key, ...args)

export interface UseT extends Translator {
  /** A message with React elements in it, e.g. a name in bold: rich('room.pausedBy', { name: <strong>…</strong> }). */
  rich(key: Key, params: Record<string, ReactNode>): ReactNode
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** The current language's translator; the component re-renders when it changes. */
export function useT(): UseT {
  const tr = useSyncExternalStore(subscribe, () => current)
  return {
    ...tr,
    rich: (key, params) => tr.parts(key, params).map((part, i) => <Fragment key={i}>{part as ReactNode}</Fragment>)
  }
}
