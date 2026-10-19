import { createRoom, expect, fakeScreenCapture, test, type Person } from './fixtures'

const shots = process.env.E2E_SHOTS

/** Gives someone a profile picture (a plain drawing), before they create or join a room. */
async function givePicture(person: Person): Promise<void> {
  await person.win.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#5d7fa6'
    ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#f0c4a2'
    ctx.beginPath()
    ctx.arc(64, 54, 26, 0, Math.PI * 2)
    ctx.fill()
    await window.api.settings.update({ avatar: canvas.toDataURL('image/jpeg', 0.8) })
  })
  await person.win.reload()
  await person.win.waitForSelector('.rooms-sidebar')
  await fakeScreenCapture(person.win)
}

test("the room list shows each room's host, folds the ones that are offline, and offers rooms as cards", async ({
  people
}) => {
  const [alice, bob] = await people(2)
  await givePicture(alice)
  const port = await createRoom(alice)

  // Bob was in a room that's gone now (nothing answers on port 1).
  const { win } = bob
  await win.evaluate(
    (lastVisited) =>
      window.api.settings.update({
        recentRooms: [{ address: '127.0.0.1', port: 1, tls: true, name: 'Game night', lastVisited }]
      }),
    Date.now() - 2 * 86_400_000
  )
  await win.reload()
  await win.waitForSelector('.rooms-sidebar')

  // It's folded away under Offline, with when he was last there.
  const offline = win.getByRole('button', { name: /^Offline \(1\)/ })
  await expect(offline).toHaveAttribute('aria-expanded', 'false')
  await expect(win.getByRole('button', { name: 'Join Game night' })).toHaveCount(0)
  await offline.click()
  await expect(win.getByRole('button', { name: 'Join Game night' })).toContainText('Last visited 2 days ago')

  // Alice's room shows her picture, who's sharing and how many are in.
  await win.getByRole('button', { name: 'Join by IP' }).click()
  await win.getByPlaceholder(/^Host address/).fill(`127.0.0.1:${port}`)
  await win.getByPlaceholder(/^Host address/).press('Enter')
  // (By name: the same room can also be found on the computer's other addresses.)
  const row = win.locator('.rooms-sidebar').getByRole('button', { name: "Join Alice's room" })
  await expect(row).toContainText('Live · Alice · 1 person')
  await expect(row.locator('.room-avatar img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)

  // The centre offers it as a card too; joining from there works like the list.
  const card = win.locator('.room-card', { hasText: "Alice's room" })
  await expect(card.locator('.room-avatar img')).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/1-room-list.png` })
  await card.getByRole('button', { name: "Join Alice's room" }).click()
  await expect(win.locator('.room')).toBeVisible()
  const current = win.locator('.room-row.current')
  await expect(current).toContainText("Alice's room")
  await expect(current).toContainText("2 people · you're here")
  await expect(current.locator('.room-avatar img')).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/2-in-room.png` })
})
