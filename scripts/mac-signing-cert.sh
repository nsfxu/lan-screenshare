#!/bin/sh
# Makes the self-signed certificate that signs the macOS app, once. Run it on a
# Mac and keep what it makes safe: every release must be signed with the same
# certificate, or macOS forgets ScreenShare's Screen Recording permission again.
# See docs/en-US/development.md#the-macos-signing-certificate.
#
#   sh scripts/mac-signing-cert.sh <folder outside the repository>
#
# It writes there:
#   screenshare-signing.p12   the certificate and its private key (back it up offline)
#   p12-password.txt          the .p12's password
#   p12-base64.txt            the .p12 as base64, for the MAC_CERT_P12 secret
# and prints the commands that add the two GitHub secrets.
set -eu

out=${1:?usage: sh scripts/mac-signing-cert.sh <folder outside the repository>}
mkdir -p "$out"
out=$(cd "$out" && pwd)
case "$out" in "$(git rev-parse --show-toplevel 2>/dev/null || echo /nonexistent)"*)
  echo "Choose a folder outside the repository: the private key must never be committed." >&2
  exit 1
esac
[ -e "$out/screenshare-signing.p12" ] && { echo "$out/screenshare-signing.p12 exists already: keep using it." >&2; exit 1; }

# macOS's own LibreSSL: `security import` reads its .p12 files on every macOS version.
openssl=/usr/bin/openssl
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077

cat > "$work/cert.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = ScreenShare Self-Signed
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF

# 20 years, so it never needs replacing (a new certificate means everyone allows the app again).
"$openssl" req -x509 -newkey rsa:3072 -nodes -days 7300 -config "$work/cert.cnf" \
  -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
"$openssl" rand -hex 24 > "$out/p12-password.txt"
"$openssl" pkcs12 -export -name "ScreenShare Self-Signed" -inkey "$work/key.pem" -in "$work/cert.pem" \
  -passout "file:$out/p12-password.txt" -out "$out/screenshare-signing.p12"
base64 < "$out/screenshare-signing.p12" | tr -d '\n' > "$out/p12-base64.txt"

fingerprint=$("$openssl" x509 -in "$work/cert.pem" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')
cat <<EOF
Made $out/screenshare-signing.p12 (certificate SHA-1 $fingerprint).

Add the GitHub secrets (Settings → Secrets and variables → Actions, or):
  gh secret set MAC_CERT_P12 --repo nsfxu/lan-screenshare < "$out/p12-base64.txt"
  gh secret set MAC_CERT_PASSWORD --repo nsfxu/lan-screenshare < "$out/p12-password.txt"

Then back up screenshare-signing.p12 and p12-password.txt somewhere safe and offline
(a password manager works), and delete this folder. Losing them means one more
"allow again" for every Mac user; leaking them lets anyone sign an app that macOS
treats as ScreenShare.
EOF
