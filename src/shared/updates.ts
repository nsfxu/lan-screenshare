import { RELEASES_URL } from './constants'

/**
 * Whether the Mac app can replace itself. electron-updater installs through
 * Squirrel.Mac, which only accepts a new version that meets the running app's
 * designated requirement: an app signed with a certificate has one that every
 * build signed with it meets (`certificate leaf = H"…"`), while an ad-hoc one
 * names its own hash (`cdhash H"…"`), so no other build ever meets it. The app
 * must also be somewhere it can be replaced: in Applications, not run from the
 * disk image or a quarantined copy (App Translocation).
 *
 * `requirement` is the output of `codesign -dr - <app>`.
 */
export function macCanUpdateItself(requirement: string, inApplications: boolean): boolean {
  return inApplications && /designated => .*\bcertificate leaf\b/.test(requirement)
}

/** A version's page on the releases site, for downloading it by hand. */
export function releasePage(version: string): string {
  return `${RELEASES_URL}/tag/v${encodeURIComponent(version)}`
}
