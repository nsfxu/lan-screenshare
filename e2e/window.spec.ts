import type { Page } from '@playwright/test'
import { createRoom, decodedFrames, expect, joinByIp, setWindowState, test } from './fixtures'

const shots = process.env.E2E_SHOTS

/** Frames the stream's own window has decoded so far. */
const windowFrames = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelector('video')?.getVideoPlaybackQuality().totalVideoFrames ?? 0)

test('a stream opens in its own window, keeps playing when the room is minimized, and comes back', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
  const { win, app } = bob
  await win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect.poll(() => decodedFrames(win), { timeout: 30_000 }).toBeGreaterThan(10)

  // The focused stream's "New window" button opens it in a window of its own.
  const opened = app.waitForEvent('window')
  await win.locator('.stage-controls').getByRole('button', { name: 'Open in a new window' }).click()
  const popup = await opened
  await expect.poll(() => windowFrames(popup), { timeout: 20_000 }).toBeGreaterThan(10)
  await expect(popup).toHaveTitle("Alice's stream · ScreenShare")
  // It looks like the app: its title bar, the theme, and the same controls.
  await expect(popup.locator('.title-bar')).toContainText("Alice's stream")
  await expect(popup.getByRole('button', { name: 'Back to the room' })).toBeAttached()
  await expect(popup.getByRole('button', { name: 'Full screen' })).toBeAttached()
  const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme)
  expect(await themeOf(popup)).toBe(await themeOf(win))
  await expect(win.locator('.spotlight-main')).toContainText('Playing in another window')
  await expect(win.locator('.spotlight-main video')).toHaveCount(0)
  await expect(win.locator('.stage-controls').getByRole('button', { name: 'Back to this window' })).toBeVisible()
  if (shots) {
    await popup.screenshot({ path: `${shots}/1-stream-window.png` })
    await win.screenshot({ path: `${shots}/2-room-while-in-window.png` })
  }

  // Like the room's window, it's hidden from screen capture while watching (Windows and macOS: the
  // system feature doesn't exist on Linux, where both report false).
  if (process.platform !== 'linux') {
    const protectedWindows = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => w.isContentProtected())
    )
    expect(protectedWindows).toEqual([true, true])
  }

  // Minimizing the room's window doesn't pause it: it's still on screen.
  await setWindowState(bob, 'minimized')
  const before = await windowFrames(popup)
  await expect.poll(async () => (await windowFrames(popup)) - before, { timeout: 10_000 }).toBeGreaterThan(20)
  await setWindowState(bob, 'restored')

  // Changing the theme changes it there too.
  await win.getByRole('button', { name: 'Settings' }).first().click()
  await win.locator('.theme-option', { hasText: 'Midnight' }).click()
  await win.keyboard.press('Escape')
  await expect.poll(() => themeOf(popup)).toBe('midnight')
  if (shots) await popup.screenshot({ path: `${shots}/3-stream-window-midnight.png` })

  // "Back to the room" brings the stream back to its tile and closes the window.
  await popup.mouse.move(300, 300)
  await popup.getByRole('button', { name: 'Back to the room' }).click()
  await expect(win.locator('.spotlight-main video')).toHaveCount(1)
  await expect.poll(() => app.windows().length).toBe(1)
  const back = await decodedFrames(win)
  await expect.poll(() => decodedFrames(win), { timeout: 15_000 }).toBeGreaterThan(back + 10)
})
