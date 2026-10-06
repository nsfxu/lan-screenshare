import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, SETTINGS_VERSION, SettingsStore } from '../src/main/settings'

const dirs: string[] = []
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshare-settings-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('settings', () => {
  it('starts new installs on automatic content hint', () => {
    const store = new SettingsStore(tempDir())
    expect(store.get().contentHint).toBe('auto')
    expect(store.get().settingsVersion).toBe(SETTINGS_VERSION)
  })

  it('moves the old "motion" default to automatic, once, and keeps real choices', () => {
    expect(migrate({ contentHint: 'motion' }).contentHint).toBe('auto')
    expect(migrate({ contentHint: 'detail' }).contentHint).toBe('detail')
    // Chosen after the upgrade: kept.
    expect(migrate({ contentHint: 'motion', settingsVersion: 2 }).contentHint).toBe('motion')
  })

  it('upgrades a settings file written by 1.1', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ displayName: 'Giu', contentHint: 'motion' }))
    const store = new SettingsStore(dir)
    expect(store.get()).toMatchObject({ displayName: 'Giu', contentHint: 'auto', settingsVersion: SETTINGS_VERSION })
    // Saved, so choosing "motion" later sticks.
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).settingsVersion).toBe(SETTINGS_VERSION)
    store.update({ contentHint: 'motion' })
    expect(new SettingsStore(dir).get().contentHint).toBe('motion')
  })

  it('starts the recent rooms with the last room, and keeps only valid ones', () => {
    const last = { address: '10.0.0.5', port: 47800, tls: true, name: 'Game night' }
    expect(migrate({ lastRoom: last, settingsVersion: 2 }).recentRooms).toEqual([last])
    expect(migrate({ lastRoom: null, settingsVersion: 2 }).recentRooms).toBeUndefined()
    const store = new SettingsStore(tempDir())
    const many = Array.from({ length: 8 }, (_, i) => ({ address: `10.0.0.${i}`, port: 1, tls: false }))
    expect(store.update({ recentRooms: [...many, { address: 5 } as never] }).recentRooms).toHaveLength(5)
  })

  it('starts on Classic, and ignores unknown themes', () => {
    const store = new SettingsStore(tempDir())
    expect(store.get().theme).toBe('classic')
    expect(store.update({ theme: 'graphite' }).theme).toBe('graphite')
    expect(store.update({ theme: 'neon' as never }).theme).toBe('graphite')
  })

  it('rejects unknown content hints', () => {
    const store = new SettingsStore(tempDir())
    expect(store.update({ contentHint: 'fast' as never }).contentHint).toBe('auto')
  })
})
