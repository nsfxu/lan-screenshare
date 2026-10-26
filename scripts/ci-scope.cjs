// Whether CI's end-to-end job needs to run the app for this commit (.github/workflows/ci.yml).
// It's a required check, so it always finishes; it just passes without running the app when that
// would test nothing new:
//
// - a branch (or a merge into main) that only changes words: docs, changelog fragments, plans, any
//   .md, and package.json / package-lock.json where only the version changed (npm run release);
// - a merge commit on main with exactly the files of the branch it merged: that branch's last
//   commit had to pass the same checks before it could be merged.
//
// A merge whose branch was behind main still runs: that's where two changes that each passed
// alone can break each other.
//
//   node scripts/ci-scope.cjs   prints why, and writes app=false to $GITHUB_OUTPUT when it can skip

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')

/** Files that are only words: they can't change what the app does. */
const WORDS = /^(docs|changes|plans)\/|\.md$/

/** package.json and package-lock.json without their own version (npm run release only changes that). */
function withoutVersion(json) {
  const data = JSON.parse(json)
  delete data.version
  if (data.packages && data.packages['']) delete data.packages[''].version
  return JSON.stringify(data)
}

/**
 * Whether these changed files leave the app as it was; `read(file)` gives the file before and after
 * (null where it doesn't exist). An empty list runs the app: there's nothing to compare.
 */
function appUnchanged(files, read) {
  if (files.length === 0) return { unchanged: false, reason: 'no changed files to compare' }
  for (const file of files) {
    if (WORDS.test(file)) continue
    if (file === 'package.json' || file === 'package-lock.json') {
      const { before, after } = read(file)
      if (before !== null && after !== null && withoutVersion(before) === withoutVersion(after)) continue
    }
    return { unchanged: false, reason: `${file} changed` }
  }
  return { unchanged: true, reason: `only docs and the version changed: ${files.join(', ')}` }
}

function decide(git, onMain) {
  let base
  if (onMain) {
    const [, first, second] = git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ')
    if (second && git('rev-parse', 'HEAD^{tree}') === git('rev-parse', `${second}^{tree}`)) {
      return { unchanged: true, reason: `same files as the merged branch (${second.slice(0, 7)}), which passed before merging` }
    }
    base = first
  } else {
    base = git('merge-base', 'origin/main', 'HEAD')
  }
  if (!base) return { unchanged: false, reason: 'no commit to compare with' }
  const files = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean)
  const show = (rev, file) => {
    try {
      return git('show', `${rev}:${file}`)
    } catch {
      return null
    }
  }
  return appUnchanged(files, (file) => ({ before: show(base, file), after: show('HEAD', file) }))
}

if (require.main === module) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const { unchanged, reason } = decide(git, process.env.GITHUB_REF === 'refs/heads/main')
  console.log(unchanged ? `The app needn't run: ${reason}.` : `Running the app: ${reason}.`)
  if (unchanged && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'app=false\n')
}

module.exports = { WORDS, appUnchanged, withoutVersion }
