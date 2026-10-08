import { createRoom, decodedFrames, expect, joinByIp, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('people are listed under the room: watch from the list, see a preview, and the host can remove someone', async ({
  people
}) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  await joinByIp(bob, port)

  const members = bob.win.locator('.room-members')
  await expect(members.locator('.member')).toHaveCount(2)
  await expect(members.locator('.member', { hasText: 'Alice' })).toContainText('host')
  await expect(members.locator('.member', { hasText: 'Alice' }).locator('.live-badge')).toHaveText('Live')
  await expect(members.locator('.member', { hasText: 'Bob' })).toContainText('(you)')

  // Hovering Alice shows her stream's latest preview; clicking starts watching.
  const aliceRow = bob.win.getByRole('button', { name: 'Alice, live' })
  await aliceRow.hover()
  await expect(bob.win.locator('.member-preview')).toContainText('Click to watch')
  await expect(bob.win.locator('.member-preview img')).toBeVisible({ timeout: 15_000 })
  if (shots) await bob.win.screenshot({ path: `${shots}/1-preview.png` })
  await aliceRow.click()
  await expect(aliceRow).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => decodedFrames(bob.win), { timeout: 30_000 }).toBeGreaterThan(10)

  // Alice sees Bob watching her, with how it's going.
  await expect(alice.win.locator('.room-members .member', { hasText: 'Bob' })).toContainText('watching you', {
    timeout: 15_000
  })
  if (shots) await alice.win.screenshot({ path: `${shots}/2-host-list.png` })

  // Clicking again stops watching.
  await aliceRow.click()
  await expect(aliceRow).toHaveAttribute('aria-pressed', 'false')
  await expect(bob.win.locator('.tile video')).toHaveCount(0)

  // The host removes Bob from the menu next to his name.
  await alice.win.getByRole('button', { name: 'Moderate Bob' }).click()
  if (shots) await alice.win.screenshot({ path: `${shots}/3-host-menu.png` })
  await alice.win.getByRole('menuitem', { name: 'Remove from room' }).click()
  // The app's own dialog asks first.
  const ask = alice.win.getByRole('dialog', { name: 'Remove Bob from the room?' })
  await expect(ask).toContainText("They can't come back to this room.")
  if (shots) await alice.win.screenshot({ path: `${shots}/4-confirm.png` })
  await ask.getByRole('button', { name: 'Remove' }).click()
  await expect(bob.win.locator('.welcome')).toBeVisible()
  await expect(alice.win.locator('.room-members .member')).toHaveCount(1)
})
