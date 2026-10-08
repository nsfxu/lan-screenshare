import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fakeScreenCapture } from '../../e2e/fixtures'
import { MAX_USERS } from '../../src/shared/constants'
import { IPC } from '../../src/shared/ipc'
import { parsePerfLog, summarize, summaryMarkdown } from '../../src/shared/perfSummary'
import { QUALITY_PRESETS } from '../../src/shared/quality'

// The measuring run behind `npm run perf` (options from scripts/perf/run.cjs).
// See docs/en-US/testing.md#measuring-performance.

const repo = path.join(__dirname, '..', '..')
const STREAMER = 'Streamer'

interface RawOptions {
  [name: string]: string | boolean | string[] | undefined
  passthrough: string[]
  out: string
  command: string
}

const raw = JSON.parse(process.env.PERF_OPTIONS ?? 'null') as RawOptions | null

function int(name: string, fallback: number, min: number): number {
  const value = raw?.[name]
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be a whole number ≥ ${min}`)
  return n
}

function options() {
  if (!raw) throw new Error('Run this with `npm run perf`, not directly')
  const hostOnly = raw['host-only'] === true
  const join = typeof raw.join === 'string' ? raw.join : null
  if (hostOnly && join) throw new Error('--host-only and --join go on different computers')
  const source = String(raw.source ?? (process.platform === 'linux' ? 'fake' : 'screen'))
  if (source !== 'screen' && source !== 'fake') throw new Error('--source must be screen or fake')
  const quality = raw.quality === undefined ? null : String(raw.quality)
  if (quality && !QUALITY_PRESETS.some((p) => p.id === quality)) {
    throw new Error(`--quality must be one of ${QUALITY_PRESETS.map((p) => p.id).join(', ')}`)
  }
  const viewHeight = raw['view-height'] === undefined ? null : int('view-height', 0, 90)
  const viewers = hostOnly ? 0 : int('viewers', 1, 1)
  // A room holds MAX_USERS people, the streamer included: one more viewer would find it full.
  if (viewers > MAX_USERS - 1) {
    throw new Error(`--viewers can be at most ${MAX_USERS - 1}: a room holds ${MAX_USERS} people`)
  }
  return {
    viewers,
    seconds: int('seconds', 60, 1),
    warmup: int('warmup', 15, 0),
    source,
    quality,
    viewHeight,
    join,
    hostOnly,
    passthrough: raw.passthrough,
    out: raw.out,
    command: raw.command
  }
}

interface Instance {
  name: string
  app: ElectronApplication
  win: Page
  userData: string
  log: string
}

async function launch(name: string, opts: ReturnType<typeof options>, fakeSource: boolean): Promise<Instance> {
  const slug = name.toLowerCase().replace(/\W+/g, '-')
  const log = path.join(opts.out, `${slug}.jsonl`)
  const args = [repo, `--profile=perf-${slug}-${process.pid}`, `--perf-log=${log}`, ...opts.passthrough]
  if (opts.viewHeight) args.push(`--perf-view-height=${opts.viewHeight}`)
  // Chromium's sandbox needs unprivileged user namespaces, which containers and CI often lack.
  if (process.platform === 'linux') args.push('--no-sandbox')
  const app = await electron.launch({ args, cwd: repo })
  const win = await app.firstWindow()
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  if (fakeSource) {
    await app.evaluate(({ ipcMain }, ch) => {
      const fake = { id: 'screen:fake:0', name: 'Fake screen', kind: 'screen', thumbnail: '', displayId: 'fake' }
      ipcMain.removeHandler(ch)
      ipcMain.handle(ch, () => [fake])
    }, IPC.listSources)
  }
  await win.waitForSelector('.rooms-sidebar')
  await win.evaluate(
    ([displayName, maxQuality]) =>
      window.api.settings.update({
        displayName,
        shareAudio: false,
        notifications: false,
        // No update checks from a measuring run.
        autoUpdate: false,
        ...(maxQuality ? { maxQuality: maxQuality as never } : {})
      }),
    [name, opts.quality] as const
  )
  await win.reload() // the UI reads the settings above at startup
  await win.waitForSelector('.rooms-sidebar')
  if (fakeSource) await fakeScreenCapture(win)
  return { name, app, win, userData, log }
}

/** Quit like a user (closing the window would ask a host to confirm ending the room). */
async function quit(instance: Instance): Promise<void> {
  const child = instance.app.process()
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    await instance.app.evaluate(({ app }) => app.quit()).catch(() => {})
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15_000))])
  }
  await instance.app.close().catch(() => {})
  fs.rmSync(instance.userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

async function createRoom(streamer: Instance): Promise<number> {
  const { win } = streamer
  await win.getByRole('button', { name: /^Create( a)? room$/ }).first().click()
  // The first screen is chosen by default (the fake one with --source=fake).
  await win.locator('.modal .source.selected').waitFor()
  await win.locator('.modal').getByRole('button', { name: 'Start sharing' }).click()
  await win.waitForSelector('.room')
  return win.evaluate(() => window.api.host.get().then((h) => h?.port ?? 0))
}

async function joinAndWatch(viewer: Instance, address: string): Promise<void> {
  const { win } = viewer
  await win.getByRole('button', { name: 'Join by IP' }).click()
  await win.getByPlaceholder(/^Host address/).fill(address)
  await win.getByPlaceholder(/^Host address/).press('Enter')
  const host = address.replace(/:\d+$/, '')
  await win.locator(`.room-row-main[title*="${host}"]`).first().click()
  await win.getByRole('button', { name: `Watch ${STREAMER}'s stream` }).click({ timeout: 60_000 })
}

function decodedFrames(win: Page): Promise<number> {
  return win.evaluate(
    () => document.querySelector<HTMLVideoElement>('.tile video')?.getVideoPlaybackQuality().totalVideoFrames ?? 0
  )
}

/** Addresses other computers can use to reach this one. */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address)
}

/** Has the streamer logged a sample with a visible watcher yet? */
function streamerHasWatcher(log: string): boolean {
  try {
    return parsePerfLog(STREAMER, fs.readFileSync(log, 'utf8')).samples.some(
      (s) => s.kind === 'streamer' && s.watchers.some((w) => !w.hidden)
    )
  } catch {
    return false
  }
}

test('measure', async () => {
  const opts = options()
  fs.mkdirSync(opts.out, { recursive: true })
  const instances: Instance[] = []
  const say = (msg: string): void => console.log(`[perf] ${msg}`)
  try {
    let address = opts.join
    let gpu: unknown = null
    if (!opts.join) {
      const streamer = await launch(STREAMER, opts, opts.source === 'fake')
      instances.push(streamer)
      const port = await createRoom(streamer)
      address = `127.0.0.1:${port}`
      gpu = await streamer.app.evaluate(({ app }) => app.getGPUInfo('complete')).catch(() => null)
      if (opts.hostOnly) {
        say(`Room is open. On the other computer: npm run perf -- --join=<address>:${port} --viewers=<n>`)
        say(`This computer's addresses: ${lanAddresses().join(', ') || 'none found'}`)
        say('Waiting up to 10 minutes for a viewer…')
        await expect.poll(() => streamerHasWatcher(streamer.log), { timeout: 600_000, intervals: [1000] }).toBe(true)
      }
    }

    for (let i = 1; i <= opts.viewers; i++) {
      const viewer = await launch(`Viewer ${i}`, opts, false)
      instances.push(viewer)
      await joinAndWatch(viewer, address!)
      say(`${viewer.name} is watching`)
    }
    for (const viewer of instances.filter((v) => v.name !== STREAMER)) {
      await expect.poll(() => decodedFrames(viewer.win), { timeout: 60_000, message: `${viewer.name} gets no video` }).toBeGreaterThan(0)
    }

    say(`warming up for ${opts.warmup} s`)
    await new Promise((resolve) => setTimeout(resolve, opts.warmup * 1000))
    const from = Date.now()
    say(`measuring for ${opts.seconds} s`)
    await new Promise((resolve) => setTimeout(resolve, opts.seconds * 1000))
    const to = Date.now()

    const appVersion = await instances[0].app.evaluate(({ app }) => app.getVersion())
    fs.writeFileSync(
      path.join(opts.out, 'run.json'),
      JSON.stringify(
        {
          command: opts.command,
          options: { ...opts, out: undefined, command: undefined },
          appVersion,
          os: `${os.type()} ${os.release()} ${os.arch()}`,
          cpu: os.cpus()[0]?.model ?? 'unknown',
          cores: os.cpus().length,
          memoryGB: Math.round(os.totalmem() / 2 ** 30),
          gpu: gpuSummary(gpu),
          measured: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
        },
        null,
        2
      ) + '\n'
    )
    await Promise.all(instances.splice(0).map(quit))

    const logs = fs
      .readdirSync(opts.out)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const name = f === 'streamer.jsonl' ? STREAMER : f.replace(/^viewer-(\d+)\.jsonl$/, 'Viewer $1')
        return parsePerfLog(name, fs.readFileSync(path.join(opts.out, f), 'utf8'))
      })
    const title = opts.hostOnly
      ? `Streamer only, ${opts.seconds} s`
      : `${opts.viewers} viewer${opts.viewers === 1 ? '' : 's'}, ${opts.seconds} s`
    const md = summaryMarkdown(summarize(logs, from, to), title) + `\n\`${opts.command}\`, app ${appVersion}\n`
    fs.writeFileSync(path.join(opts.out, 'summary.md'), md)
    console.log(`\n${md}`)
    say(`results in ${path.relative(repo, opts.out)}`)
  } finally {
    await Promise.all(instances.map(quit))
  }
})

/** The graphics cards and driver from Chromium's GPU info (its shape differs per platform). */
function gpuSummary(info: unknown): unknown {
  if (!info || typeof info !== 'object') return null
  const { gpuDevice, auxAttributes } = info as {
    gpuDevice?: Record<string, unknown>[]
    auxAttributes?: Record<string, unknown>
  }
  return {
    devices: (gpuDevice ?? []).map((d) => ({
      vendorId: d.vendorId,
      deviceId: d.deviceId,
      active: d.active,
      driverVendor: d.driverVendor,
      driverVersion: d.driverVersion,
      description: d.deviceString ?? d.description
    })),
    renderer: auxAttributes?.glRenderer ?? null
  }
}
