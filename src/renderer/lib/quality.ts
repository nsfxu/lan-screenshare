import type { QualityPreset, WatchQuality } from '../../shared/quality'
import { t } from './i18n'

/** A sending quality's name: "1080p @ 60 fps" says itself in any language, "Native" doesn't. */
export function qualityLabel(preset: QualityPreset): string {
  return preset.id === 'native60' ? t('quality.native60') : preset.label
}

/** A receiving quality's name ("Auto", or a resolution). */
export function watchQualityLabel(quality: WatchQuality): string {
  return quality.id === 'auto' ? t('quality.auto') : quality.label
}
