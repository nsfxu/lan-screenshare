import { APP_NAME } from './constants'

/** An app version as rooms and participants report it: SemVer, e.g. "1.2.0" or "2.0.0-beta.1". */
const APP_VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,32}))?$/

export function isAppVersion(value: unknown): value is string {
  return typeof value === 'string' && APP_VERSION_RE.test(value)
}

/**
 * Orders two app versions (negative: a is older). Pre-releases sort before
 * their release; two pre-releases compare as plain strings, which is enough
 * to tell "older or newer" apart in a message.
 */
export function compareAppVersions(a: string, b: string): number {
  const pa = APP_VERSION_RE.exec(a)
  const pb = APP_VERSION_RE.exec(b)
  if (!pa || !pb) return 0
  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i])
    if (diff) return diff
  }
  if (pa[4] === pb[4]) return 0
  if (!pa[4]) return 1
  if (!pb[4]) return -1
  return pa[4] < pb[4] ? -1 : 1
}

export interface VersionSide {
  protocol: number
  /** Unknown for rooms and apps older than 1.2.0, which don't report it. */
  appVersion?: string
}

/**
 * What to tell someone whose app can't join a room (different protocol), or
 * null when they can. Which side has to update follows from the protocol
 * numbers, which only ever go up.
 */
export function incompatibleRoomMessage(room: VersionSide, ours: VersionSide): string | null {
  if (!room.protocol || room.protocol === ours.protocol) return null
  const theirs = isAppVersion(room.appVersion) ? `${APP_NAME} ${room.appVersion}` : null
  const mine = isAppVersion(ours.appVersion) ? `, you have ${ours.appVersion}` : ''
  if (room.protocol > ours.protocol) {
    return `This room runs ${theirs ?? `a newer ${APP_NAME}`}${mine}: update to join`
  }
  return `This room runs ${theirs ?? `an older ${APP_NAME}`}${mine}: the host needs to update`
}

/** The newest app version among `others` that is newer than ours, with who runs it. */
export function newerVersionInRoom(
  ours: string,
  others: ReadonlyArray<{ name: string; appVersion?: string }>
): { name: string; appVersion: string } | null {
  let best: { name: string; appVersion: string } | null = null
  for (const p of others) {
    if (!isAppVersion(p.appVersion) || compareAppVersions(p.appVersion, ours) <= 0) continue
    if (!best || compareAppVersions(p.appVersion, best.appVersion) > 0) best = { name: p.name, appVersion: p.appVersion }
  }
  return best
}
