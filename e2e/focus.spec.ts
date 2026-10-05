import { createRoom, decodedFrames, expect, joinByIp, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('click a tile to focus it, click again for the grid; the others can be put away', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
  const { win } = bob
  await win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect.poll(() => decodedFrames(win), { timeout: 30_000 }).toBeGreaterThan(10)
  const aliceVideo = win.locator('.tile', { has: win.locator('video') }).locator('.screen-viewer')

  // One click focuses, another goes back to the grid.
  await aliceVideo.click()
  await expect(win.locator('.spotlight-main video')).toHaveCount(1)
  await win.locator('.spotlight-main .screen-viewer').click()
  await expect(win.locator('.stage-spotlight')).toHaveCount(0)

  // A double-click still zooms, without focusing.
  await aliceVideo.dblclick()
  await expect(win.locator('.zoom-label')).toHaveText('200%')
  await win.waitForTimeout(400)
  await expect(win.locator('.stage-spotlight')).toHaveCount(0)
  await aliceVideo.dblclick()
  await expect(win.locator('.zoom-label')).toHaveText('100%')

  // Focus his own picture: Alice's stream goes to the strip, and the grid button appears.
  await win.locator('.person-tile', { hasText: 'Bob (you)' }).click()
  await expect(win.locator('.spotlight-strip video')).toHaveCount(1)
  await expect(win.getByRole('button', { name: 'Grid view' })).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/1-focus-strip.png` })

  // Putting the strip away pauses Alice's video to him; she sees it.
  await win.getByRole('button', { name: 'Hide others' }).click()
  await expect(win.locator('.spotlight-strip')).toBeHidden()
  const bobOnAlice = alice.win.locator('.room-members .member', { hasText: 'Bob' })
  await expect(bobOnAlice).toContainText('not looking (video paused)', { timeout: 15_000 })
  if (shots) await win.screenshot({ path: `${shots}/2-strip-hidden.png` })
  await win.getByRole('button', { name: 'Show others (1)' }).click()
  await expect(bobOnAlice).not.toContainText('not looking', { timeout: 15_000 })

  await win.getByRole('button', { name: 'Grid view' }).click()
  await expect(win.locator('.stage-spotlight')).toHaveCount(0)
})
