import { createRoom, expect, joinByIp, test, type Person } from './fixtures'

/** Whether the app holds a power save blocker (the app starts at most one; ids count up from 0). */
function keepsAwake(person: Person): Promise<boolean> {
  return person.app.evaluate(({ powerSaveBlocker }) =>
    Array.from({ length: 50 }, (_, id) => id).some((id) => powerSaveBlocker.isStarted(id))
  )
}

test('the screen is kept awake while sharing or watching, and allowed to sleep after', async ({ people }) => {
  const [alice, bob] = await people(2)
  expect(await keepsAwake(alice)).toBe(false)

  // Sharing keeps it awake.
  const port = await createRoom(alice)
  await expect.poll(() => keepsAwake(alice)).toBe(true)

  // Being in a room isn't enough: watching is.
  await joinByIp(bob, port)
  await expect(bob.win.locator('.room')).toBeVisible()
  expect(await keepsAwake(bob)).toBe(false)
  await bob.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect.poll(() => keepsAwake(bob)).toBe(true)

  // Leaving lets it sleep again, and so does a reload (the page can't say it's done).
  await bob.win.getByRole('button', { name: 'Leave', exact: true }).click()
  await expect.poll(() => keepsAwake(bob)).toBe(false)
  await alice.win.reload()
  await expect.poll(() => keepsAwake(alice)).toBe(false)
})
