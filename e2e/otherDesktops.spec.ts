import { IPC } from '../src/shared/ipc'
import type { CaptureSource } from '../src/shared/types'
import { expect, test } from './fixtures'

const shots = process.env.E2E_SHOTS

// A 1×1 PNG, standing in for an app's icon.
const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// macOS: windows on other desktops (Spaces) come after the others in the picker, with their app's icon.
test('the share picker lists windows on other desktops after the ones here', async ({ people }) => {
  const [alice] = await people(1)
  const sources: CaptureSource[] = [
    { id: 'screen:fake:0', name: 'Fake screen', kind: 'screen', thumbnail: '', displayId: 'fake' },
    { id: 'window:1:0', name: 'Terminal — zsh', kind: 'window', thumbnail: ICON, displayId: '' },
    { id: 'window:2:0', name: 'Brave Browser — GitHub', kind: 'window', thumbnail: '', displayId: '', offscreen: true, appIcon: ICON }
  ]
  await alice.app.evaluate(
    ({ ipcMain }, { channel, sources }) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => sources)
    },
    { channel: IPC.listSources, sources }
  )

  const { win } = alice
  await win.getByRole('button', { name: /^Create( a)? room$/ }).first().click()
  const dialog = win.locator('.modal')
  await dialog.getByRole('button', { name: 'Windows', exact: true }).click()

  await expect(dialog.locator('.source-group')).toHaveText(['On this desktop', 'On other desktops'])
  const brave = dialog.locator('.source', { hasText: 'Brave Browser — GitHub' })
  await expect(brave.locator('.source-where')).toHaveText('Other desktop')
  await expect(brave.locator('img.app-icon')).toHaveAttribute('src', ICON)
  await expect(dialog.locator('.source', { hasText: 'Terminal — zsh' }).locator('.source-where')).toHaveCount(0)
  await expect(dialog.getByText('These windows are on another desktop or minimized, so they have no preview.')).toBeVisible()

  await brave.click()
  await expect(brave).toHaveClass(/selected/)
  if (shots) await dialog.screenshot({ path: `${shots}/other-desktops.png` })

  // Without windows elsewhere, the list looks as before: no groups.
  await dialog.getByRole('button', { name: 'Screens', exact: true }).click()
  await expect(dialog.locator('.source-group')).toHaveCount(0)
})
