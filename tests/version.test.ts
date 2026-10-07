import { describe, expect, it } from 'vitest'
import { compareAppVersions, incompatibleRoomMessage, isAppVersion, newerRelease, newerVersionInRoom } from '../src/shared/version'

describe('app versions', () => {
  it('accepts SemVer releases and pre-releases only', () => {
    expect(isAppVersion('1.2.0')).toBe(true)
    expect(isAppVersion('2.0.0-beta.1')).toBe(true)
    expect(isAppVersion('1.2')).toBe(false)
    expect(isAppVersion('1.2.0 <b>')).toBe(false)
    expect(isAppVersion(120)).toBe(false)
    expect(isAppVersion(undefined)).toBe(false)
  })

  it('orders versions numerically, pre-releases before their release', () => {
    expect(compareAppVersions('1.10.0', '1.9.3')).toBeGreaterThan(0)
    expect(compareAppVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareAppVersions('2.0.0-beta.1', '2.0.0')).toBeLessThan(0)
    expect(compareAppVersions('2.0.0-beta.1', '1.9.0')).toBeGreaterThan(0)
  })

  it('says who has to update when protocols differ', () => {
    const ours = { protocol: 4, appVersion: '1.2.0' }
    expect(incompatibleRoomMessage({ protocol: 4, appVersion: '1.3.0' }, ours)).toBeNull()
    expect(incompatibleRoomMessage({ protocol: 5, appVersion: '2.0.0' }, ours)).toBe(
      'This room runs ScreenShare 2.0.0, you have 1.2.0: update to join'
    )
    expect(incompatibleRoomMessage({ protocol: 3 }, ours)).toBe(
      'This room runs an older ScreenShare, you have 1.2.0: the host needs to update'
    )
    expect(incompatibleRoomMessage({ protocol: 5, appVersion: 'nonsense' }, { protocol: 4 })).toBe(
      'This room runs a newer ScreenShare: update to join'
    )
    // Rooms not probed yet (placeholders) report protocol 0.
    expect(incompatibleRoomMessage({ protocol: 0 }, ours)).toBeNull()
  })

  it('finds the newest version in the room that is newer than ours', () => {
    const people = [
      { name: 'Old', appVersion: '1.1.0' },
      { name: 'Unknown' },
      { name: 'Bob', appVersion: '1.3.0' },
      { name: 'Carol', appVersion: '1.4.1' }
    ]
    expect(newerVersionInRoom('1.2.0', people)).toEqual({ name: 'Carol', appVersion: '1.4.1' })
    expect(newerVersionInRoom('1.5.0', people)).toBeNull()
  })
})

describe('newerRelease', () => {
  it('offers a release tag only when it is newer than the running app', () => {
    expect(newerRelease('v2.2.0', '2.1.0')).toBe('2.2.0')
    expect(newerRelease('2.1.1', '2.1.0')).toBe('2.1.1')
    expect(newerRelease('v2.1.0', '2.1.0')).toBeNull()
    expect(newerRelease('v2.0.0', '2.1.0')).toBeNull()
    expect(newerRelease('v3.0.0-beta.1', '2.1.0')).toBe('3.0.0-beta.1')
  })

  it('ignores anything that is not a version', () => {
    expect(newerRelease('nightly', '2.1.0')).toBeNull()
    expect(newerRelease(undefined, '2.1.0')).toBeNull()
    expect(newerRelease('v9.0.0', 'dev')).toBeNull()
  })
})
