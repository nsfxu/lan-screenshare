import { createRoom, expect, joinByIp, openChat, sendChat, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('chat groups messages, and counts unread ones while it is hidden', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await openChat(bob)
  await expect(bob.win.getByLabel('Chat message')).toHaveAttribute('placeholder', "Message Alice's room")

  // Bob hides the chat; Alice writes twice.
  await bob.win.getByRole('button', { name: 'Hide chat' }).click()
  await sendChat(alice, 'are you there?')
  await sendChat(alice, 'starting in a minute')
  const toggle = bob.win.getByRole('button', { name: 'Show chat (2 unread)' })
  await expect(toggle.locator('.unread-badge')).toHaveText('2')
  if (shots) await bob.win.screenshot({ path: `${shots}/1-unread.png` })

  // Opening it clears the count; the two messages share one name and picture.
  await toggle.click()
  await expect(bob.win.locator('.unread-badge')).toHaveCount(0)
  const messages = bob.win.locator('.chat-message')
  await expect(messages).toHaveCount(2)
  await expect(messages.nth(0)).not.toHaveClass(/grouped/)
  await expect(messages.nth(1)).toHaveClass(/grouped/)
  await sendChat(bob, 'yes!')
  await expect(bob.win.locator('.chat-message').nth(2)).not.toHaveClass(/grouped/)
  if (shots) await bob.win.screenshot({ path: `${shots}/2-chat.png` })

  // Hidden again: what was read (Bob's own message included) doesn't count.
  await bob.win.getByRole('button', { name: 'Hide chat' }).click()
  await expect(bob.win.getByRole('button', { name: 'Show chat', exact: true })).toBeVisible()
  await expect(bob.win.locator('.unread-badge')).toHaveCount(0)
})

test('links in chat open in the browser, and nothing else does', async ({ people }) => {
  const [alice, bob] = await people(2)
  // Record what would open in the browser instead of opening it.
  await bob.app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as { opened?: string[] }).opened = opened
    shell.openExternal = async (url: string) => void opened.push(url)
  })
  const opened = (): Promise<string[]> => bob.app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? [])

  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await openChat(bob)
  await sendChat(alice, 'notes at http://10.0.0.5:8080/notes. and javascript:alert(1)')
  const message = bob.win.locator('.chat-message').last()
  const link = message.getByRole('link')
  await expect(link).toHaveCount(1)
  await expect(link).toHaveText('http://10.0.0.5:8080/notes')
  await expect(message.locator('.chat-text')).toHaveText('notes at http://10.0.0.5:8080/notes. and javascript:alert(1)')
  await link.click()
  await expect.poll(opened).toEqual(['http://10.0.0.5:8080/notes'])
  // The room's window stays where it was.
  await expect(bob.win.locator('.room')).toBeVisible()

  // The main process checks the address too, whatever the page asks.
  await bob.win.evaluate(() => window.api.system.openLink('file:///C:/Windows/System32/calc.exe'))
  expect(await opened()).toEqual(['http://10.0.0.5:8080/notes'])
})
