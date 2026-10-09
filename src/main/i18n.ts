import { english, translatorFor, type LanguageId, type TFunction, type Translator } from '../shared/i18n'

/**
 * The language of the text the main process sends to the page (errors, the
 * default room name, update status). index.ts sets it from Settings.
 */
let current: Translator = english()

export function setMainLanguage(language: LanguageId): void {
  current = translatorFor(language)
}

export const mainT: TFunction = (key, ...args) => current.t(key, ...args)
