import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeEntries, parseEntries } from '../scripts/changelog.cjs'

const pin = '### Added\n\n- **Pin and rename your rooms.** Right-click a room.\n'
const fixes = '### Fixed\n\n- **The screen stays on.** It could dim.\n  Even mid-stream.\n\n### Added\n\n- **Links in chat.**\n'

describe('changelog fragments', () => {
  it('merge into one section, groups in the usual order and entries in the order given', () => {
    expect(mergeEntries([parseEntries(pin), parseEntries(fixes), parseEntries('')])).toBe(
      [
        '### Added',
        '',
        '- **Pin and rename your rooms.** Right-click a room.',
        '- **Links in chat.**',
        '',
        '### Fixed',
        '',
        '- **The screen stays on.** It could dim.\n  Even mid-stream.'
      ].join('\n')
    )
    expect(mergeEntries([])).toBe('')
  })

  it("refuse what the changelog can't hold", () => {
    expect(() => parseEntries('### New stuff\n\n- x', 'changes/a.md')).toThrow('changes/a.md: "### New stuff" isn\'t one of')
    expect(() => parseEntries('- x\n')).toThrow('an entry before any')
    expect(() => parseEntries('### Added\n\nSome prose\n')).toThrow('unexpected line')
  })

  it('in changes/ all read correctly', () => {
    const dir = path.join(__dirname, '..', 'changes')
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md')) {
      expect(() => parseEntries(fs.readFileSync(path.join(dir, name), 'utf8'), `changes/${name}`)).not.toThrow()
    }
  })
})
