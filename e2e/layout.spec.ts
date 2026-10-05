import { createRoom, expect, joinByIp, openChat, resizeWindow, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('the room list remembers rooms, and the panels stay as you left them', async ({ people }) => {
  const [alice, bob] = await people(2)
  await expect(bob.win.locator('.welcome')).toContainText('Create room')
  if (shots) await bob.win.screenshot({ path: `${shots}/1-welcome.png` })

  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await expect(bob.win.locator('.room')).toBeVisible()
  await expect.poll(() => bob.win.title()).toBe("ScreenShare · Alice's room")

  // Bob's room heads his recent rooms, marked as the one he's in.
  const current = bob.win.locator('.room-row.current')
  await expect(current).toContainText("Alice's room")
  await expect(current).toContainText('2')
  // Alice hosts it: it's her current room too, though not a "recent" one to come back to.
  await expect(alice.win.locator('.room-row.current')).toContainText("Alice's room")
  if (shots) await bob.win.screenshot({ path: `${shots}/2-in-room.png` })

  // Leave, and come back from the recent rooms in one click.
  await bob.win.getByRole('button', { name: 'Leave' }).click()
  await expect(bob.win.locator('.welcome')).toBeVisible()
  await expect.poll(() => bob.win.title()).toBe('ScreenShare')
  await bob.win.getByRole('button', { name: "Join Alice's room" }).first().click()
  await expect(bob.win.locator('.room')).toBeVisible()

  // On a wide window, hide both side columns; they stay hidden after a restart of the window.
  await resizeWindow(bob, 1400, 900)
  await openChat(bob)
  await bob.win.getByRole('button', { name: 'Hide rooms' }).click()
  await bob.win.getByRole('button', { name: 'Hide chat' }).click()
  await expect(bob.win.locator('.rooms-sidebar.collapsed')).toBeVisible()
  await expect(bob.win.locator('.room .sidebar')).toBeHidden()
  if (shots) await bob.win.screenshot({ path: `${shots}/3-panels-hidden.png` })
  await bob.win.reload()
  await expect(bob.win.locator('.rooms-sidebar.collapsed')).toBeVisible()
  await bob.win.getByRole('button', { name: 'Show rooms' }).click()
  await expect(bob.win.locator('.rooms-sidebar:not(.collapsed)')).toBeVisible()
})

test('in a small window the side columns open over the room instead of squeezing it', async ({ people }) => {
  const [alice] = await people(1)
  await resizeWindow(alice, 700, 700)
  await createRoom(alice)

  // Below 760 px the rooms column is a strip, below 1100 px the chat is closed: the tiles get the room.
  await expect(alice.win.locator('.rooms-sidebar.collapsed')).toBeVisible()
  await expect(alice.win.locator('.room .sidebar')).toBeHidden()
  if (shots) await alice.win.screenshot({ path: `${shots}/4-small.png` })

  // The chat opens over the tiles, and closes again.
  await alice.win.getByRole('button', { name: 'Show chat' }).click()
  await expect(alice.win.locator('.room .sidebar.floating')).toBeVisible()
  if (shots) await alice.win.screenshot({ path: `${shots}/5-small-chat.png` })
  await alice.win.getByRole('button', { name: 'Hide chat' }).click()

  // So do the rooms; clicking next to them puts them away.
  await alice.win.getByRole('button', { name: 'Show rooms' }).click()
  await expect(alice.win.locator('.rooms-sidebar.floating')).toBeVisible()
  if (shots) await alice.win.screenshot({ path: `${shots}/6-small-rooms.png` })
  await alice.win.locator('.overlay-backdrop').click({ position: { x: 600, y: 300 } })
  await expect(alice.win.locator('.rooms-sidebar.collapsed')).toBeVisible()
})
