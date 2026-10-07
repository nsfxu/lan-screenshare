import { createRoom, expect, setForeground, test } from './fixtures'

// "Optimize for: Automatic" (the default): smooth motion while a fullscreen
// window is in front on the shared screen, sharp text otherwise.
test('automatic quality follows a fullscreen app in front of the shared screen', async ({ people }) => {
  const [alice] = await people(1)
  await createRoom(alice) // shares the fake screen, on display "fake"
  await alice.win.getByRole('button', { name: 'Stats' }).click()
  const mode = alice.win.locator('.stats-panel div', { hasText: 'Optimized for' }).locator('dd')

  // Nothing reported yet: smooth motion, as before this setting existed.
  await expect(mode).toHaveText('Smooth motion (automatic)')

  // The whole computer's CPU and memory sit next to the app's.
  const row = (name: string) => alice.win.locator('.stats-panel div', { hasText: name }).locator('dd')
  await expect(row('CPU (computer)')).toHaveText(/^\d+ %$/)
  await expect(row('Memory (computer)')).toHaveText(/^\d+\.\d of \d+\.\d GB$/)

  await setForeground(alice, { hidden: false, windowId: 'window:1:0', fullscreen: false, displayId: 'fake' })
  await expect(mode).toHaveText('Sharp text (automatic)')

  await setForeground(alice, { hidden: true, windowId: 'window:2:0', fullscreen: true, displayId: 'fake' })
  await expect(mode).toHaveText('Smooth motion (automatic)')

  // A fullscreen game on another screen doesn't count.
  await setForeground(alice, { hidden: true, windowId: 'window:3:0', fullscreen: true, displayId: 'other' })
  await expect(mode).toHaveText('Sharp text (automatic)')

  // Automatic is the default; a fixed choice in Settings wins.
  await alice.win.getByRole('button', { name: 'Settings' }).click()
  await expect(alice.win.locator('#content-hint')).toHaveValue('auto')
  await alice.win.locator('#content-hint').selectOption('detail')
  await alice.win.keyboard.press('Escape')
  await expect(mode).toHaveText('Sharp text')
  await setForeground(alice, { hidden: true, windowId: 'window:2:0', fullscreen: true, displayId: 'fake' })
  await alice.win.waitForTimeout(1500)
  await expect(mode).toHaveText('Sharp text')
})
