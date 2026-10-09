import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatBitrate, formatDuration } from '../../src/renderer/lib/format'
import { applyLanguage, setSystemLanguages, systemLanguage, t, translator } from '../../src/renderer/lib/i18n'
import { serverErrorText } from '../../src/renderer/lib/roomClient'

vi.stubGlobal('document', { documentElement: { lang: '' } })

afterEach(() => {
  setSystemLanguages([])
  applyLanguage('en')
})

describe('the page language', () => {
  it('follows the setting, and the computer for "System"', () => {
    setSystemLanguages(['pt-BR', 'en-US'])
    applyLanguage('system')
    expect(translator().language).toBe('pt-BR')
    expect(systemLanguage()).toBe('pt-BR')
    expect(document.documentElement.lang).toBe('pt-BR')
    applyLanguage('en')
    expect(t('common.cancel')).toBe('Cancel')
  })

  it('formats numbers and durations in it', () => {
    applyLanguage('pt-BR')
    expect(formatBitrate(1500)).toBe('1,5 Mbps')
    expect(formatDuration(65_000)).toBe('1 min 5 s')
    applyLanguage('en')
    expect(formatBitrate(1500)).toBe('1.5 Mbps')
    expect(formatDuration(65_000)).toBe('1m 5s')
  })
})

describe('room errors', () => {
  it('are said by their code in our language', () => {
    applyLanguage('pt-BR')
    expect(serverErrorText('room_full', 'Room is full')).toBe('A sala está cheia')
    expect(serverErrorText('chat_muted', 'The host has muted the chat')).toBe('O anfitrião silenciou o chat')
    expect(serverErrorText('not_sharing', 'Alice is not sharing')).toBe('Alice não está compartilhando')
    expect(serverErrorText('bad_request', 'Message too long')).toBe('Mensagem longa demais')
  })

  it("keep the room's text when there is nothing better", () => {
    applyLanguage('pt-BR')
    expect(serverErrorText('bad_request', 'Malformed message')).toBe('Malformed message')
    expect(serverErrorText('version_mismatch', 'This room runs ScreenShare 3.0.0')).toBe('This room runs ScreenShare 3.0.0')
  })
})
