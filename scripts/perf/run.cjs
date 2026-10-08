#!/usr/bin/env node
// `npm run perf -- --viewers=4 …`: starts a streamer and viewers, measures them
// and writes perf-results/<date-time>/. The work is done by perf.spec.ts under
// Playwright (so it can drive the app and import the TypeScript summary); this
// script only turns the command line into options for it.
// See docs/en-US/testing.md#measuring-performance.
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const repo = path.join(__dirname, '..', '..')
/** Options of this script; any other --switch is passed to every app instance. */
const OWN = ['viewers', 'seconds', 'warmup', 'source', 'quality', 'view-height', 'join', 'host-only', 'hint']

const options = { passthrough: [] }
for (const arg of process.argv.slice(2)) {
  const match = /^--([\w-]+)(?:=(.*))?$/.exec(arg)
  if (!match) {
    console.error(`Unexpected argument: ${arg}`)
    process.exit(2)
  }
  const [, name, value] = match
  if (OWN.includes(name)) options[name] = value ?? true
  else options.passthrough.push(arg)
}

const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[:T]/g, '-')
options.out = path.join(repo, 'perf-results', stamp)
options.command = ['npm run perf --', ...process.argv.slice(2)].join(' ')

const playwright = path.join(repo, 'node_modules', '@playwright', 'test', 'cli.js')
const result = spawnSync(process.execPath, [playwright, 'test', '-c', path.join(__dirname, 'playwright.config.ts')], {
  cwd: repo,
  stdio: 'inherit',
  env: { ...process.env, PERF_OPTIONS: JSON.stringify(options) }
})
process.exit(result.status ?? 1)
