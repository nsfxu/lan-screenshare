import { expect, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('recent rooms can be pinned to the top and given your own name, from their menu', async ({ people }) => {
  const [{ win }] = await people(1)
  // Rooms Alice was in, now gone (nothing answers on these ports): folded under Offline.
  await win.evaluate(() =>
    window.api.settings.update({
      recentRooms: [
        { address: '127.0.0.1', port: 1, tls: true, name: 'Game night', lastVisited: Date.now() - 3_600_000 },
        { address: '127.0.0.1', port: 2, tls: true, name: "Carol's room", lastVisited: Date.now() - 7_200_000 }
      ]
    })
  )
  await win.reload()
  await win.waitForSelector('.rooms-sidebar')
  const sidebar = win.locator('.rooms-sidebar')
  await sidebar.getByRole('button', { name: /^Offline \(2\)/ }).click()

  // Right-click, Pin to the top: it stays in sight, above the folded rooms, with a pin.
  await sidebar.getByRole('button', { name: /^Join Carol's room/ }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Pin to the top' }).click()
  await expect(sidebar.getByRole('button', { name: /^Offline \(1\)/ })).toBeVisible()
  const pinned = sidebar.getByRole('button', { name: /^Join Carol's room.*, Pinned$/ })
  await expect(pinned).toBeVisible()
  await expect(pinned.locator('.room-pin')).toBeVisible()

  // The dots open the same menu: Rename… edits the name in place; Enter saves.
  await pinned.hover()
  await sidebar.getByRole('button', { name: "More for Carol's room" }).click()
  await win.getByRole('menuitem', { name: 'Rename…' }).click()
  const field = sidebar.getByRole('textbox', { name: 'Name for this room' })
  await expect(field).toHaveValue("Carol's room")
  await expect(sidebar.locator('#room-rename-hint')).toHaveText("Only you see this name · Room's name: Carol's room")
  await field.fill('Work laptop')
  await field.press('Enter')
  const renamed = sidebar.getByRole('button', { name: /^Join Work laptop/ })
  await expect(renamed).toHaveAttribute('title', /Room's name: Carol's room/)
  if (shots) {
    await renamed.click({ button: 'right' })
    await win.screenshot({ path: `${shots}/pinned-renamed.png` })
    await win.keyboard.press('Escape')
  }

  // Esc leaves the name as it was; an empty name goes back to the room's own.
  await renamed.click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Rename…' }).click()
  await field.fill('Something else')
  await field.press('Escape')
  await expect(renamed).toBeVisible()

  // Kept after a restart.
  await win.reload()
  await win.waitForSelector('.rooms-sidebar')
  await expect(sidebar.getByRole('button', { name: /^Join Work laptop.*, Pinned$/ })).toBeVisible()
  await sidebar.getByRole('button', { name: /^Join Work laptop/ }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Rename…' }).click()
  await field.fill('')
  await field.press('Enter')
  await expect(sidebar.getByRole('button', { name: /^Join Carol's room/ })).toBeVisible()

  // Unpin: back under Offline with the other one; Forget takes it off the list.
  await sidebar.getByRole('button', { name: /^Join Carol's room/ }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Unpin' }).click()
  // (Folded again since the restart.)
  await sidebar.getByRole('button', { name: /^Offline \(2\)/ }).click()
  await sidebar.getByRole('button', { name: /^Join Game night/ }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Forget this room' }).click()
  await expect(sidebar.getByRole('button', { name: /^Offline \(1\)/ })).toBeVisible()
})
