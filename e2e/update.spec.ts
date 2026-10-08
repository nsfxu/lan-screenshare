import type { ElectronApplication } from '@playwright/test'
import { IPC } from '../src/shared/ipc'
import type { UpdateStatus } from '../src/shared/types'
import { createRoom, expect, test, type Person } from './fixtures'

const shots = process.env.E2E_SHOTS

/** Tell the app where updates are, as the main process's Updater does. */
async function setUpdate(person: Person, status: UpdateStatus): Promise<void> {
  await person.app.evaluate(
    ({ BrowserWindow }, [channel, value]) => BrowserWindow.getAllWindows()[0].webContents.send(channel, value),
    [IPC.updateStatus, status] as const
  )
}

/** Replaces an update IPC handler with one that counts its calls. */
async function countCalls(app: ElectronApplication, channel: string): Promise<() => Promise<number>> {
  await app.evaluate(({ ipcMain }, ch) => {
    const counts = ((globalThis as Record<string, unknown>).e2eCalls ??= {}) as Record<string, number>
    counts[ch] = 0
    ipcMain.removeHandler(ch)
    ipcMain.handle(ch, () => {
      counts[ch]++
    })
  }, channel)
  return () => app.evaluate((_e, ch) => ((globalThis as Record<string, unknown>).e2eCalls as Record<string, number>)[ch], channel)
}

test('updates: Settings explains them, a downloaded one offers a restart, which asks first in a room', async ({ people }) => {
  const [alice] = await people(1)
  const { win } = alice
  const installs = await countCalls(alice.app, IPC.updateInstall)

  // A development build doesn't update itself; automatic checks are on by default.
  await win.getByRole('button', { name: 'Settings' }).first().click()
  await win.getByRole('button', { name: 'About' }).click()
  const about = win.locator('section[data-section="about"]')
  await expect(about.getByRole('checkbox', { name: /Check for updates automatically/ })).toBeChecked()
  await expect(about.locator('.update-row')).toContainText('Updates come with the installed app')
  await expect(about.getByRole('button', { name: 'Check now' })).toBeDisabled()

  // Downloading, then ready: Settings and the title bar offer the restart.
  await setUpdate(alice, { state: 'downloading', version: '9.9.0', percent: 42 })
  await expect(about.locator('.update-row')).toContainText('Downloading ScreenShare 9.9.0… 42 %')
  await expect(win.getByRole('button', { name: 'Restart to update' })).toHaveCount(0)
  await setUpdate(alice, { state: 'ready', version: '9.9.0' })
  await expect(about.locator('.update-row')).toContainText('ScreenShare 9.9.0 is ready to install.')
  await expect(about.locator('.update-row')).toBeInViewport()
  if (shots) await win.screenshot({ path: `${shots}/1-update-settings.png` })
  await win.keyboard.press('Escape')

  const restart = win.locator('.title-bar').getByRole('button', { name: 'Restart to update' })
  await expect(restart).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/2-update-title-bar.png` })
  // Not in a room: it restarts straight away.
  await restart.click()
  await expect.poll(installs).toBe(1)

  // Hosting: it asks first, and "Cancel" keeps the room.
  await createRoom(alice)
  await restart.click()
  const ask = win.getByRole('dialog', { name: 'Restart to update?' })
  await expect(ask).toContainText(/ends .* for everyone/)
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(ask).toHaveCount(0)
  expect(await installs()).toBe(1)
  await expect(win.locator('.room')).toBeVisible()

  // macOS: a new version is only offered for download.
  const opens = await countCalls(alice.app, IPC.updateOpenPage)
  await setUpdate(alice, { state: 'available', version: '9.9.1', url: 'https://github.com/nsfxu/lan-screenshare/releases/tag/v9.9.1' })
  await win.locator('.title-bar').getByRole('button', { name: 'Update to 9.9.1' }).click()
  await expect.poll(opens).toBe(1)
})
