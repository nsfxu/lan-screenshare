import { expect, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('Settings lists its sections on the side: a click jumps there, scrolling follows', async ({ people }) => {
  const [alice] = await people(1)
  const { win } = alice
  await win.getByRole('button', { name: 'Settings' }).click()
  const nav = win.getByRole('navigation', { name: 'Settings sections' })
  await expect(nav.getByRole('button')).toHaveText(['Profile', 'Appearance', 'Sharing', 'Notifications', 'Connection', 'Advanced', 'About'])
  await expect(nav.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'true')
  if (shots) await win.screenshot({ path: `${shots}/1-settings.png` })

  // Jump to Connection: its options come into view and it's the current section.
  await nav.getByRole('button', { name: 'Connection' }).click()
  await expect(win.getByText('Rejoin last room on startup')).toBeInViewport()
  await expect(nav.getByRole('button', { name: 'Connection' })).toHaveAttribute('aria-current', 'true')

  // Scrolling to the end makes About current (once the jump's scrolling is over).
  await win.waitForTimeout(800)
  // (In a short window, the jump to Connection may already be at the end: start from the top.)
  await win.locator('.settings').evaluate((el) => el.scrollTo({ top: 0 }))
  await expect(nav.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'true')
  await win.locator('.settings').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(nav.getByRole('button', { name: 'About' })).toHaveAttribute('aria-current', 'true')
  await expect(win.getByRole('button', { name: 'Open logs' })).toBeInViewport()
  if (shots) await win.screenshot({ path: `${shots}/2-settings-about.png` })
})
