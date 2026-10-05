import { createRoom, expect, framesDuring, joinByIp, setWindowState, test } from './fixtures'

// A viewer who can't see a stream (window minimized, or another tile full
// screen) gets no video from it until they can again (see HIDDEN_VIEW).
test("viewers who can't see a stream get no video until they can", async ({ people }) => {
  const [alice, bob, carol] = await people(3)

  const port = await createRoom(alice)
  await joinByIp(carol, port)
  await carol.win.getByRole('button', { name: 'Share screen' }).first().click()
  await carol.win.locator('.modal .source', { hasText: 'Fake screen' }).click()
  await carol.win.locator('.modal').getByRole('button', { name: 'Share', exact: true }).click()
  await joinByIp(bob, port)
  await bob.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await bob.win.getByRole('button', { name: "Watch Carol's stream" }).click()
  for (const name of ['Alice', 'Carol']) {
    await expect.poll(() => framesDuring(bob.win, name, 1000), { timeout: 30_000 }).toBeGreaterThan(15)
  }

  // Minimized: both streams pause, and the streamers see why.
  await setWindowState(bob, 'minimized')
  await expect(alice.win.locator('.room-members .member', { hasText: 'Bob' })).toContainText('not looking (video paused)')
  await bob.win.waitForTimeout(1000) // frames already in flight
  expect(await framesDuring(bob.win, 'Alice', 3000)).toBeLessThanOrEqual(2)
  expect(await framesDuring(bob.win, 'Carol', 3000)).toBeLessThanOrEqual(2)

  // Restored: video comes back for both.
  await setWindowState(bob, 'restored')
  for (const name of ['Alice', 'Carol']) {
    await expect.poll(() => framesDuring(bob.win, name, 1000), { timeout: 15_000 }).toBeGreaterThan(15)
  }
  await expect(alice.win.locator('.room-members .member', { hasText: 'Bob' })).not.toContainText('not looking')

  // Alice's tile full screen: Carol's can't be seen and pauses; Alice's keeps playing.
  // (Simulated: real full screen would take over the screen and the focus.)
  const fullscreen = (on: boolean) =>
    bob.win.evaluate((enter) => {
      const tile = [...document.querySelectorAll('.tile')].find((t) => t.querySelector('.tile-name')?.textContent?.includes('Alice'))
      const viewer = enter ? tile?.querySelector('.screen-viewer') ?? null : null
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => viewer })
      document.dispatchEvent(new Event('fullscreenchange'))
    }, on)
  await fullscreen(true)
  await expect(carol.win.locator('.room-members .member', { hasText: 'Bob' })).toContainText('not looking (video paused)')
  await bob.win.waitForTimeout(1000)
  expect(await framesDuring(bob.win, 'Carol', 3000)).toBeLessThanOrEqual(2)
  expect(await framesDuring(bob.win, 'Alice', 2000)).toBeGreaterThan(20)

  await fullscreen(false)
  await expect.poll(() => framesDuring(bob.win, 'Carol', 1000), { timeout: 15_000 }).toBeGreaterThan(15)
})
