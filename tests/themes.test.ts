import { describe, expect, it } from 'vitest'
import { followSystem, pickTheme, resolveTheme, THEMES, type ThemeSettings } from '../src/shared/themes'

const fixed: ThemeSettings = { theme: 'midnight', followSystemTheme: false, darkTheme: 'classic', lightTheme: 'light' }
const following: ThemeSettings = { ...fixed, followSystemTheme: true, darkTheme: 'forest', lightTheme: 'paper' }

describe('following the computer', () => {
  it("uses the one theme, or the dark or light one by the computer's mode", () => {
    expect(resolveTheme(fixed, true)).toBe('midnight')
    expect(resolveTheme(fixed, false)).toBe('midnight')
    expect(resolveTheme(following, true)).toBe('forest')
    expect(resolveTheme(following, false)).toBe('paper')
  })

  it('picks the one theme, or the dark or light one by its kind', () => {
    expect(pickTheme(fixed, 'mist')).toEqual({ theme: 'mist' })
    expect(pickTheme(following, 'ember')).toEqual({ darkTheme: 'ember' })
    expect(pickTheme(following, 'mist')).toEqual({ lightTheme: 'mist' })
  })

  it("turns on and off without changing what's on screen", () => {
    expect(followSystem(fixed, true, true)).toEqual({ followSystemTheme: true, darkTheme: 'midnight' })
    expect(followSystem({ ...fixed, theme: 'paper' }, true, false)).toEqual({ followSystemTheme: true, lightTheme: 'paper' })
    expect(followSystem(following, false, false)).toEqual({ followSystemTheme: false, theme: 'paper' })
    expect(followSystem(following, false, true)).toEqual({ followSystemTheme: false, theme: 'forest' })
  })

  it('has a theme of each kind to start with', () => {
    expect(THEMES.find((t) => t.id === fixed.darkTheme)?.kind).toBe('dark')
    expect(THEMES.find((t) => t.id === fixed.lightTheme)?.kind).toBe('light')
  })
})
