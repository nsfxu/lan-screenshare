import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fakeScreenCapture } from '../../e2e/fixtures'
import { MAX_USERS } from '../../src/shared/constants'
import { IPC } from '../../src/shared/ipc'
import { parsePerfLog, screenToScreenMarkdown, summarize, summaryMarkdown, type ScreenToScreen } from '../../src/shared/perfSummary'
import { HIGH_FPS_PRESET, qualityPresets } from '../../src/shared/quality'
import ts from 'typescript'

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
  if (!['screen', 'fake', 'fake-detailed'].includes(source)) {
    throw new Error('--source must be screen, fake or fake-detailed')
  }
  const quality = raw.quality === undefined ? null : String(raw.quality)
  // The streamer's "Optimize for": WebRTC paces screen content ('detail') and video ('motion') differently.
  const hint = raw.hint === undefined ? null : String(raw.hint)
  if (hint && !['auto', 'detail', 'motion'].includes(hint)) throw new Error('--hint must be auto, detail or motion')
  if (quality && !qualityPresets(true).some((p) => p.id === quality)) {
    throw new Error(`--quality must be one of ${qualityPresets(true).map((p) => p.id).join(', ')}`)
  }
  const viewHeight = raw['view-height'] === undefined ? null : int('view-height', 0, 90)
  const viewers = hostOnly ? 0 : int('viewers', 1, 1)
  // Screen-to-screen latency: a test pattern on the shared screen, read back by viewers on the same computer.
  const latency = raw.latency === true
  // The streamer's adaptive quality (Settings → Advanced); `off` keeps the chosen quality, to measure the pipeline itself.
  const adaptive = raw.adaptive === undefined ? null : String(raw.adaptive)
  // Share system audio too (with --latency, the pattern plays a quiet tone so there is sound to send):
  // `--audio` as the app does by default (on Windows, the helper without Discord), `--audio=chromium`
  // with Chromium's own loopback (Leave out Discord off).
  const audio = raw.audio === true || raw.audio === 'native' || raw.audio === 'chromium'
  const audioPath = raw.audio === 'chromium' ? 'chromium' : 'default'
  if (raw.audio !== undefined && !audio) throw new Error('--audio takes no value, or native or chromium')
  if (adaptive && !['on', 'off'].includes(adaptive)) throw new Error('--adaptive must be on or off')
  if (latency && (source !== 'screen' || join || hostOnly)) {
    throw new Error('--latency shares the real screen and needs the streamer and viewers on this computer (same clock)')
  }
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
    hint,
    viewHeight,
    join,
    hostOnly,
    latency,
    adaptive,
    audio,
    audioPath,
    // The 120 fps preset only exists with --perf-high-fps.
    passthrough:
      quality === HIGH_FPS_PRESET.id && !raw.passthrough.includes('--perf-high-fps')
        ? [...raw.passthrough, '--perf-high-fps']
        : raw.passthrough,
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
  // --lang: the runner finds buttons by their English names, whatever the computer's language.
  const args = [repo, `--profile=perf-${slug}-${process.pid}`, `--perf-log=${log}`, '--lang=en-US', ...opts.passthrough]
  if (opts.viewHeight) args.push(`--perf-view-height=${opts.viewHeight}`)
  // Viewers play the stream's sound; muted, so the streamer's system audio doesn't capture it again.
  if (opts.audio && name !== STREAMER) args.push('--mute-audio')
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
    ([displayName, maxQuality, contentHint, adaptive, audio, audioPath]) =>
      window.api.settings.update({
        displayName,
        shareAudio: audio,
        ...(audioPath === 'chromium' ? { excludeDiscordAudio: false, appAudioOnly: false } : {}),
        notifications: false,
        // No update checks from a measuring run.
        autoUpdate: false,
        ...(maxQuality ? { maxQuality: maxQuality as never } : {}),
        ...(contentHint ? { contentHint: contentHint as never } : {}),
        ...(adaptive ? { adaptiveQuality: adaptive === 'on' } : {})
      }),
    [name, opts.quality, opts.hint, opts.adaptive, opts.audio, opts.audioPath] as const
  )
  await win.reload() // the UI reads the settings above at startup
  await win.waitForSelector('.rooms-sidebar')
  // Like a 1080p60 screen, the size the measured cases share.
  if (fakeSource) {
    await fakeScreenCapture(win, { width: 1920, height: 1080, fps: 60 }, opts.source === 'fake-detailed')
  }
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

// --- Screen-to-screen latency (--latency) -------------------------------------------

/** src/shared/timeCode.ts as a page script that sets window.TimeCode: the pattern and the viewers share it. */
function timeCodeScript(): string {
  const source = fs.readFileSync(path.join(repo, 'src', 'shared', 'timeCode.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  return `(() => { const exports = {}; ${outputText}; window.TimeCode = exports })()`
}

/** Opens the test pattern over the shared screen; resolves with it and the screen's size in pixels. */
async function startPattern(withSound: boolean): Promise<{ app: ElectronApplication; width: number }> {
  const app = await electron.launch({ args: [path.join(__dirname, 'pattern', 'main.cjs')], cwd: repo })
  const page = await app.firstWindow()
  await page.waitForLoadState()
  await page.evaluate(timeCodeScript())
  const size = await page.evaluate(
    (sound) => (window as unknown as { startPattern(sound: boolean): { width: number } }).startPattern(sound),
    withSound
  )
  return { app, width: size.width }
}

/**
 * Starts reading the time code from every frame a viewer shows: when the frame is due on screen
 * (requestVideoFrameCallback's expectedDisplayTime), how old the code in it is. Readings are kept
 * from `measureFrom()` on.
 */
async function startReading(viewer: Instance, screenWidth: number): Promise<void> {
  await viewer.win.evaluate(timeCodeScript())
  await viewer.win.evaluate((width) => {
    type TC = typeof import('../../src/shared/timeCode')
    const { TIME_CODE, decodeTimeCode, timeCodeAge, timeCodeCellCentre } = (window as unknown as { TimeCode: TC }).TimeCode
    const video = document.querySelector<HTMLVideoElement>('.tile video')
    if (!video) throw new Error('no video to read the time code from')
    const { cell, x, y, columns, rows } = TIME_CODE
    const canvas = new OffscreenCanvas(columns * cell + cell, rows * cell + cell)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const state = { active: false, ages: [] as number[], unreadable: 0 }
    ;(window as unknown as { latencyReading: typeof state }).latencyReading = state
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata): void => {
      if (state.active && video.videoWidth > 0) {
        // The code's area of the shared screen, scaled to the size the video arrives in, drawn back at full size.
        const scale = video.videoWidth / width
        ctx.drawImage(video, x * scale, y * scale, columns * cell * scale, rows * cell * scale, 0, 0, columns * cell, rows * cell)
        const pixels = ctx.getImageData(0, 0, columns * cell, rows * cell).data
        const bits: boolean[] = []
        for (let i = 0; i < columns * rows; i++) {
          const c = timeCodeCellCentre(i)
          let sum = 0
          let n = 0
          for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              const at = ((c.y - y + dy) * columns * cell + (c.x - x + dx)) * 4
              sum += pixels[at] + pixels[at + 1] + pixels[at + 2]
              n += 3
            }
          }
          bits.push(sum / n > 128)
        }
        const code = decodeTimeCode(bits)
        const age = code === null ? null : timeCodeAge(performance.timeOrigin + meta.expectedDisplayTime, code)
        // A code from the future, or one more than 10 s old, can only be misread.
        if (age === null || age < 0 || age > 10_000) state.unreadable++
        else state.ages.push(age)
      }
      video.requestVideoFrameCallback(onFrame)
    }
    video.requestVideoFrameCallback(onFrame)
  }, screenWidth)
}

function setReading(viewer: Instance, active: boolean): Promise<void> {
  return viewer.win.evaluate((on) => {
    const state = (window as unknown as { latencyReading?: { active: boolean } }).latencyReading
    if (state) state.active = on
  }, active)
}

async function readings(viewer: Instance): Promise<ScreenToScreen> {
  const state = await viewer.win.evaluate(
    () => (window as unknown as { latencyReading?: { ages: number[]; unreadable: number } }).latencyReading ?? null
  )
  return { viewer: viewer.name, ages: state?.ages ?? [], unreadable: state?.unreadable ?? 0 }
}

test('measure', async () => {
  const opts = options()
  fs.mkdirSync(opts.out, { recursive: true })
  const instances: Instance[] = []
  const say = (msg: string): void => console.log(`[perf] ${msg}`)
  let pattern: { app: ElectronApplication; width: number } | null = null
  try {
    // Before the streamer starts sharing, so the first screen already shows it.
    if (opts.latency) {
      pattern = await startPattern(opts.audio)
      say(`test pattern on the shared screen (${pattern.width} px wide)`)
    }
    let address = opts.join
    let gpu: unknown = null
    if (!opts.join) {
      const streamer = await launch(STREAMER, opts, opts.source !== 'screen')
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
    const viewers = instances.filter((v) => v.name !== STREAMER)
    for (const viewer of viewers) {
      await expect.poll(() => decodedFrames(viewer.win), { timeout: 60_000, message: `${viewer.name} gets no video` }).toBeGreaterThan(0)
    }

    if (pattern) for (const viewer of viewers) await startReading(viewer, pattern.width)
    say(`warming up for ${opts.warmup} s`)
    await new Promise((resolve) => setTimeout(resolve, opts.warmup * 1000))
    const from = Date.now()
    const shownAtStart = await Promise.all(viewers.map((v) => decodedFrames(v.win)))
    await Promise.all(viewers.map((v) => setReading(v, true)))
    say(`measuring for ${opts.seconds} s`)
    await new Promise((resolve) => setTimeout(resolve, opts.seconds * 1000))
    await Promise.all(viewers.map((v) => setReading(v, false)))
    const to = Date.now()
    const screenToScreen = pattern ? await Promise.all(viewers.map(readings)) : null
    // Frames the viewers' <video> elements actually showed: what a high refresh rate is for.
    const shown = await Promise.all(viewers.map((v) => decodedFrames(v.win)))
    const displayedFps = Object.fromEntries(
      viewers.map((v, i) => [v.name, Math.round(((shown[i] - shownAtStart[i]) / ((to - from) / 1000)) * 10) / 10])
    )

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
          measured: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
          displayedFps,
          ...(screenToScreen ? { screenToScreen } : {})
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
    const shownLines = Object.entries(displayedFps).map(([name, fps]) => `- ${name}: ${fps} fps`)
    const md =
      summaryMarkdown(summarize(logs, from, to), title) +
      (shownLines.length ? `\n## Displayed by the viewers' video elements\n\n${shownLines.join('\n')}\n` : '') +
      (screenToScreen ? `\n${screenToScreenMarkdown(screenToScreen)}` : '') +
      `\n\`${opts.command}\`, app ${appVersion}\n`
    fs.writeFileSync(path.join(opts.out, 'summary.md'), md)
    console.log(`\n${md}`)
    say(`results in ${path.relative(repo, opts.out)}`)
  } finally {
    await Promise.all(instances.map(quit))
    await pattern?.app.close().catch(() => {})
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
