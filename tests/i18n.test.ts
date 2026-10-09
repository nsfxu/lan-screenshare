import { describe, expect, it } from 'vitest'
import { systemText, chatText } from '../src/shared/chat'
import {
  createTranslator,
  isLanguageSetting,
  LANGUAGES,
  placeholdersOf,
  resolveLanguage,
  type Key,
  type Message
} from '../src/shared/i18n'
import { en } from '../src/shared/i18n/en'
import type { ChatMessage } from '../src/shared/types'

const keys = Object.keys(en) as Key[]

describe('languages', () => {
  it.each(LANGUAGES.map((l) => [l.id, l.messages] as const))('%s has every key, and only those', (_id, messages) => {
    expect(Object.keys(messages).sort()).toEqual([...keys].sort())
  })

  it.each(LANGUAGES.map((l) => [l.id, l.messages] as const))(
    '%s uses the same placeholders as English, and plural forms where English has them',
    (_id, messages) => {
      const all = messages as Record<Key, Message>
      for (const key of keys) {
        const message = all[key]
        expect([key, placeholdersOf(message)]).toEqual([key, placeholdersOf(en[key])])
        expect([key, typeof message]).toEqual([key, typeof en[key]])
        if (typeof message !== 'string') expect(message.other, key).toBeTruthy()
        // Every form says something.
        for (const text of typeof message === 'string' ? [message] : Object.values(message)) expect(text.trim(), key).not.toBe('')
      }
    }
  )

  it('names each language in its own words, once', () => {
    expect(new Set(LANGUAGES.map((l) => l.id)).size).toBe(LANGUAGES.length)
    expect(LANGUAGES.find((l) => l.id === 'pt-BR')?.name).toBe('Português (Brasil)')
  })
})

describe('resolveLanguage', () => {
  it('keeps a chosen language', () => {
    expect(resolveLanguage('pt-BR', ['en-US'])).toBe('pt-BR')
    expect(resolveLanguage('en', ['pt-BR'])).toBe('en')
  })

  it('follows the computer: exact tag, then the same base language, then English', () => {
    expect(resolveLanguage('system', ['pt-BR', 'en-US'])).toBe('pt-BR')
    expect(resolveLanguage('system', ['pt-PT'])).toBe('pt-BR')
    expect(resolveLanguage('system', ['pt'])).toBe('pt-BR')
    expect(resolveLanguage('system', ['en-GB', 'pt-BR'])).toBe('en')
    expect(resolveLanguage('system', ['de-DE', 'pt_BR'])).toBe('pt-BR')
    expect(resolveLanguage('system', ['ja-JP'])).toBe('en')
    expect(resolveLanguage('system', [])).toBe('en')
  })

  it('accepts only known settings', () => {
    expect(isLanguageSetting('system')).toBe(true)
    expect(isLanguageSetting('pt-BR')).toBe(true)
    expect(isLanguageSetting('pt')).toBe(false)
    expect(isLanguageSetting(undefined)).toBe(false)
  })
})

describe('translator', () => {
  const english = createTranslator('en')
  const portuguese = createTranslator('pt-BR')

  it('fills in placeholders', () => {
    expect(english.t('room.pausedBy', { name: 'Alice' })).toBe('Paused by Alice')
    expect(portuguese.t('room.pausedBy', { name: 'Alice' })).toBe('Pausado por Alice')
    // A name that looks like a placeholder stays as it is.
    expect(english.t('system.joined', { name: '{name}' })).toBe('{name} joined')
  })

  it("picks the plural form by the language's rules", () => {
    expect(english.t('app.attemptsLeft', { count: 1 })).toBe('1 attempt left.')
    expect(english.t('app.attemptsLeft', { count: 2 })).toBe('2 attempts left.')
    expect(portuguese.t('app.attemptsLeft', { count: 1 })).toBe('Resta 1 tentativa.')
    expect(portuguese.t('app.attemptsLeft', { count: 2 })).toBe('Restam 2 tentativas.')
  })

  it('writes numbers the language’s way, without thousands separators', () => {
    expect(english.number(1.5, 1)).toBe('1.5')
    expect(portuguese.number(1.5, 1)).toBe('1,5')
    expect(portuguese.number(47800)).toBe('47800')
    expect(portuguese.t('common.mbps', { value: 2.5 })).toBe('2,5 Mbps')
  })

  it('gives the pieces of a message, with values as they are', () => {
    const bold = { bold: 'Alice' }
    expect(english.parts('room.pausedBy', { name: bold })).toEqual(['Paused by ', bold])
    expect(portuguese.parts('system.joined', { name: bold })).toEqual([bold, ' entrou'])
  })
})

describe('system lines in the chat', () => {
  const line = (event: unknown, text = 'Alice joined'): ChatMessage =>
    ({ id: '1', userId: 'system', name: 'System', color: '#888888', text, ts: 0, system: true, event }) as ChatMessage

  it('are written in English for older apps', () => {
    expect(systemText({ kind: 'started-sharing', name: 'Alice' })).toBe('Alice started sharing their screen')
    expect(systemText({ kind: 'chat-muted' })).toBe('The host muted the chat')
  })

  it("are shown in the reader's language", () => {
    const pt = createTranslator('pt-BR').t
    expect(chatText(line({ kind: 'joined', name: 'Alice' }), pt)).toBe('Alice entrou')
    expect(chatText(line({ kind: 'chat-unmuted' }), pt)).toBe('O anfitrião liberou o chat')
  })

  it('keep their own text when the room says nothing more, or something we don’t know', () => {
    const pt = createTranslator('pt-BR').t
    expect(chatText(line(undefined), pt)).toBe('Alice joined')
    expect(chatText(line({ kind: 'danced', name: 'Alice' }), pt)).toBe('Alice joined')
    expect(chatText(line({ kind: 'joined', name: 42 }), pt)).toBe('Alice joined')
    // Only system lines: someone's message is never replaced.
    expect(chatText({ ...line({ kind: 'joined', name: 'Alice' }), system: false, text: 'hi' }, pt)).toBe('hi')
  })
})
