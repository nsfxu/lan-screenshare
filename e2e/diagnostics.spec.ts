import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRoom, expect, test } from './fixtures'

const shots = process.env.E2E_SHOTS

// Settings → About → Diagnostics: one click copies (or saves) what a bug
// report needs, and never the room's PIN, the host token or our client id.
test('diagnostics copy and save what a bug report needs, without secrets', async ({ people }) => {
  const [alice] = await people(1)
  const { win, app } = alice
  await createRoom(alice, 'private')
  const host = await win.evaluate(() => window.api.host.get())
  const settings = await win.evaluate(() => window.api.settings.get())
  expect(host?.pin).toMatch(/^\d{4,6}$/)

  await win.getByRole('button', { name: 'Settings' }).click()
  await win.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'About' }).click()
  await win.getByRole('button', { name: 'Copy diagnostics' }).click()
  await expect(win.locator('.diagnostics-row [role="status"]')).toHaveText('Copied')
  if (shots) await win.screenshot({ path: `${shots}/diagnostics.png` })

  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
  if (shots) fs.writeFileSync(`${shots}/diagnostics.txt`, text)
  expect(text).toContain('ScreenShare diagnostics')
  expect(text).toMatch(new RegExp(`App: ${version.replace(/\./g, '\\.')}.*, protocol \\d+`))
  for (const part of ['Electron ', 'OS: ', 'GPU: ', 'Encoders: ', 'Decoders: ', 'Network: ', 'Settings:', `displayName: "${settings.displayName}"`, 'Log (last']) {
    expect(text).toContain(part)
  }
  // The log has this session (the room was just created).
  expect(text).toMatch(/\[info\]/)
  expect(text).not.toContain(host!.hostToken)
  expect(text).not.toContain(settings.clientId)
  expect(text).not.toMatch(new RegExp(`pin\\W{0,3}${host!.pin}`, 'i'))

  // Save…: the same report, in the file picked in the (here faked) save dialog.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'screenshare-diag-')), 'report.txt')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
  }, file)
  await win.getByRole('button', { name: 'Save diagnostics to a file' }).click()
  await expect(win.locator('.diagnostics-row [role="status"]')).toHaveText('Saved')
  const saved = fs.readFileSync(file, 'utf8')
  expect(saved).toContain('ScreenShare diagnostics')
  expect(saved).not.toContain(host!.hostToken)
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
})
