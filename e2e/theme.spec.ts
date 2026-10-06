import { createRoom, decodedFrames, expect, joinByIp, test } from './fixtures'

const shots = process.env.E2E_SHOTS

/** Background colour of the page, as drawn. */
const background = (win: import('@playwright/test').Page): Promise<string> =>
  win.evaluate(() => getComputedStyle(document.body).backgroundColor)

test('themes are chosen in Settings, apply at once and stay after a restart', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await bob.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect.poll(() => decodedFrames(bob.win), { timeout: 30_000 }).toBeGreaterThan(10)

  const { win } = bob
  expect(await background(win)).toBe('rgb(15, 17, 21)') // Classic
  for (const [theme, rgb] of [
    ['Graphite', 'rgb(17, 18, 20)'],
    ['Midnight', 'rgb(11, 18, 32)'],
    ['Charcoal', 'rgb(18, 16, 22)'],
    ['Classic', 'rgb(15, 17, 21)']
  ] as const) {
    await win.getByRole('button', { name: 'Settings' }).click()
    await win.getByRole('radio', { name: new RegExp(`^${theme}`) }).click()
    await expect(win.getByRole('radio', { name: new RegExp(`^${theme}`) })).toHaveAttribute('aria-checked', 'true')
    if (shots && theme === 'Graphite') await win.screenshot({ path: `${shots}/settings.png` })
    await win.keyboard.press('Escape')
    await expect.poll(() => background(win)).toBe(rgb)
    if (shots) {
      await win.waitForTimeout(400) // let button colour transitions finish
      await win.screenshot({ path: `${shots}/${theme.toLowerCase()}.png` })
    }
  }

  // Remembered: a new window starts in the chosen theme.
  await win.getByRole('button', { name: 'Settings' }).click()
  await win.getByRole('radio', { name: /^Midnight/ }).click()
  await win.keyboard.press('Escape')
  await win.reload()
  await win.waitForSelector('.rooms-sidebar')
  expect(await background(win)).toBe('rgb(11, 18, 32)')
})
