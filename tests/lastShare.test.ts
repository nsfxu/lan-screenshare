import { describe, expect, it } from 'vitest'
import { findLastSource, lastShareOf, parseLastShare } from '../src/shared/lastShare'
import type { AudioChoice, CaptureSource } from '../src/shared/types'

const audio: AudioChoice = { enabled: true, excludeDiscord: true, appOnly: false }

function source(id: string, name: string, kind: 'screen' | 'window', displayId = ''): CaptureSource {
  return { id, name, kind, displayId, thumbnail: '' }
}

const screen1 = source('screen:1:0', 'Screen 1', 'screen', '101')
const screen2 = source('screen:2:0', 'Screen 2', 'screen', '102')
const game = source('window:4242:0', 'Some Game', 'window')

describe('Share again: finding the last source', () => {
  it('finds the same source by id', () => {
    expect(findLastSource(lastShareOf(game, audio), [screen1, game])).toBe(game)
    expect(findLastSource(lastShareOf(screen2, audio), [screen1, screen2])).toBe(screen2)
  })

  it('finds a reopened window by its title (its id changed)', () => {
    const reopened = source('window:9001:0', 'Some Game', 'window')
    expect(findLastSource(lastShareOf(game, audio), [screen1, reopened])).toBe(reopened)
  })

  it('finds a screen by its display when its id changed', () => {
    const renamed = source('screen:7:0', 'Entire screen', 'screen', '102')
    expect(findLastSource(lastShareOf(screen2, audio), [screen1, renamed])).toBe(renamed)
  })

  it("gives up when it's gone, or when several windows have the title", () => {
    expect(findLastSource(lastShareOf(game, audio), [screen1, screen2])).toBeNull()
    const twins = [source('window:1:0', 'Some Game', 'window'), source('window:2:0', 'Some Game', 'window')]
    expect(findLastSource(lastShareOf(game, audio), twins)).toBeNull()
  })

  it("doesn't mistake a window for a screen of the same name", () => {
    const window = source('window:5:0', 'Screen 1', 'window')
    expect(findLastSource(lastShareOf(screen1, audio), [window])).toBeNull()
  })
})

describe('Share again: what is saved', () => {
  it('reads back what it saved, with the sound options', () => {
    const saved = JSON.parse(JSON.stringify(lastShareOf(game, audio)))
    expect(parseLastShare(saved)).toEqual({
      source: { id: 'window:4242:0', name: 'Some Game', kind: 'window', displayId: '' },
      audio
    })
  })

  it('ignores anything else in storage', () => {
    for (const raw of [null, 'x', 1, {}, { source: {}, audio }, { source: { ...lastShareOf(game, audio).source, kind: 'tab' }, audio }]) {
      expect(parseLastShare(raw)).toBeNull()
    }
    expect(parseLastShare({ source: lastShareOf(game, audio).source, audio: { enabled: 'yes' } })).toBeNull()
  })

  it('keeps very long window titles short', () => {
    const long = source('window:1:0', 'x'.repeat(5000), 'window')
    expect(lastShareOf(long, audio).source.name.length).toBe(300)
  })
})
