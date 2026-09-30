import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../src/shared/ipc'

const repo = path.join(__dirname, '..')

/** Background colour of the fake screen, checked on the viewer's side. */
export const FAKE_SCREEN_RGB = [51, 85, 119] as const

/**
 * Screen to open the windows on, numbered like the source picker (see
 * --display in src/main/windowPlacement.ts): E2E_DISPLAY, or "display" in the
 * git-ignored e2e.local.json. Unset (as in CI) = wherever the OS puts them.
 */
function localDisplay(): string | null {
  if (process.env.E2E_DISPLAY) return process.env.E2E_DISPLAY
  try {
    const local = JSON.parse(fs.readFileSync(path.join(repo, 'e2e.local.json'), 'utf8')) as { display?: number }
    return local.display ? String(local.display) : null
  } catch {
    return null
  }
}
const display = localDisplay()

export interface Person {
  name: string
  app: ElectronApplication
  win: Page
  userData: string
}

/**
 * Starts the built app (out/) as a new person with a fresh profile, and makes
 * it safe and predictable to drive:
 *  - screen capture is an animated canvas, never the real screen;
 *  - system audio is off, and the native audio helper can't start;
 *  - the game-cursor helper stays off.
 */
async function launchPerson(
  name: string,
  tile: number,
  tiles: number,
  launched: (app: ElectronApplication) => void
): Promise<Person> {
  const args = [repo, `--profile=e2e-${name.toLowerCase()}-${process.pid}`]
  if (display) args.push(`--display=${display}`, `--tile=${tile}/${tiles}`)
  // CI runners don't allow Chromium's sandbox (unprivileged user namespaces).
  if (process.platform === 'linux') args.push('--no-sandbox')
  const app = await electron.launch({ args, cwd: repo })
  launched(app)

  // The app registers its IPC handlers before creating the window: replace
  // them only after that, or registering the originals would fail.
  const win = await app.firstWindow()
  const userData = await app.evaluate(
    ({ app: electronApp, ipcMain }, ch) => {
      const fake = { id: 'screen:fake:0', name: 'Fake screen', kind: 'screen', thumbnail: '', displayId: 'fake' }
      const replace = (channel: string, handler: (...args: unknown[]) => unknown): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
      }
      replace(ch.listSources, () => [fake])
      replace(ch.nativeAudioAvailable, () => false)
      replace(ch.nativeAudioStart, () => Promise.reject(new Error('disabled in end-to-end tests')))
      replace(ch.hiddenCursorAffected, () => false)
      return electronApp.getPath('userData')
    },
    {
      listSources: IPC.listSources,
      nativeAudioAvailable: IPC.nativeAudioAvailable,
      nativeAudioStart: IPC.nativeAudioStart,
      hiddenCursorAffected: IPC.hiddenCursorAffected
    }
  )

  await win.waitForSelector('.home')
  await win.evaluate(
    (displayName) =>
      window.api.settings.update({ displayName, shareAudio: false, excludeDiscordAudio: false, notifications: false }),
    name
  )
  await win.reload() // the UI reads the settings above at startup
  await win.waitForSelector('.home')
  await fakeScreenCapture(win)
  return { name, app, win, userData }
}

/** getDisplayMedia() returns an animated 1280×720 canvas (background FAKE_SCREEN_RGB). */
async function fakeScreenCapture(win: Page): Promise<void> {
  await win.evaluate(([r, g, b]) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1280
      canvas.height = 720
      const ctx = canvas.getContext('2d')!
      let frame = 0
      setInterval(() => {
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#fff'
        ctx.fillRect(((frame * 8) % 1180) + 50, 300, 80, 120)
        ctx.font = '64px sans-serif'
        ctx.fillText(`frame ${frame++}`, 440, 600)
      }, 33)
      return canvas.captureStream(30)
    }
  }, FAKE_SCREEN_RGB)
}


/** `people(2)` starts two people (Alice, Bob, …) side by side; they are closed and deleted afterwards. */
export const test = base.extend<{ people: (count: number) => Promise<Person[]> }>({
  // eslint-disable-next-line no-empty-pattern
  people: async ({}, use, testInfo) => {
    const started: Person[] = []
    // Every launched app, including one that failed to start properly.
    const apps: ElectronApplication[] = []
    await use(async (count) => {
      const names = ['Alice', 'Bob', 'Carol'].slice(0, count)
      for (const [i, name] of names.entries()) {
        started.push(await launchPerson(name, i + 1, count, (app) => apps.push(app)))
      }
      return started
    })
    if (testInfo.status !== testInfo.expectedStatus) {
      for (const p of started) {
        const shot = await p.win.screenshot().catch(() => null)
        if (shot) await testInfo.attach(`${p.name}.png`, { body: shot, contentType: 'image/png' })
      }
    }
    for (const app of apps) await quit(app)
    // Windows keeps files locked for a moment after the process exits.
    for (const p of started) fs.rmSync(p.userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

/**
 * Quit like a user quitting the app. Closing the window instead (what
 * ElectronApplication.close() does) asks a host to confirm ending the room,
 * and that dialog would wait forever.
 */
async function quit(app: ElectronApplication): Promise<void> {
  const child = app.process()
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve))
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {})
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15_000))])
  }
  await app.close().catch(() => {})
}

export { expect }

// --- flows -----------------------------------------------------------------------

/** Creates a room sharing the fake screen; returns its port. */
export async function createRoom(host: Person, privacy: 'public' | 'private' = 'public'): Promise<number> {
  const { win } = host
  await win.getByRole('button', { name: /^Create( a)? room$/ }).first().click()
  const dialog = win.locator('.modal')
  if (privacy === 'private') await dialog.locator('.privacy-option', { hasText: 'Private' }).click()
  await dialog.locator('.source', { hasText: 'Fake screen' }).click()
  await dialog.getByRole('button', { name: 'Start sharing' }).click()
  await win.waitForSelector('.room')
  const port = await win.evaluate(() => window.api.host.get().then((h) => h?.port ?? 0))
  expect(port).toBeGreaterThan(0)
  return port
}

/** Adds the room at 127.0.0.1:port with Connect by IP and clicks Join. */
export async function joinByIp(guest: Person, port: number): Promise<void> {
  const { win } = guest
  await win.getByRole('button', { name: 'Connect by IP' }).click()
  await win.getByPlaceholder(/^Host address/).fill(`127.0.0.1:${port}`)
  await win.getByPlaceholder(/^Host address/).press('Enter')
  const card = win.locator('.room-card', { hasText: `127.0.0.1:${port}` })
  await card.getByRole('button', { name: 'Join' }).click()
}

/** Frames decoded so far by the first watched tile. */
export function decodedFrames(win: Page): Promise<number> {
  return win.evaluate(() => document.querySelector<HTMLVideoElement>('.tile video')?.getVideoPlaybackQuality().totalVideoFrames ?? 0)
}

/** Average colour of the watched video's top-left corner (the fake screen's background). */
export function cornerColour(win: Page): Promise<number[] | null> {
  return win.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>('.tile video')
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0)
    const { data } = ctx.getImageData(8, 8, 24, 24)
    const sum = [0, 0, 0]
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c]
    return sum.map((s) => Math.round(s / (data.length / 4)))
  })
}

export async function sendChat(person: Person, text: string): Promise<void> {
  const input = person.win.getByPlaceholder('Type a message…')
  await input.fill(text)
  await input.press('Enter')
}
