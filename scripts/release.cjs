// Prepares a release on your computer; GitHub Actions builds and publishes it.
//
//   npm run release -- <major | minor | patch | x.y.z> [--dry-run]
//
// 1. Checks that there are no uncommitted changes and that CHANGELOG.md has
//    entries under [Unreleased].
// 2. Works out the version. A PROTOCOL_VERSION change since the last release
//    must be a major version: older apps can't join its rooms.
// 3. Moves the Unreleased entries into a dated section for the version.
// 4. Sets the version in package.json and package-lock.json.
// 5. Writes docs/releases/v<version>.md from the entries, with TODO markers
//    for the parts a person writes (the release workflow refuses notes that
//    still contain TODO).
//
// It doesn't commit: finish the notes, commit, merge into main, then run
// Actions → Release (docs/en-US/development.md#releasing).
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const file = (...p) => path.join(root, ...p)
const git = (cmd) => execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim()

function fail(message) {
  console.error(`release: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const request = args.find((a) => !a.startsWith('--'))
if (!request) fail('usage: npm run release -- <major|minor|patch|x.y.z> [--dry-run]')

// --- current state ------------------------------------------------------------
if (!dryRun && git('status --porcelain --untracked-files=no')) {
  fail('commit or stash your changes first')
}

const current = require(file('package.json')).version
const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
  return m ? m.slice(1).map(Number) : null
}
const [major, minor, patch] = parse(current) ?? fail(`package.json has an unexpected version: ${current}`)

const next =
  request === 'major'
    ? `${major + 1}.0.0`
    : request === 'minor'
      ? `${major}.${minor + 1}.0`
      : request === 'patch'
        ? `${major}.${minor}.${patch + 1}`
        : request.replace(/^v/, '')
const nextParts = parse(next) ?? fail(`not a version: ${request}`)
const firstDifference = nextParts.map((n, i) => n - [major, minor, patch][i]).find((d) => d !== 0) ?? 0
if (firstDifference <= 0) fail(`${next} is not newer than the current version ${current}`)
const tag = `v${next}`
if (git(`tag -l ${tag}`)) fail(`tag ${tag} already exists`)

// --- protocol compatibility ---------------------------------------------------------
const protocolOf = (source) => Number(/PROTOCOL_VERSION\s*=\s*(\d+)/.exec(source)?.[1])
const lastTag = `v${current}`
const protocolNow = protocolOf(fs.readFileSync(file('src/shared/constants.ts'), 'utf8'))
let protocolBefore = null
try {
  protocolBefore = protocolOf(git(`show ${lastTag}:src/shared/constants.ts`))
} catch {
  console.warn(`release: no tag ${lastTag} here (git fetch --tags?), skipping the protocol check`)
}
const protocolChanged = protocolBefore !== null && protocolBefore !== protocolNow
if (protocolChanged && nextParts[0] === major) {
  fail(
    `PROTOCOL_VERSION changed since ${lastTag} (${protocolBefore} → ${protocolNow}), so older apps can't join ` +
      `the new rooms: this must be a major release (npm run release -- major)`
  )
}

// --- changelog -------------------------------------------------------------------
const changelogPath = file('CHANGELOG.md')
const changelog = fs.readFileSync(changelogPath, 'utf8').replace(/\r\n/g, '\n')
const unreleasedAt = changelog.indexOf('## [Unreleased]\n')
if (unreleasedAt < 0) fail('CHANGELOG.md has no "## [Unreleased]" section')
const bodyStart = unreleasedAt + '## [Unreleased]\n'.length
const nextSection = changelog.slice(bodyStart).search(/^## \[|^\[Unreleased\]:/m)
const bodyEnd = nextSection < 0 ? changelog.length : bodyStart + nextSection
const entries = changelog.slice(bodyStart, bodyEnd).trim()
if (!/^- /m.test(entries)) fail('nothing under [Unreleased] in CHANGELOG.md: add the changes first')

const today = new Date().toISOString().slice(0, 10)
const compare = /^\[Unreleased\]: (.+)\/compare\/(v[^.]+\.[^.]+\.[^.]+)\.\.\.HEAD$/m.exec(changelog)
if (!compare) fail('CHANGELOG.md has no "[Unreleased]: <repo>/compare/<tag>...HEAD" link')
const [linkLine, repo, previousTag] = compare

const updatedChangelog =
  changelog.slice(0, bodyStart) +
  `\n## [${next}] - ${today}\n\n${entries}\n\n` +
  changelog.slice(bodyEnd).replace(
    linkLine,
    `[Unreleased]: ${repo}/compare/${tag}...HEAD\n[${next}]: ${repo}/compare/${previousTag}...${tag}`
  )

// --- release notes ------------------------------------------------------------------
const notesPath = file('docs', 'releases', `${tag}.md`)
const compatibility = protocolChanged
  ? `**Everyone in a room needs this version**: older versions can't join its rooms, and it can't join theirs.`
  : nextParts[0] > major
    ? `Works in the same rooms as ${major}.x versions, so people can update when they like.`
    : `Works in the same rooms as other ${nextParts[0]}.x versions, so people can update when they like.`
const notes = `TODO: one or two sentences on what this version brings.

> 🇧🇷 Resumo em português no final.

## Download

| System | File |
|---|---|
| **Windows 10/11**, most PCs | \`ScreenShare-Setup-${next}-x64.exe\` |
| **Windows 11 on ARM** (e.g. Snapdragon laptops) | \`ScreenShare-Setup-${next}-arm64.exe\` |
| **Mac with Apple Silicon** (M1 or newer), experimental | \`ScreenShare-${next}-arm64.dmg\` |
| **Mac with Intel**, experimental | \`ScreenShare-${next}-x64.dmg\` |

${compatibility}

## What's new

${entries.replace(/^### /gm, '#### ')}

The installers aren't code-signed yet: on Windows click **More info → Run anyway**, on macOS open the app once, click **Done**, then **Open Anyway** in *System Settings → Privacy & Security* ([step by step](${repo}/blob/main/docs/en-US/user-guide.md#opening-it-for-the-first-time-on-macos)).

Full list of changes: [CHANGELOG.md](${repo}/blob/main/CHANGELOG.md)

---

## 🇧🇷 Em português

TODO: resumo em português.
`

// --- write ------------------------------------------------------------------------
console.log(`release: ${current} → ${next}${protocolChanged ? ` (protocol ${protocolBefore} → ${protocolNow})` : ''}`)
if (dryRun) {
  console.log(`\n--- CHANGELOG.md section\n## [${next}] - ${today}\n\n${entries}`)
  console.log(`\n--- ${path.relative(root, notesPath)}${fs.existsSync(notesPath) ? ' (exists, kept)' : ''}\n${notes}`)
  process.exit(0)
}

fs.writeFileSync(changelogPath, updatedChangelog)
execSync(`npm version ${next} --no-git-tag-version`, { cwd: root, stdio: 'ignore' })
const wroteNotes = !fs.existsSync(notesPath)
if (wroteNotes) fs.writeFileSync(notesPath, notes)

console.log(`
Updated CHANGELOG.md, package.json and package-lock.json.
${wroteNotes ? `Wrote ${path.relative(root, notesPath)}` : `Kept the existing ${path.relative(root, notesPath)}`}: replace its TODOs (intro, Portuguese summary).

Then:
  git add -A && git commit -m "Release ${tag}"
  merge into main, and run Actions → Release → Run workflow with version ${tag}`)
