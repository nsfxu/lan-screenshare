import { cornerColour, createRoom, decodedFrames, expect, FAKE_SCREEN_RGB, joinByIp, sendChat, test } from './fixtures'

test('public room: share, watch, chat and stop', async ({ people }) => {
  const [alice, bob] = await people(2)

  const port = await createRoom(alice)
  await expect(alice.win.locator('.stream-card', { hasText: 'You' })).toBeVisible()

  await joinByIp(bob, port)
  await expect(bob.win.locator('.room')).toBeVisible()
  await expect(bob.win.locator('.viewer-list')).toContainText('Alice')

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
  await expect(alice.win.locator('.viewer-list')).toContainText('Bob')

  // Chat both ways.
  await sendChat(bob, 'hello from Bob')
  await expect(alice.win.locator('.chat-text', { hasText: 'hello from Bob' })).toBeVisible()
  await sendChat(alice, 'hi Bob')
  await expect(bob.win.locator('.chat-text', { hasText: 'hi Bob' })).toBeVisible()

  // Alice stops: Bob's tile and her stream card go away.
  await alice.win.getByRole('button', { name: 'Stop sharing' }).click()
  await expect(bob.win.locator('.tile video')).toHaveCount(0)
  await expect(bob.win.locator('.stream-card', { hasText: 'Alice' })).toHaveCount(0)
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
  const dialog = bob.win.locator('.modal')
  await dialog.getByLabel('Room PIN').fill(wrong)
  await dialog.getByRole('button', { name: 'Join' }).click()
  await expect(dialog.locator('.notice.error')).toBeVisible()
  await expect(bob.win.locator('.room')).toHaveCount(0)

  await dialog.getByLabel('Room PIN').fill(pin)
  await dialog.getByRole('button', { name: 'Join' }).click()
  await expect(bob.win.locator('.room')).toBeVisible()
  await expect(alice.win.locator('.viewer-list')).toContainText('Bob')
})
