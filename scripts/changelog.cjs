// Changelog fragments: each pull request adds a file to changes/ instead of editing CHANGELOG.md,
// so pull requests don't conflict with each other there. A fragment reads like the CHANGELOG:
//
//   ### Added
//
//   - **Pin and rename your rooms.** Right-click a recent room…
//
// `npm run release` (scripts/release.cjs) gathers them into the version's section and deletes them.

const GROUPS = ['Added', 'Changed', 'Fixed', 'Removed']

/**
 * The entries of one fragment (or of CHANGELOG.md's Unreleased section), by group, in order. A
 * line that continues an entry (indented) stays with it. Throws on what the CHANGELOG can't hold:
 * an unknown group, or an entry before any group.
 */
function parseEntries(text, source = 'fragment') {
  const groups = new Map()
  let group = null
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading) {
      group = heading[1]
      if (!GROUPS.includes(group)) throw new Error(`${source}: "### ${group}" isn't one of ${GROUPS.join(', ')}`)
      if (!groups.has(group)) groups.set(group, [])
    } else if (/^- /.test(line)) {
      if (!group) throw new Error(`${source}: an entry before any "### Added", "### Changed"… heading`)
      groups.get(group).push(line)
    } else if (/^\s+\S/.test(line) && group && groups.get(group).length) {
      const entries = groups.get(group)
      entries[entries.length - 1] += `\n${line}`
    } else if (line.trim() && !line.startsWith('<!--')) {
      throw new Error(`${source}: unexpected line "${line.slice(0, 60)}"`)
    }
  }
  return groups
}

/** Several fragments' entries as one CHANGELOG section body: groups in the usual order, entries as given. */
function mergeEntries(parsed) {
  const merged = new Map(GROUPS.map((g) => [g, []]))
  for (const groups of parsed) for (const [group, entries] of groups) merged.get(group).push(...entries)
  return GROUPS.filter((g) => merged.get(g).length)
    .map((g) => `### ${g}\n\n${merged.get(g).join('\n')}`)
    .join('\n\n')
}

module.exports = { GROUPS, parseEntries, mergeEntries }
