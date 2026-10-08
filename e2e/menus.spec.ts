import { createRoom, decodedFrames, expect, joinByIp, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('the Sharing button and right-click menus hold the sharing and watching options', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  const { win } = alice

  // The Sharing button opens the sharing menu (with the stats); nothing pauses from it. Leaving is last.
  const sharingButton = win.getByRole('button', { name: 'Sharing', exact: true })
  const hangUp = await win.locator('.hang-up').boundingBox()
  expect(hangUp!.x).toBeGreaterThan((await sharingButton.boundingBox())!.x)
  await sharingButton.click()
  const menu = win.getByRole('menu', { name: 'Sharing' })
  await expect(menu.getByRole('menuitem', { name: 'Stop sharing' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Stream stats' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Change source…' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Pause' })).toHaveCount(0)
  if (shots) await win.screenshot({ path: `${shots}/1-sharing-menu.png` })
  await menu.getByRole('menuitemradio', { name: '720p @ 30 fps' }).click()
  await sharingButton.click()
  await expect(menu.getByRole('menuitemradio', { name: '720p @ 30 fps' })).toHaveAttribute('aria-checked', 'true')
  await win.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // Right-click on her own tile: show her stream, and the same sharing options.
  await win.locator('.person-tile', { hasText: 'Alice (you)' }).click({ button: 'right' })
  const own = win.getByRole('menu', { name: 'Your stream' })
  await expect(own.getByRole('menuitem', { name: 'Stop sharing' })).toBeVisible()
  await own.getByRole('menuitem', { name: 'Show my stream' }).click()
  await expect(win.locator('.tile video')).toHaveCount(1)

  // Bob, on Alice's tile: watch, then pick the quality he receives and stop, all by right-click.
  await joinByIp(bob, port)
  await bob.win.locator('.person-tile', { hasText: 'Alice' }).click({ button: 'right' })
  await bob.win.getByRole('menuitem', { name: 'Watch stream' }).click()
  await expect.poll(() => decodedFrames(bob.win), { timeout: 30_000 }).toBeGreaterThan(10)
  await bob.win.locator('.tile', { has: bob.win.locator('video') }).click({ button: 'right' })
  const theirs = bob.win.getByRole('menu', { name: "Alice's stream" })
  await expect(theirs.getByRole('menuitem', { name: 'Full screen' })).toBeVisible()
  if (shots) await bob.win.screenshot({ path: `${shots}/2-stream-menu.png` })
  await theirs.getByRole('menuitemradio', { name: '480p · 30 fps' }).click()
  await bob.win.locator('.tile', { has: bob.win.locator('video') }).click({ button: 'right' })
  await expect(theirs.getByRole('menuitemradio', { name: '480p · 30 fps' })).toHaveAttribute('aria-checked', 'true')
  await theirs.getByRole('menuitem', { name: 'Stop watching' }).click()
  await expect(bob.win.locator('.tile video')).toHaveCount(0)

  // The host's menu on Bob's tile has the moderation actions.
  await win.locator('.person-tile', { hasText: 'Bob' }).click({ button: 'right' })
  await expect(win.getByRole('menuitem', { name: 'Remove from room' })).toBeVisible()
  await win.keyboard.press('Escape')

  // Stop sharing, from the Sharing button's menu.
  await win.getByRole('button', { name: 'Sharing', exact: true }).click()
  await win.getByRole('menuitem', { name: 'Stop sharing' }).click()
  await expect(win.getByRole('button', { name: 'Share screen' })).toBeVisible()
})
