import { createRoom, expect, fakeScreenCapture, joinByIp, resizeWindow, test, type Person } from './fixtures'

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

  // Alice's room shows her picture and how many are in; screen readers also hear that it's live and who hosts it.
  await win.getByRole('button', { name: 'Join by IP' }).click()
  await win.getByPlaceholder(/^Host address/).fill(`127.0.0.1:${port}`)
  await win.getByPlaceholder(/^Host address/).press('Enter')
  // (By name: the same room can also be found on the computer's other addresses.)
  const row = win.locator('.rooms-sidebar').getByRole('button', { name: "Join Alice's room" })
  await expect(row.locator('.room-details')).toHaveText('1 person')
  await expect(row).toHaveAccessibleName("Join Alice's room, Live, Hosted by Alice, 1 person")
  await expect(row.locator('.room-avatar img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)

  // The centre offers it as a card too; joining from there works like the list.
  const card = win.locator('.room-card', { hasText: "Alice's room" })
  await expect(card.locator('.room-avatar img')).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/1-room-list.png` })
  await card.getByRole('button', { name: "Join Alice's room" }).click()
  await expect(win.locator('.room')).toBeVisible()
  const current = win.locator('.room-row.current')
  await expect(current).toContainText("Alice's room")
  await expect(current.locator('.room-details')).toContainText('2 people')
  await expect(current.locator('.sr-only')).toHaveText(", Live, you're here")
  await expect(current.locator('.room-avatar img')).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/2-in-room.png` })

  // Once Alice ends her room, Bob's list still shows her picture on it, under Offline.
  await win.getByRole('button', { name: 'Leave', exact: true }).click()
  await alice.win.getByRole('button', { name: 'End room', exact: true }).click()
  await alice.win.getByRole('dialog').getByRole('button', { name: 'End room' }).click()
  await expect(win.getByRole('button', { name: /^Offline \(2\)/ })).toBeVisible({ timeout: 20_000 })
  const gone = win.locator('.rooms-sidebar .room-row.offline', { hasText: "Alice's room" })
  await expect(gone.locator('.room-avatar img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
  await expect(gone.getByRole('button', { name: /^Join Alice's room/ })).toHaveAttribute('title', /Hosted by Alice/)
  if (shots) await win.screenshot({ path: `${shots}/3-offline.png` })
})

test("a public room shows who's inside: their pictures, then +N", async ({ people }) => {
  const [alice, bob, carol] = await people(3)
  await givePicture(alice)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await expect(bob.win.locator('.room')).toBeVisible()

  // Carol, not in the room, sees Alice's picture and Bob's initial; the count stays for screen readers.
  const { win } = carol
  // Three windows side by side are narrow: the rooms column opens from a button.
  await resizeWindow(carol, 1280, 800)
  await win.getByRole('button', { name: 'Join by IP' }).click()
  await win.getByPlaceholder(/^Host address/).fill(`127.0.0.1:${port}`)
  await win.getByPlaceholder(/^Host address/).press('Enter')
  const row = win.locator('.rooms-sidebar').getByRole('button', { name: /^Join Alice's room/ })
  const faces = row.locator('.room-people-face')
  await expect(faces).toHaveCount(2, { timeout: 15_000 })
  await expect(faces.nth(0).locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)
  await expect(faces.nth(1)).toHaveAttribute('title', 'Bob')
  await expect(faces.nth(1)).toHaveText('B')
  await expect(row.locator('.room-people .sr-only')).toHaveText('2 people')
  await expect(win.locator('.room-card', { hasText: "Alice's room" }).locator('.room-people-face')).toHaveCount(2)
  if (shots) await win.screenshot({ path: `${shots}/4-people.png` })

  // Private: just the count.
  await alice.win.locator('.room-settings-button').click()
  await alice.win.locator('.room-settings').getByRole('button', { name: 'Private' }).click()
  await expect(row.locator('.room-details')).toHaveText('2 people', { timeout: 15_000 })
  await expect(row.locator('.room-people-face')).toHaveCount(0)
})
