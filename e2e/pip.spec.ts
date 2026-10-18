import type { Page } from '@playwright/test'
import { createRoom, expect, joinByIp, resizeWindow, setWindowState, test } from './fixtures'

const shots = process.env.E2E_SHOTS

/** Frames shown by the picture-in-picture video (lib/pip.ts) so far. */
function pipFrames(win: Page): Promise<number> {
  return win.evaluate(
    () => document.querySelector<HTMLVideoElement>('video.pip-source')?.getVideoPlaybackQuality().totalVideoFrames ?? 0
  )
}

async function pipFramesDuring(win: Page, ms: number): Promise<number> {
  const start = await pipFrames(win)
  await win.waitForTimeout(ms)
  return (await pipFrames(win)) - start
}

function inPip(win: Page): Promise<boolean> {
  return win.evaluate(() => document.pictureInPictureElement?.classList.contains('pip-source') ?? false)
}

// A watched stream in picture-in-picture keeps playing on top of other apps:
// with the room minimized, and whatever happens to the room's layout.
test('picture-in-picture keeps a stream playing while the room is minimized', async ({ people }) => {
  const [alice, bob] = await people(2)
  // Wide enough to list the room's people beside the room (they read Bob's status there).
  await resizeWindow(alice, 1000, 800)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await bob.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect(bob.win.locator('.spotlight-main .stream-tile, .stage-grid .stream-tile').first()).toBeVisible()

  // The button next to the volume and full screen, under the focused stream.
  const controls = bob.win.locator('.stage-controls')
  await bob.win.locator('.stream-tile').first().hover()
  await controls.getByRole('button', { name: 'Picture in picture' }).click()
  await expect.poll(() => inPip(bob.win)).toBe(true)
  await expect(controls.getByRole('button', { name: 'Close picture in picture' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => pipFramesDuring(bob.win, 1000), { timeout: 30_000 }).toBeGreaterThan(15)
  if (shots) {
    await controls.getByRole('button', { name: 'Close picture in picture' }).hover()
    await bob.win.screenshot({ path: `${shots}/pip-1-controls.png` })
  }

  // Minimized: the stream keeps playing there, so Alice doesn't see Bob as "not looking".
  await setWindowState(bob, 'minimized')
  await bob.win.waitForTimeout(1500)
  await expect(alice.win.locator('.room-members .member', { hasText: 'Bob' })).not.toContainText('not looking')
  expect(await pipFramesDuring(bob.win, 2000)).toBeGreaterThan(30)
  await setWindowState(bob, 'restored')

  // Back to the grid: the tile is re-created, picture-in-picture stays.
  await bob.win.keyboard.press('Escape')
  await bob.win.waitForTimeout(500)
  expect(await inPip(bob.win)).toBe(true)

  // Closed from the stream's right-click menu: minimizing pauses the video again.
  await bob.win.locator('.stream-tile').first().click({ button: 'right' })
  if (shots) await bob.win.screenshot({ path: `${shots}/pip-2-menu.png` })
  await bob.win.getByRole('menu', { name: "Alice's stream" }).getByRole('menuitem', { name: 'Close picture in picture' }).click()
  await expect.poll(() => inPip(bob.win)).toBe(false)
  await setWindowState(bob, 'minimized')
  await expect(alice.win.locator('.room-members .member', { hasText: 'Bob' })).toContainText('not looking (video paused)')
  await setWindowState(bob, 'restored')

  // Stopping watching closes it.
  await bob.win.locator('.stream-tile').first().click({ button: 'right' })
  await bob.win.getByRole('menu', { name: "Alice's stream" }).getByRole('menuitem', { name: 'Picture in picture' }).click()
  await expect.poll(() => inPip(bob.win)).toBe(true)
  await bob.win.locator('.stream-tile').first().click({ button: 'right' })
  await bob.win.getByRole('menu', { name: "Alice's stream" }).getByRole('menuitem', { name: 'Stop watching' }).click()
  await expect.poll(() => inPip(bob.win)).toBe(false)
})

// The TCP fallback's picture comes from a MediaStreamTrackGenerator: it plays in picture-in-picture too.
test('picture-in-picture works on the TCP fallback', async ({ people }) => {
  const [alice, bob] = await people(2)
  await bob.win.evaluate(() => window.api.settings.update({ forceTcp: true }))
  await bob.win.reload() // the room reads the settings at startup
  await bob.win.waitForSelector('.rooms-sidebar')

  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await bob.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect(bob.win.locator('.stat-badge', { hasText: 'TCP' }).or(bob.win.locator('.stream-tile video'))).toBeVisible()

  await bob.win.locator('.stream-tile').first().click({ button: 'right' })
  await bob.win.getByRole('menu', { name: "Alice's stream" }).getByRole('menuitem', { name: 'Picture in picture' }).click()
  await expect.poll(() => inPip(bob.win)).toBe(true)
  await setWindowState(bob, 'minimized')
  await bob.win.waitForTimeout(1500) // the server resumes video from a keyframe
  await expect.poll(() => pipFramesDuring(bob.win, 1000), { timeout: 15_000 }).toBeGreaterThan(15)
  await setWindowState(bob, 'restored')
})
