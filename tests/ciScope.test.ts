import { describe, expect, it } from 'vitest'
import { appUnchanged } from '../scripts/ci-scope.cjs'

const pkg = (version: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'lan-screenshare', version, scripts: { build: 'electron-vite build' }, ...extra }, null, 2)
const lock = (version: string, dep = '1.0.0'): string =>
  JSON.stringify({ name: 'lan-screenshare', version, packages: { '': { version }, 'node_modules/x': { version: dep } } }, null, 2)

/** What `read` returns for each file in these tests. */
function reader(files: Record<string, { before: string | null; after: string | null }>) {
  return (file: string) => files[file] ?? { before: 'a', after: 'b' }
}

describe("CI: when the end-to-end job needn't run the app", () => {
  it('skips branches that only change words', () => {
    const files = ['docs/en-US/testing.md', 'docs/pt-BR/testing.md', 'changes/pin-rooms.md', 'plans/next.md', 'README.md']
    expect(appUnchanged(files, reader({})).unchanged).toBe(true)
  })

  it('skips a release commit: notes, changelog, fragments gone, and only the version changed', () => {
    const files = ['CHANGELOG.md', 'docs/releases/v2.9.0.md', 'changes/pin-rooms.md', 'package.json', 'package-lock.json']
    const read = reader({
      'package.json': { before: pkg('2.8.0'), after: pkg('2.9.0') },
      'package-lock.json': { before: lock('2.8.0'), after: lock('2.9.0') },
      'changes/pin-rooms.md': { before: '### Added', after: null }
    })
    expect(appUnchanged(files, read).unchanged).toBe(true)
  })

  it('runs the app when package.json changes more than the version', () => {
    const read = reader({ 'package.json': { before: pkg('2.8.0'), after: pkg('2.9.0', { dependencies: { x: '1' } }) } })
    expect(appUnchanged(['package.json'], read)).toEqual({ unchanged: false, reason: 'package.json changed' })
    const lockRead = reader({ 'package-lock.json': { before: lock('2.8.0'), after: lock('2.8.0', '1.0.1') } })
    expect(appUnchanged(['package-lock.json'], lockRead).unchanged).toBe(false)
  })

  it('runs the app for code, workflows, scripts, and an added or removed package.json', () => {
    for (const file of ['src/main/server.ts', '.github/workflows/ci.yml', 'scripts/mac-sign.cjs', 'electron-builder.json']) {
      expect(appUnchanged(['docs/en-US/testing.md', file], reader({})).unchanged).toBe(false)
    }
    expect(appUnchanged(['package.json'], reader({ 'package.json': { before: null, after: pkg('1.0.0') } })).unchanged).toBe(false)
  })

  it('runs the app when there is nothing to compare', () => {
    expect(appUnchanged([], reader({})).unchanged).toBe(false)
  })
})
