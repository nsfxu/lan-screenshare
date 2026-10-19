import { expect, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('Settings shows one section at a time, chosen from the list on the side', async ({ people }) => {
  const [alice] = await people(1)
  const { win } = alice
  await win.getByRole('button', { name: 'Settings' }).click()
  const nav = win.getByRole('navigation', { name: 'Settings sections' })
  await expect(nav.getByRole('button')).toHaveText(['Profile', 'Appearance', 'Sharing', 'General', 'Advanced', 'About'])
  await expect(nav.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'true')
  await expect(win.getByLabel('Display name')).toBeVisible()
  await expect(win.getByText('Rejoin last room on startup')).toHaveCount(0)
  if (shots) await win.screenshot({ path: `${shots}/1-settings.png` })

  // General holds what Notifications and Connection used to.
  await nav.getByRole('button', { name: 'General' }).click()
  await expect(nav.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'true')
  await expect(win.getByRole('checkbox', { name: 'Rejoin last room on startup' })).toBeVisible()
  await expect(win.getByRole('checkbox', { name: /^Chat notifications/ })).toBeVisible()
  await expect(win.getByLabel('Hosting port')).toBeVisible()
  await expect(win.getByLabel('Display name')).toHaveCount(0)

  // Sharing explains the choice that's made, and Advanced what Automatic sends with.
  await nav.getByRole('button', { name: 'Sharing' }).click()
  await expect(win.locator('#content-hint-hint')).toHaveText('Smooth for fullscreen games and videos, sharp text otherwise.')
  await win.getByLabel('Optimize for').selectOption('detail')
  await expect(win.locator('#content-hint-hint')).toHaveText('Keeps the resolution and lowers the frame rate when needed.')
  await nav.getByRole('button', { name: 'Advanced' }).click()
  await expect(win.locator('#codec-hint')).toHaveText(/^Automatic usually sends (H\.264|H\.265|VP8|VP9|AV1), encoded by /)
  await expect(win.getByText('Restart needed')).toBeVisible()

  await nav.getByRole('button', { name: 'About' }).click()
  await expect(win.getByRole('button', { name: 'Open logs' })).toBeInViewport()
  if (shots) await win.screenshot({ path: `${shots}/2-settings-about.png` })
})
