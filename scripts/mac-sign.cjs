// Signs the macOS app for electron-builder (mac.sign in electron-builder.json).
//
// With MAC_SIGNING_IDENTITY set, the SHA-1 of a certificate in a keychain on the
// search list (the release workflow sets both up from the MAC_CERT_P12 secret;
// scripts/mac-signing-cert.sh makes the certificate), the app is signed with
// that certificate. Without it, ad hoc, as before.
//
// Why: an ad-hoc app's designated requirement is the hash of that exact build,
// so macOS forgets its Screen Recording permission on every update. Signed with
// a certificate, it becomes `identifier "com.screenshare.lan" and certificate
// leaf = <the certificate>`, which every later version signed with it meets.
//
// The certificate is self-signed, which macOS doesn't trust: electron-builder
// only looks for trusted ones and would skip it, but codesign signs with it
// fine when given its hash (electron-builder already turns off osx-sign's own
// trust check with identityValidation: false).
const { signAsync } = require('@electron/osx-sign')

module.exports = async function sign(opts) {
  const identity = (process.env.MAC_SIGNING_IDENTITY || '').trim()
  // electron-builder retries signing (the default sign does too): codesign fails now and then on CI.
  for (let attempt = 1; ; attempt++) {
    try {
      return await signAsync({ ...opts, identity: identity || '-' })
    } catch (err) {
      if (attempt >= 3) throw err
      console.warn(`[mac-sign] attempt ${attempt} failed, retrying: ${err.message}`)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}
