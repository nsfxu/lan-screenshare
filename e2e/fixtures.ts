import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../src/shared/ipc'
import type { CursorWatchState } from '../src/shared/types'

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
 *  - the Windows foreground helper never starts; tests report what's in front
 *    themselves (setForeground).
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
      // The fake screen brings its own tone (fakeScreenCapture), so the audio switch is offered on Linux too.
      replace(ch.audioSupported, () => true)
      replace(ch.nativeAudioStart, () => Promise.reject(new Error('disabled in end-to-end tests')))
      replace(ch.hiddenCursorAffected, () => false)
      replace(ch.hiddenCursorWatch, () => true)
      replace(ch.hiddenCursorUnwatch, () => undefined)
      return electronApp.getPath('userData')
    },
    {
      listSources: IPC.listSources,
      nativeAudioAvailable: IPC.nativeAudioAvailable,
      audioSupported: IPC.audioSupported,
      nativeAudioStart: IPC.nativeAudioStart,
      hiddenCursorAffected: IPC.hiddenCursorAffected,
      hiddenCursorWatch: IPC.hiddenCursorWatch,
      hiddenCursorUnwatch: IPC.hiddenCursorUnwatch
    }
  )

  await win.waitForSelector('.rooms-sidebar')
  await win.evaluate(
    (displayName) =>
      window.api.settings.update({ displayName, shareAudio: false, excludeDiscordAudio: false, notifications: false }),
    name
  )
  await win.reload() // the UI reads the settings above at startup
  await win.waitForSelector('.rooms-sidebar')
  await fakeScreenCapture(win)
  return { name, app, win, userData }
}

/**
 * getDisplayMedia() returns an animated canvas (1280×720 at 30 fps unless
 * asked otherwise; background FAKE_SCREEN_RGB), with a 440 Hz tone when audio
 * is asked for. `detailed` covers the background with still text, like a
 * desktop: small frames while little moves, and big keyframes.
 */
export async function fakeScreenCapture(
  win: Page,
  size = { width: 1280, height: 720, fps: 30 },
  detailed = false
): Promise<void> {
  await win.evaluate(([[r, g, b], { width, height, fps }, detailed]) => {
    navigator.mediaDevices.getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      let background: ImageData | null = null
      if (detailed) {
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        ctx.fillRect(0, 0, width, height)
        ctx.font = '13px monospace'
        let seed = 1
        const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
        for (let y = 14; y < height; y += 16) {
          let line = ''
          for (let i = 0; i < width / 8; i++) line += String.fromCharCode(33 + Math.floor(random() * 90))
          ctx.fillStyle = `hsl(${Math.floor(random() * 360)}, 60%, 75%)`
          ctx.fillText(line, 0, y)
        }
        background = ctx.getImageData(0, 0, width, height)
      }
      let frame = 0
      setInterval(() => {
        if (background) ctx.putImageData(background, 0, 0)
        else {
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        ctx.fillStyle = '#fff'
        ctx.fillRect(((frame * 8) % (width - 100)) + 50, height / 2 - 60, 80, 120)
        ctx.font = '64px sans-serif'
        ctx.fillText(`frame ${frame++}`, width / 3, height - 120)
      }, 1000 / fps)
      const stream = canvas.captureStream(fps)
      if (constraints?.audio) {
        const ctx = new AudioContext()
        const tone = ctx.createOscillator()
        const out = ctx.createMediaStreamDestination()
        tone.frequency.value = 440
        tone.connect(out)
        tone.start()
        stream.addTrack(out.stream.getAudioTracks()[0])
      }
      return stream
    }
  }, [FAKE_SCREEN_RGB, size, detailed] as const)
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
        const file = testInfo.outputPath(`${p.name}.png`)
        if (await p.win.screenshot({ path: file }).catch(() => null)) {
          await testInfo.attach(p.name, { path: file, contentType: 'image/png' })
        }
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
export async function createRoom(
  host: Person,
  privacy: 'public' | 'private' = 'public',
  options: { audio?: boolean } = {}
): Promise<number> {
  const { win } = host
  await win.getByRole('button', { name: /^Create( a)? room$/ }).first().click()
  const dialog = win.locator('.modal')
  if (privacy === 'private') await dialog.locator('.privacy-option', { hasText: 'Private' }).click()
  await dialog.locator('.source', { hasText: 'Fake screen' }).click()
  if (options.audio) await dialog.getByRole('checkbox', { name: /Share system audio/ }).check()
  await dialog.getByRole('button', { name: 'Start sharing' }).click()
  await win.waitForSelector('.room')
  const port = await win.evaluate(() => window.api.host.get().then((h) => h?.port ?? 0))
  expect(port).toBeGreaterThan(0)
  return port
}

/** Adds the room at 127.0.0.1:port with Join by IP and clicks it in the room list. */
export async function joinByIp(guest: Person, port: number): Promise<void> {
  const { win } = guest
  // A small window shows the rooms as a strip: open them first.
  const showRooms = win.getByRole('button', { name: 'Show rooms' })
  if (await showRooms.isVisible()) await showRooms.click()
  await win.getByRole('button', { name: 'Join by IP' }).click()
  await win.getByPlaceholder(/^Host address/).fill(`127.0.0.1:${port}`)
  await win.getByPlaceholder(/^Host address/).press('Enter')
  await win.locator(`.room-row-main[title*="127.0.0.1:${port}"]`).click()
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

/** Opens the chat if it's hidden (a narrow window starts with it hidden). */
export async function openChat(person: Person): Promise<void> {
  await person.win.locator('.room').waitFor()
  const show = person.win.getByRole('button', { name: /^Show chat/ })
  if (await show.isVisible()) await show.click()
  await expect(person.win.getByLabel('Chat message')).toBeVisible()
}

/** Closes the chat if it's open over the room (a narrow window), so it doesn't cover the control bar. */
export async function closeFloatingChat(person: Person): Promise<void> {
  if (await person.win.locator('.room .sidebar.floating').isVisible()) {
    await person.win.getByRole('button', { name: 'Hide chat' }).click()
  }
}

/** Resize the window's content (what the page sees), e.g. to see the layout of a small or snapped window. */
export async function resizeWindow(person: Person, width: number, height: number): Promise<void> {
  await person.app.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h),
    [width, height] as const
  )
  await expect.poll(() => person.win.evaluate(() => window.innerWidth)).toBe(width)
}

export async function sendChat(person: Person, text: string): Promise<void> {
  await openChat(person)
  const input = person.win.getByLabel('Chat message')
  await input.fill(text)
  await input.press('Enter')
}

/** Frames decoded so far by the tile of `streamer` (by name). */
export function framesOf(win: Page, streamer: string): Promise<number> {
  return win.evaluate((name) => {
    const tile = [...document.querySelectorAll('.tile')].find((t) => t.querySelector('.tile-name')?.textContent?.includes(name))
    return tile?.querySelector<HTMLVideoElement>('video')?.getVideoPlaybackQuality().totalVideoFrames ?? 0
  }, streamer)
}

/** How many frames `streamer`'s tile decodes during `ms`. */
export async function framesDuring(win: Page, streamer: string, ms: number): Promise<number> {
  const start = await framesOf(win, streamer)
  await win.waitForTimeout(ms)
  return (await framesOf(win, streamer)) - start
}

/** Tell the app its window was minimized or restored, as the main process does (works without a window manager). */
export async function setWindowState(person: Person, state: 'minimized' | 'restored'): Promise<void> {
  await person.app.evaluate(
    ({ BrowserWindow }, [channel, value]) => BrowserWindow.getAllWindows()[0].webContents.send(channel, value),
    [IPC.windowState, state] as const
  )
}

/** Report what's in front, as the Windows foreground helper would (main/cursorWatch.ts). */
export async function setForeground(person: Person, state: CursorWatchState): Promise<void> {
  await person.app.evaluate(
    ({ BrowserWindow }, [channel, value]) => BrowserWindow.getAllWindows()[0].webContents.send(channel, value),
    [IPC.hiddenCursorChanged, state] as const
  )
}
