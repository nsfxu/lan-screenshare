import { describe, expect, it } from 'vitest'
import { offscreenWindows, parseNativeWindows, windowName, windowSourceId, type NativeWindow } from '../src/shared/windowList'

const OWN_PID = 100

function win(id: number, app: string, title: string, more: Partial<NativeWindow> = {}): NativeWindow {
  return { id, pid: id * 10, app, title, width: 1470, height: 923, onScreen: false, bundle: `/Applications/${app}.app`, ...more }
}

// Taken from a real Mac: Brave on another desktop, with the helper windows macOS keeps around.
const brave = win(13060, 'Brave Browser', 'GitHub')
const braveTabStrip = win(13059, 'Brave Browser', '', { height: 33 })
const braveTiny = win(13066, 'Brave Browser', '', { width: 64, height: 64 })
const claudeHere = win(14335, 'Claude', 'Claude', { onScreen: true })
const claudeHidden = win(14424, 'Claude', '', { width: 800, height: 600 })
const autofill = win(13074, 'Preencher Automaticamente', '', { width: 312, height: 237 })

describe('windows on other desktops', () => {
  it('keeps titled, full-size windows that are off this desktop', () => {
    const all = [claudeHere, brave, braveTabStrip, braveTiny, claudeHidden, autofill]
    expect(offscreenWindows(all, new Set([windowSourceId(claudeHere.id)]), OWN_PID)).toEqual([brave])
  })

  it('leaves out our own windows and ones Chromium already lists', () => {
    const ours = win(5, 'ScreenShare', 'ScreenShare', { pid: OWN_PID })
    expect(offscreenWindows([ours, brave], new Set(), OWN_PID)).toEqual([brave])
    expect(offscreenWindows([brave], new Set([windowSourceId(brave.id)]), OWN_PID)).toEqual([])
  })

  it('leaves out small windows and untitled ones', () => {
    const small = win(6, 'Notes', 'Note', { width: 99 })
    const blank = win(7, 'Notes', '   ')
    expect(offscreenWindows([small, blank], new Set(), OWN_PID)).toEqual([])
  })

  it('sorts by app, then title', () => {
    const b = win(1, 'Notes', 'B')
    const a = win(2, 'Notes', 'A')
    const code = win(3, 'Code', 'main.ts')
    expect(offscreenWindows([b, brave, a, code], new Set(), OWN_PID).map((w) => w.id)).toEqual([brave.id, code.id, a.id, b.id])
  })
})

describe('window names', () => {
  it('adds the app when the title does not say it', () => {
    expect(windowName({ app: 'Brave Browser', title: 'GitHub' })).toBe('Brave Browser — GitHub')
    expect(windowName({ app: 'Code', title: 'main.ts — Visual Studio Code' })).toBe('main.ts — Visual Studio Code')
    expect(windowName({ app: 'Claude', title: 'claude' })).toBe('claude')
    expect(windowName({ app: 'Notes', title: '' })).toBe('Notes')
  })
})

describe("the helper's output", () => {
  it('keeps well-formed windows only', () => {
    const json = JSON.stringify([brave, { id: 'x' }, null, { ...brave, onScreen: 'no' }])
    expect(parseNativeWindows(json)).toEqual([brave])
    expect(parseNativeWindows('{}')).toEqual([])
    expect(() => parseNativeWindows('not json')).toThrow()
  })
})
