import { describe, expect, it } from 'vitest'
import { audioUnavailableMessage, captureAudioWarning } from '../../src/renderer/lib/format'
import { t } from '../../src/renderer/lib/i18n'
import type { AudioChoice } from '../../src/shared/types'

const asked: AudioChoice = { enabled: true, excludeDiscord: true, appOnly: true }
const fine = { hasAudio: true, audioError: null, appAudioFailed: false, discordExclusionFailed: false }

describe('captureAudioWarning', () => {
  it('says nothing when the sound is what was chosen, or no sound was asked for', () => {
    expect(captureAudioWarning(fine, asked)).toBeNull()
    expect(captureAudioWarning({ ...fine, hasAudio: false }, { ...asked, enabled: false })).toBeNull()
  })

  it('explains the most important problem first', () => {
    expect(captureAudioWarning({ ...fine, hasAudio: false, audioError: 'NotAllowedError' }, asked)).toBe(
      audioUnavailableMessage('NotAllowedError')
    )
    // Only the app's sound wasn't possible: everything is shared (whether or not Discord could be left out).
    expect(captureAudioWarning({ ...fine, appAudioFailed: true, discordExclusionFailed: true }, asked)).toBe(
      t('audio.appFailed')
    )
    expect(captureAudioWarning({ ...fine, discordExclusionFailed: true }, asked)).toBe(t('audio.discordNotExcluded'))
  })
})
