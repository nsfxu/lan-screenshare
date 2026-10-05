import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { PROTOCOL_VERSION } from '../src/shared/constants'
import { IPC } from '../src/shared/ipc'
import { createRoom, expect, joinByIp, test } from './fixtures'

test('a room on a newer, incompatible version says to update', async ({ people }) => {
  // A stand-in for a host that upgrades: it only answers the room-list probe.
  let protocol = 999
  const future = http.createServer((req, res) => {
    if (req.url !== '/info') return void res.writeHead(404).end()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'future',
        name: 'Future room',
        hostName: 'Zoe',
        privacy: 'public',
        viewerCount: 0,
        maxUsers: 10,
        streams: 0,
        protocol,
        appVersion: '9.0.0',
        startedAt: Date.now()
      })
    )
  })
  await new Promise<void>((resolve) => future.listen(0, '127.0.0.1', resolve))
  try {
    const [alice] = await people(1)
    const { version } = await alice.win.evaluate(() => window.api.system.info())
    const { port } = future.address() as AddressInfo

    await alice.win.getByRole('button', { name: 'Connect by IP' }).click()
    await alice.win.getByPlaceholder(/^Host address/).fill(`127.0.0.1:${port}`)
    await alice.win.getByPlaceholder(/^Host address/).press('Enter')
    await expect(alice.win.locator('.manual-connect .error-text')).toHaveText(
      `This room runs ScreenShare 9.0.0, you have ${version}: update to join`
    )

    // A room added while compatible whose host then upgrades: its row says so instead of "offline".
    protocol = PROTOCOL_VERSION
    await alice.win.locator('.manual-connect').getByRole('button', { name: 'Add' }).click()
    const row = alice.win.getByRole('button', { name: 'Join Future room' })
    await expect(row).toBeEnabled()
    protocol = 999
    await expect(row.locator('.room-row-warn')).toHaveText('Update to join')
    expect(await row.getAttribute('title')).toContain(`This room runs ScreenShare 9.0.0, you have ${version}: update to join`)
    await expect(row).toBeDisabled()
  } finally {
    future.close()
  }
})

test('someone in the room runs a newer version: the others hear about it once', async ({ people }) => {
  const [alice, bob] = await people(2)
  // Bob's app says it is newer (same protocol, so he can still join).
  await bob.app.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => ({ version: '9.9.0', platform: process.platform, logDir: '' }))
  }, IPC.appInfo)
  const { version } = await alice.win.evaluate(() => window.api.system.info())

  const port = await createRoom(alice)
  await joinByIp(bob, port)
  const notice = alice.win.locator('.version-hint')
  await expect(notice).toContainText(`Bob runs ScreenShare 9.9.0, a newer version than yours (${version})`)
  await expect(bob.win.locator('.version-hint')).toHaveCount(0)
  await notice.getByRole('button', { name: 'OK' }).click()
  await expect(notice).toHaveCount(0)
})
