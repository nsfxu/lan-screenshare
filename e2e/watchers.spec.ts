import { createRoom, decodedFrames, expect, joinByIp, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test("streams show who's watching; only streams; a muted stream says so", async ({ people }) => {
  const [alice, bob, carol] = await people(3)
  const port = await createRoom(alice, 'public', { audio: true })
  await joinByIp(bob, port)
  await joinByIp(carol, port)
  const { win } = bob

  // Bob and Carol watch Alice: her stream shows the two of them.
  await carol.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect.poll(() => decodedFrames(win), { timeout: 30_000 }).toBeGreaterThan(10)
  const watchers = win.locator('.spotlight-main .tile-watchers')
  await expect(watchers).toHaveAttribute('aria-label', /^2 watching: /)
  await expect(watchers).toHaveAttribute('title', /Bob \(you\)/)
  await expect(watchers).toHaveAttribute('title', /Carol/)
  await expect(watchers.locator('.avatar')).toHaveCount(2)
  // Alice sees the same on her own tile.
  await expect(alice.win.locator('.person-tile', { hasText: 'Alice' })).toContainText('2 watching')

  // Muting her shows a crossed-out speaker by her name.
  await expect(win.locator('.spotlight-main .tile-muted')).toHaveCount(0)
  await win.getByRole('button', { name: 'Mute Alice' }).click()
  await expect(win.locator('.spotlight-main .tile-muted')).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/1-watchers-muted.png` })
  await win.getByRole('button', { name: 'Unmute Alice' }).click()
  await expect(win.locator('.spotlight-main .tile-muted')).toHaveCount(0)

  // Only streams: Bob and Carol leave the stage (Alice's stream gets it all), and it's remembered.
  await win.keyboard.press('Escape')
  await expect(win.locator('.stage-grid > .tile')).toHaveCount(3)
  await win.locator('.control-bar').getByRole('button', { name: 'Only streams' }).click()
  await expect(win.locator('.stage-grid > .tile')).toHaveCount(1)
  if (shots) await win.screenshot({ path: `${shots}/2-only-streams.png` })
  expect(await win.evaluate(() => localStorage.getItem('layout.stage-filter'))).toBe('streams')

  // The same switch is in the right-click menu (Carol's window).
  await carol.win.keyboard.press('Escape')
  await carol.win.locator('.person-tile', { hasText: 'Carol' }).click({ button: 'right' })
  await carol.win.getByRole('menuitem', { name: 'Show only streams' }).click()
  await expect(carol.win.locator('.stage-grid > .tile')).toHaveCount(1)
  await carol.win.locator('.stream-tile').click({ button: 'right' })
  await carol.win.getByRole('menuitem', { name: 'Show everyone' }).click()
  await expect(carol.win.locator('.stage-grid > .tile')).toHaveCount(3)
})
