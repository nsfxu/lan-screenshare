import {
  cornerColour,
  createRoom,
  decodedFrames,
  expect,
  FAKE_SCREEN_RGB,
  inviteOf,
  joinWithInvite,
  pasteInvite,
  test,
  vpnStatus
} from './fixtures'

// The tunnel itself is faked (no network interface, no password prompt); everything around it is real:
// the invite, the enrolment over HTTPS pinned to the host's certificate, and joining the room.

test('a VPN room: the host copies the invite, a guest joins with it and can disconnect', async ({ people }) => {
  const [alice, bob] = await people(2)

  await createRoom(alice, 'public', { vpn: '127.0.0.1' })
  const invite = await alice.win.evaluate(() => window.api.host.get().then((h) => h?.vpn?.invite ?? ''))
  expect(invite).toMatch(/^ssvpn1\./)

  await alice.win.getByRole('button', { name: 'Room details' }).click()
  await expect(alice.win.getByRole('button', { name: 'Copy VPN invite' })).toBeVisible()
  await expect(alice.win.locator('.vpn-box')).toContainText('0 guests')

  await bob.win.getByRole('button', { name: 'Join by IP' }).click()
  await bob.win.getByRole('button', { name: 'VPN invite', exact: true }).click()
  await bob.win.getByPlaceholder(/^Paste the invite/).fill(invite)
  await bob.win.getByRole('button', { name: 'Connect', exact: true }).click()

  // The room opens by itself once the tunnel is up.
  await expect(bob.win.locator('.room')).toBeVisible({ timeout: 30_000 })
  await expect(bob.win.locator('.room-members')).toContainText('Alice')
  await expect(bob.win.locator('.vpn-status')).toContainText('VPN connected')
  await expect(alice.win.locator('.vpn-box')).toContainText('1 guest')

  await bob.win.getByRole('button', { name: 'Disconnect' }).click()
  await expect(bob.win.locator('.vpn-status')).toHaveCount(0)
})

test('a VPN invite that is not one, or not the host\'s, is refused with a reason', async ({ people }) => {
  const [alice, bob] = await people(2)
  await createRoom(alice, 'public', { vpn: '127.0.0.1' })
  const invite = await alice.win.evaluate(() => window.api.host.get().then((h) => h?.vpn?.invite ?? ''))

  await bob.win.getByRole('button', { name: 'Join by IP' }).click()
  await bob.win.getByRole('button', { name: 'VPN invite', exact: true }).click()
  const box = bob.win.getByPlaceholder(/^Paste the invite/)

  await box.fill('hello there')
  await box.press('Enter')
  await expect(bob.win.locator('.manual-connect .error-text')).toContainText('not a ScreenShare VPN invite')

  // Right host, wrong secret: the last characters of the invite are inside its JSON.
  const forged = Buffer.from(invite.slice('ssvpn1.'.length), 'base64url').toString().replace(/"secret":"[^"]+"/, `"secret":"${'z'.repeat(32)}"`)
  await box.fill('ssvpn1.' + Buffer.from(forged).toString('base64url'))
  await box.press('Enter')
  await expect(bob.win.locator('.manual-connect .error-text')).toContainText('did not accept this invite')
  await expect(bob.win.locator('.vpn-status')).toHaveCount(0)
})

test('two guests in different places watch the same stream through the VPN', async ({ people }) => {
  const [alice, bob, carol] = await people(3)

  await createRoom(alice, 'public', { vpn: '127.0.0.1' })
  const invite = await inviteOf(alice)
  await joinWithInvite(bob, invite)
  await joinWithInvite(carol, invite)
  await expect(bob.win.locator('.room')).toBeVisible({ timeout: 30_000 })
  await expect(carol.win.locator('.room')).toBeVisible({ timeout: 30_000 })

  // Each guest gets its own address in the host's network (host .1, guests .2 and up).
  const [host, a, b] = [await vpnStatus(alice), await vpnStatus(bob), await vpnStatus(carol)]
  expect(host).toMatchObject({ mode: 'hosting', peers: 2 })
  const network = (address: string | null): string => (address ?? '').split('.').slice(0, 3).join('.')
  expect(network(host.address)).toMatch(/^10\.77\.\d+$/)
  expect(network(a.address)).toBe(network(host.address))
  expect(network(b.address)).toBe(network(host.address))
  expect(new Set([host.address, a.address, b.address]).size).toBe(3)
  expect(host.address).toMatch(/\.1$/)

  // Both watch Alice, and both get real frames of her screen.
  for (const guest of [bob, carol]) {
    await guest.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  }
  for (const guest of [bob, carol]) {
    await expect.poll(() => decodedFrames(guest.win), { timeout: 45_000 }).toBeGreaterThan(30)
    const colour = await cornerColour(guest.win)
    expect(colour).not.toBeNull()
    colour!.forEach((c, i) => expect(Math.abs(c - FAKE_SCREEN_RGB[i])).toBeLessThanOrEqual(16))
  }

  // Everyone is in the same room: the host sees both, and each guest sees the other.
  await expect(alice.win.locator('.room-members')).toContainText('Bob')
  await expect(alice.win.locator('.room-members')).toContainText('Carol')
  await expect(bob.win.locator('.room-members')).toContainText('Carol')
  await expect(carol.win.locator('.room-members')).toContainText('Bob')
})

test('a private VPN room: the invite gets you to the door, the PIN still opens it', async ({ people }) => {
  const [alice, bob] = await people(2)

  await createRoom(alice, 'private', { vpn: '127.0.0.1' })
  const pin = await alice.win.evaluate(() => window.api.host.get().then((h) => h?.pin ?? ''))
  expect(pin).toMatch(/^\d{4,6}$/)
  const wrong = pin
    .split('')
    .map((d) => String((Number(d) + 1) % 10))
    .join('')

  await joinWithInvite(bob, await inviteOf(alice))
  // The VPN is up, but the room still asks for its PIN.
  await expect(bob.win.locator('.vpn-status')).toContainText('VPN connected', { timeout: 30_000 })
  await expect(bob.win.locator('.room')).toHaveCount(0)
  const form = bob.win.locator('.pin-form')
  await form.getByLabel('Room PIN').fill(wrong)
  await form.getByRole('button', { name: 'Join' }).click()
  await expect(form.locator('.error-text')).toContainText('Wrong PIN')

  await form.getByLabel('Room PIN').fill(pin)
  await form.getByRole('button', { name: 'Join' }).click()
  await expect(bob.win.locator('.room')).toBeVisible()
  await expect(alice.win.locator('.room-members')).toContainText('Bob')
})

test('disconnecting and joining again keeps the same address, and the room leaves the list', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice, 'public', { vpn: '127.0.0.1' })
  const invite = await inviteOf(alice)

  await joinWithInvite(bob, invite)
  await expect(bob.win.locator('.vpn-status')).toContainText('VPN connected', { timeout: 30_000 })
  const first = (await vpnStatus(bob)).address
  expect(first).toMatch(/^10\.77\.\d+\.2$/)
  // Not just any entry on that port: the same machine also shows up on the LAN through mDNS.
  const inList = (): Promise<boolean> =>
    bob.win.evaluate((p) => window.api.rooms.list().then((l) => l.some((r) => r.address === '127.0.0.1' && r.port === p)), port)
  expect(await inList()).toBe(true)

  // Leave the room first (the VPN outlives it), then disconnect.
  await bob.win.getByRole('button', { name: 'Leave' }).click()
  await bob.win.getByRole('button', { name: 'Disconnect' }).click()
  await expect(bob.win.locator('.vpn-status')).toHaveCount(0)
  expect((await vpnStatus(bob)).mode).toBe('off')
  expect(await inList()).toBe(false)

  await joinWithInvite(bob, invite)
  await expect(bob.win.locator('.vpn-status')).toContainText('VPN connected', { timeout: 30_000 })
  expect((await vpnStatus(bob)).address).toBe(first)
  // Still one guest on the host: the same install, the same seat in the VPN.
  expect((await vpnStatus(alice)).peers).toBe(1)
})

test('one VPN at a time: a guest can\'t join another, a host can\'t join one', async ({ people }) => {
  const [alice, bob, carol] = await people(3)
  await createRoom(alice, 'public', { vpn: '127.0.0.1' })
  await createRoom(carol, 'public', { vpn: '127.0.0.1' })
  const aliceInvite = await inviteOf(alice)
  const carolInvite = await inviteOf(carol)

  await joinWithInvite(bob, aliceInvite)
  await expect(bob.win.locator('.vpn-status')).toContainText('VPN connected', { timeout: 30_000 })
  await pasteInvite(bob, carolInvite)
  await bob.win.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(bob.win.locator('.manual-connect .error-text')).toContainText('already connected to a VPN room')

  // Carol hosts a VPN room herself, so Alice's invite is no use to her.
  await joinWithInvite(carol, aliceInvite)
  await expect(carol.win.locator('.manual-connect .error-text')).toContainText('already hosting a VPN room')
})

test('three wrong invites lock the guest out for a while', async ({ people }) => {
  const [alice, bob] = await people(2)
  await createRoom(alice, 'public', { vpn: '127.0.0.1' })
  const invite = await inviteOf(alice)
  const forged = Buffer.from(invite.slice('ssvpn1.'.length), 'base64url').toString().replace(/"secret":"[^"]+"/, `"secret":"${'z'.repeat(32)}"`)
  const wrong = 'ssvpn1.' + Buffer.from(forged).toString('base64url')

  const error = bob.win.locator('.manual-connect .error-text')
  await joinWithInvite(bob, wrong)
  await expect(error).toContainText('did not accept this invite')
  await bob.win.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(error).toContainText('did not accept this invite')
  await bob.win.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(error).toContainText('Too many wrong tries')

  // Even the right invite is refused while locked, and nobody got into the VPN.
  await pasteInvite(bob, invite)
  await bob.win.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(error).toContainText('Too many wrong tries')
  expect((await vpnStatus(bob)).mode).toBe('off')
  expect((await vpnStatus(alice)).peers).toBe(0)
})

test('when the host ends the room, the VPN goes with it and the invite stops working', async ({ people }) => {
  const [alice, bob] = await people(2)
  await createRoom(alice, 'public', { vpn: '127.0.0.1' })
  const invite = await inviteOf(alice)
  expect((await vpnStatus(alice)).mode).toBe('hosting')

  await alice.win.evaluate(() => window.api.host.close())
  await expect.poll(async () => (await vpnStatus(alice)).mode).toBe('off')
  expect(await alice.win.evaluate(() => window.api.host.get().then((h) => h?.vpn ?? null))).toBeNull()

  await joinWithInvite(bob, invite)
  await expect(bob.win.locator('.manual-connect .error-text')).toContainText('Could not reach the host')
  expect((await vpnStatus(bob)).mode).toBe('off')
})

test('creating a room: the VPN needs an address, and a computer without the helper is told so', async ({ people }) => {
  const [alice] = await people(1)
  const { win } = alice

  await win.getByRole('button', { name: /^Create( a)? room$/ }).first().click()
  const dialog = win.locator('.modal')
  await dialog.locator('.source', { hasText: 'Fake screen' }).click()
  const start = dialog.getByRole('button', { name: 'Start sharing' })
  const toggle = dialog.getByRole('checkbox', { name: /Open a VPN for this room/ })

  await expect(start).toBeEnabled()
  await toggle.check()
  await expect(start).toBeDisabled() // no address to put in the invite yet
  await dialog.getByLabel('Address your friends connect to').fill('203.0.113.7')
  await expect(start).toBeEnabled()
  await toggle.uncheck()
  await expect(dialog.getByLabel('Address your friends connect to')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // A computer with no VPN helper: the switch is off and says why; the room still works without it.
  await alice.app.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => ({ ok: false, reason: 'This build of ScreenShare has no VPN helper.' }))
  }, 'vpn:available')
  await win.getByRole('button', { name: /^Create( a)? room$/ }).first().click()
  const again = win.locator('.modal')
  await expect(again.getByRole('checkbox', { name: /Open a VPN for this room/ })).toBeDisabled()
  await expect(again).toContainText('This build of ScreenShare has no VPN helper.')
  await again.locator('.source', { hasText: 'Fake screen' }).click()
  await again.getByRole('button', { name: 'Start sharing' }).click()
  await win.waitForSelector('.room')
  expect(await win.evaluate(() => window.api.host.get().then((h) => h?.vpn ?? null))).toBeNull()
})
