import { expect, fakeScreenCapture, joinByIp, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('the app speaks Portuguese when chosen, at once and after a restart, the room included', async ({ people }) => {
  const [alice, bob] = await people(2)
  const { win } = alice

  // The tests start in English ("System" on an English computer).
  await expect(win.getByRole('button', { name: 'Create room' }).first()).toBeVisible()
  await win.getByRole('button', { name: 'Settings' }).first().click()
  await expect(win.getByLabel('Language')).toHaveValue('system')
  await expect(win.getByLabel('Language').locator('option[value="system"]')).toHaveText('Same as the computer (English)')

  // Choosing Portuguese changes everything at once, without a restart.
  await win.getByLabel('Language').selectOption('pt-BR')
  await expect(win.getByRole('dialog', { name: 'Configurações' })).toBeVisible()
  await expect(win.locator('html')).toHaveAttribute('lang', 'pt-BR')
  await expect(win.getByRole('radio', { name: /^Meia-noite/ })).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/1-settings-pt.png` })
  await win.keyboard.press('Escape')
  await expect(win.getByRole('button', { name: 'Criar sala' }).first()).toBeVisible()

  // Remembered.
  await win.reload()
  await win.waitForSelector('.rooms-sidebar')
  await fakeScreenCapture(win)
  await expect(win.getByRole('button', { name: 'Criar sala' }).first()).toBeVisible()

  // Hosting in Portuguese: the default room name, the dialog and the controls.
  await win.getByRole('button', { name: 'Criar sala' }).first().click()
  const dialog = win.getByRole('dialog', { name: 'Criar sala' })
  await expect(dialog.getByLabel('Nome da sala')).toHaveValue('Sala de Alice')
  await dialog.locator('.source', { hasText: 'Fake screen' }).click()
  await dialog.getByRole('button', { name: 'Começar a compartilhar' }).click()
  await win.waitForSelector('.room')
  const port = await win.evaluate(() => window.api.host.get().then((h) => h?.port ?? 0))
  const controls = win.locator('.stage-controls')
  await expect(controls.getByRole('button', { name: 'Encerrar sala' })).toHaveAttribute(
    'data-tip',
    'Encerrar a sala para todo mundo'
  )
  await expect(controls.getByRole('button', { name: 'Compartilhando', exact: true })).toBeAttached()

  // Bob's app is in English: the room's lines come in each one's own language.
  await joinByIp(bob, port)
  await expect(bob.win.locator('.title-bar-room')).toContainText('Sala de Alice')
  await expect(win.locator('.chat-system', { hasText: 'Bob entrou' })).toBeAttached()
  await expect(bob.win.locator('.chat-system', { hasText: 'Bob joined' })).toBeAttached()
  await expect(win.locator('.member', { hasText: 'Bob' })).toBeVisible()
  if (shots) await win.screenshot({ path: `${shots}/2-room-pt.png` })

  // Back to "System": English again.
  await win.getByRole('button', { name: 'Configurações' }).first().click()
  await win.getByLabel('Idioma').selectOption('system')
  await expect(win.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(win.locator('.chat-system', { hasText: 'Bob joined' })).toBeAttached()
})
