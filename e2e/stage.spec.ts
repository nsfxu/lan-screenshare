import { createRoom, decodedFrames, expect, joinByIp, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('everyone has a tile: watch from it, focus it, and find the room details behind ⓘ', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)

  // Alone: her own tile (sharing, not shown) and how to invite people.
  await expect(alice.win.locator('.invite-tile')).toContainText('Invite people')
  await expect(alice.win.getByRole('button', { name: 'Show your own stream' })).toBeVisible()
  if (shots) await alice.win.screenshot({ path: `${shots}/1-alone.png` })

  await joinByIp(bob, port)
  await expect(alice.win.locator('.invite-tile')).toHaveCount(0)
  await expect(bob.win.locator('.stage-grid > .tile')).toHaveCount(2)
  await expect(bob.win.locator('.person-tile', { hasText: 'Bob (you)' })).toBeVisible()
  // No room header: the room's name is in the title bar.
  await expect(bob.win.locator('.room-header')).toHaveCount(0)
  await expect(bob.win.locator('.title-bar-room')).toContainText("Alice's room")
  const aliceTile = bob.win.locator('.person-tile', { hasText: 'Alice' })
  await expect(aliceTile.locator('.live-badge')).toHaveText('Live')
  if (shots) await bob.win.screenshot({ path: `${shots}/2-tiles.png` })

  // Watching turns Alice's tile into her stream, and the first stream watched opens focused, the others below.
  await bob.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect.poll(() => decodedFrames(bob.win), { timeout: 30_000 }).toBeGreaterThan(10)
  await expect(bob.win.locator('.spotlight-main video')).toHaveCount(1)
  await expect(bob.win.locator('.spotlight-strip .person-tile', { hasText: 'Bob' })).toBeVisible()
  if (shots) await bob.win.screenshot({ path: `${shots}/3-focus.png` })
  // Esc goes back to the grid; a click focuses again.
  await bob.win.keyboard.press('Escape')
  await expect(bob.win.locator('.stage-spotlight')).toHaveCount(0)
  await expect(bob.win.locator('.stage-grid > .tile')).toHaveCount(2)
  await bob.win.locator('.stream-tile').click()
  await expect(bob.win.locator('.spotlight-main video')).toHaveCount(1)
  await bob.win.keyboard.press('Escape')

  // ⓘ, now in the control bar: the address for everyone; privacy, PIN and End room for the host.
  await expect(bob.win.locator('.stage-controls').getByRole('button', { name: 'Room details' })).toBeVisible()
  await bob.win.getByRole('button', { name: 'Room details' }).click()
  await expect(bob.win.locator('.room-info')).toContainText(`127.0.0.1:${port}`)
  await expect(bob.win.locator('.room-info').getByRole('button', { name: /End room/ })).toHaveCount(0)
  await bob.win.keyboard.press('Escape')
  await expect(bob.win.locator('.room-info')).toHaveCount(0)

  await alice.win.getByRole('button', { name: 'Room details' }).click()
  const info = alice.win.locator('.room-info')
  await info.getByRole('button', { name: 'Private' }).click()
  await expect(info.locator('.pin-box')).toBeVisible()
  if (shots) await alice.win.screenshot({ path: `${shots}/4-room-info.png` })
  await expect(info.getByRole('button', { name: 'End room for everyone' })).toBeVisible()
})
