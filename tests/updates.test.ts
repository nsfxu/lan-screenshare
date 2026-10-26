import { describe, expect, it } from 'vitest'
import { RELEASES_URL } from '../src/shared/constants'
import { macCanUpdateItself, releasePage } from '../src/shared/updates'

// `codesign -dr - ScreenShare.app` on a release built with the certificate, and on an ad-hoc one.
const signed =
  'Executable=/Applications/ScreenShare.app/Contents/MacOS/ScreenShare\n' +
  'designated => identifier "com.nsfxu.screenshare.lan" and certificate leaf = H"3f2a9c0d1e4b5a6978c8d7e6f5a4b3c2d1e0f9a8"\n'
const adHoc =
  'Executable=/Applications/ScreenShare.app/Contents/MacOS/ScreenShare\n' +
  '# designated => cdhash H"9fa91023bab40569489a42ebde6abb8fffd87947"\n'

describe('Mac updates', () => {
  it('updates itself when signed with a certificate and in Applications', () => {
    expect(macCanUpdateItself(signed, true)).toBe(true)
  })

  it('offers the download page for an ad-hoc build, or one outside Applications', () => {
    expect(macCanUpdateItself(adHoc, true)).toBe(false)
    expect(macCanUpdateItself(signed, false)).toBe(false)
    expect(macCanUpdateItself('', true)).toBe(false)
  })

  it("links a version's release page", () => {
    expect(releasePage('2.9.0')).toBe(`${RELEASES_URL}/tag/v2.9.0`)
  })
})
