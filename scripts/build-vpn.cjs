// Builds the VPN helper (native/ssvpn, Go) into native/bin/<platform>-<arch>/, so VPN
// rooms work without the user installing anything. On Windows the folder also gets
// wintun.dll, the driver library the helper loads (downloaded once, checked against
// a pinned SHA-256).
//
//   node scripts/build-vpn.cjs            this computer's platform only (dev, build)
//   node scripts/build-vpn.cjs --all      every platform we ship (installers)
//   node scripts/build-vpn.cjs --require  fail instead of warning when Go is missing (releases)
//
// Without Go the app still builds and runs; VPN rooms then say the helper is missing.
const { execFileSync, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const zlib = require('node:zlib')

const root = path.join(__dirname, '..')
const source = path.join(root, 'native', 'ssvpn')
const outRoot = path.join(root, 'native', 'bin')
const cache = path.join(root, 'native', '.cache')

const WINTUN_VERSION = '0.14.1'
const WINTUN_URL = `https://www.wintun.net/builds/wintun-${WINTUN_VERSION}.zip`
const WINTUN_SHA256 = '07c256185d6ee3652e09fa55c0b673e2624b565e02c4b9091c79ca7d2f24ef51'

/** Node's platform/arch -> Go's. */
const GO_OS = { darwin: 'darwin', linux: 'linux', win32: 'windows' }
const GO_ARCH = { x64: 'amd64', arm64: 'arm64' }
const ALL = [
  ['darwin', 'arm64'],
  ['darwin', 'x64'],
  ['linux', 'x64'],
  ['linux', 'arm64'],
  ['win32', 'x64'],
  ['win32', 'arm64']
]

const args = process.argv.slice(2)
const required = args.includes('--require')
const targets = args.includes('--all') ? ALL : [[process.platform, process.arch]]

const hasGo = spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0
if (!hasGo) {
  const message = '[vpn] Go was not found: VPN rooms will be unavailable (install Go from https://go.dev/dl/ to build the helper)'
  if (required) {
    console.error(message)
    process.exit(1)
  }
  console.warn(message)
  process.exit(0)
}

main().catch((err) => {
  console.error(`[vpn] ${err.message}`)
  process.exit(1)
})

async function main() {
  for (const [platform, arch] of targets) {
    if (!GO_OS[platform] || !GO_ARCH[arch]) {
      console.warn(`[vpn] no VPN helper for ${platform}/${arch}`)
      continue
    }
    buildHelper(platform, arch)
    if (platform === 'win32') await placeWintun(arch)
    writeChecksums(platform, arch)
  }
}

function newestSource() {
  return fs
    .readdirSync(source)
    .filter((f) => f.endsWith('.go') || f === 'go.mod' || f === 'go.sum')
    .reduce((newest, f) => Math.max(newest, fs.statSync(path.join(source, f)).mtimeMs), 0)
}

function buildHelper(platform, arch) {
  const dir = path.join(outRoot, `${platform}-${arch}`)
  const output = path.join(dir, platform === 'win32' ? 'ssvpn.exe' : 'ssvpn')
  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= newestSource()) return
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', output, '.'], {
    cwd: source,
    stdio: 'inherit',
    env: { ...process.env, GOOS: GO_OS[platform], GOARCH: GO_ARCH[arch], CGO_ENABLED: '0' }
  })
  console.log(`[vpn] built ${path.relative(root, output)}`)
}

/**
 * The app checks these before it asks for the administrator password, so a helper
 * that was swapped after installing is never started with those rights.
 */
function writeChecksums(platform, arch) {
  const dir = path.join(outRoot, `${platform}-${arch}`)
  const files = platform === 'win32' ? ['ssvpn.exe', 'wintun.dll'] : ['ssvpn']
  const sums = Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(dir, f)))]))
  fs.writeFileSync(path.join(dir, 'vpn-helper.json'), JSON.stringify(sums, null, 2))
}

async function placeWintun(arch) {
  const target = path.join(outRoot, `win32-${arch}`, 'wintun.dll')
  if (fs.existsSync(target)) return
  const zip = await downloadWintun()
  fs.writeFileSync(target, extractFromZip(zip, `wintun/bin/${GO_ARCH[arch]}/wintun.dll`))
  console.log(`[vpn] placed ${path.relative(root, target)} (Wintun ${WINTUN_VERSION})`)
}

async function downloadWintun() {
  const file = path.join(cache, `wintun-${WINTUN_VERSION}.zip`)
  let data = fs.existsSync(file) ? fs.readFileSync(file) : null
  if (!data || sha256(data) !== WINTUN_SHA256) {
    data = await download(WINTUN_URL)
    if (sha256(data) !== WINTUN_SHA256) throw new Error(`the Wintun download does not match its pinned checksum (${sha256(data)})`)
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(file, data)
  }
  return data
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function download(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume()
          return resolve(download(new URL(res.headers.location, url).toString(), redirects - 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`${url}: HTTP ${res.statusCode}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      .on('error', reject)
  })
}

/** Reads one file out of a zip (stored or deflated), using the central directory. */
function extractFromZip(zip, name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('not a zip file')
  let offset = zip.readUInt32LE(eocd + 16)
  const entries = zip.readUInt16LE(eocd + 10)
  for (let i = 0; i < entries; i++) {
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const entryName = zip.toString('utf8', offset + 46, offset + 46 + nameLength)
    if (entryName === name) {
      const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
      const raw = zip.subarray(dataStart, dataStart + compressedSize)
      if (method === 0) return Buffer.from(raw)
      if (method === 8) return zlib.inflateRawSync(raw)
      throw new Error(`unsupported zip method ${method}`)
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`${name} is not in the zip`)
}
