import { cornerColour, createRoom, decodedFrames, expect, FAKE_SCREEN_RGB, joinByIp, closeFloatingChat, openChat, sendChat, test } from './fixtures'

test('public room: share, watch, chat and stop', async ({ people }) => {
  const [alice, bob] = await people(2)

  const port = await createRoom(alice)
  // Alice's own tile offers her stream; it doesn't play until she asks.
  await expect(alice.win.getByRole('button', { name: 'Show your own stream' })).toBeVisible()

  await joinByIp(bob, port)
  await expect(bob.win.locator('.room')).toBeVisible()
  await expect(bob.win.locator('.room-members')).toContainText('Alice')

  // Nothing plays until Bob chooses Alice's stream.
  await expect(bob.win.locator('.tile video')).toHaveCount(0)
  await bob.win.getByRole('button', { name: "Watch Alice's stream" }).click()

  // Real frames arrive, and they are Alice's (fake) screen.
  await expect.poll(() => decodedFrames(bob.win), { timeout: 30_000 }).toBeGreaterThan(30)
  const before = await decodedFrames(bob.win)
  await expect.poll(() => decodedFrames(bob.win)).toBeGreaterThan(before + 10)
  const colour = await cornerColour(bob.win)
  expect(colour).not.toBeNull()
  colour!.forEach((c, i) => expect(Math.abs(c - FAKE_SCREEN_RGB[i])).toBeLessThanOrEqual(16))
  await expect(alice.win.locator('.room-members')).toContainText('Bob')

  // Chat both ways.
  await sendChat(bob, 'hello from Bob')
  await openChat(alice)
  await expect(alice.win.locator('.chat-text', { hasText: 'hello from Bob' })).toBeVisible()
  await sendChat(alice, 'hi Bob')
  await expect(bob.win.locator('.chat-text', { hasText: 'hi Bob' })).toBeVisible()
  await closeFloatingChat(alice)

  // Alice stops: Bob's tile and her stream card go away.
  await alice.win.getByRole('button', { name: 'Stop sharing' }).click()
  await expect(bob.win.locator('.tile video')).toHaveCount(0)
  await expect(bob.win.getByRole('button', { name: "Watch Alice's stream" })).toHaveCount(0)
  await expect(bob.win.locator('.person-tile', { hasText: 'Alice' })).toBeVisible()
})

test('private room: a wrong PIN is refused, the right one lets you in', async ({ people }) => {
  const [alice, bob] = await people(2)

  const port = await createRoom(alice, 'private')
  const pin = await alice.win.evaluate(() => window.api.host.get().then((h) => h?.pin ?? ''))
  expect(pin).toMatch(/^\d{4,6}$/)
  const wrong = pin
    .split('')
    .map((d) => String((Number(d) + 1) % 10))
    .join('')

  await joinByIp(bob, port)
  // The PIN is asked right under the room in the list.
  const dialog = bob.win.locator('.pin-form')
  await dialog.getByLabel('Room PIN').fill(wrong)
  await dialog.getByRole('button', { name: 'Join' }).click()
  await expect(dialog.locator('.error-text')).toContainText('Wrong PIN')
  if (process.env.E2E_SHOTS) await bob.win.screenshot({ path: `${process.env.E2E_SHOTS}/4-pin.png` })
  await expect(bob.win.locator('.room')).toHaveCount(0)

  await dialog.getByLabel('Room PIN').fill(pin)
  await dialog.getByRole('button', { name: 'Join' }).click()
  await expect(bob.win.locator('.room')).toBeVisible()
  await expect(alice.win.locator('.room-members')).toContainText('Bob')
})
