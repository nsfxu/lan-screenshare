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
    ['Light', 'rgb(245, 246, 248)'],
    ['Classic', 'rgb(15, 17, 21)']
  ] as const) {
    await win.getByRole('button', { name: 'Settings' }).click()
    await win.getByRole('button', { name: 'Appearance' }).click()
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
  await win.getByRole('button', { name: 'Appearance' }).click()
  await win.getByRole('radio', { name: /^Midnight/ }).click()
  await win.keyboard.press('Escape')
  await win.reload()
  await win.waitForSelector('.rooms-sidebar')
  expect(await background(win)).toBe('rgb(11, 18, 32)')
})

test("Match my computer switches between a dark and a light theme with the computer's mode", async ({ people }) => {
  const [{ win }] = await people(1)
  await win.emulateMedia({ colorScheme: 'dark' })
  await win.getByRole('button', { name: 'Settings' }).click()
  await win.getByRole('button', { name: 'Appearance' }).click()
  await win.getByRole('radio', { name: /^Forest/ }).click()

  // Turning it on keeps Forest as the dark theme; Light is the light one until another is picked.
  await win.getByRole('checkbox', { name: /^Match my computer/ }).check()
  const dark = win.getByRole('radiogroup', { name: 'Dark, in dark mode' })
  const light = win.getByRole('radiogroup', { name: 'Light, in light mode' })
  await expect(dark.getByRole('radio', { name: /^Forest/ })).toHaveAttribute('aria-checked', 'true')
  await expect(light.getByRole('radio', { name: /^Light/ })).toHaveAttribute('aria-checked', 'true')
  await light.getByRole('radio', { name: /^Paper/ }).click()
  await expect(light.getByRole('radio', { name: /^Paper/ })).toHaveAttribute('aria-checked', 'true')
  await expect(dark.getByRole('radio', { name: /^Forest/ })).toHaveAttribute('aria-checked', 'true')
  if (shots) await win.screenshot({ path: `${shots}/follow-system.png` })
  await win.keyboard.press('Escape')
  await expect.poll(() => background(win)).toBe('rgb(13, 20, 16)') // Forest

  // The computer goes light, then dark again: the app follows at once.
  await win.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => background(win)).toBe('rgb(246, 241, 233)') // Paper
  await win.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => background(win)).toBe('rgb(13, 20, 16)')

  // Turning it off keeps what's on screen.
  await win.emulateMedia({ colorScheme: 'light' })
  await win.getByRole('button', { name: 'Settings' }).click()
  await win.getByRole('button', { name: 'Appearance' }).click()
  await win.getByRole('checkbox', { name: /^Match my computer/ }).uncheck()
  await expect(win.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { checked: true })).toHaveAccessibleName(/^Paper/)
  await win.keyboard.press('Escape')
  await win.emulateMedia({ colorScheme: 'dark' })
  await win.waitForTimeout(300)
  expect(await background(win)).toBe('rgb(246, 241, 233)')
})
