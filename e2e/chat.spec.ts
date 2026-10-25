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

test('reply to a message, mention someone with @, and see what was answered', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await openChat(bob)
  await sendChat(bob, 'which build are you on?')

  // Alice answers it: Reply from the message's tools, then @ suggests Bob.
  await openChat(alice)
  // (By its own text: the answer quotes it too.)
  const question = alice.win
    .locator('.chat-message')
    .filter({ has: alice.win.locator('.chat-text', { hasText: 'which build are you on?' }) })
  await question.hover()
  await question.getByRole('button', { name: 'Reply' }).click()
  await expect(alice.win.locator('.chat-replying')).toHaveText(/Replying to Bob/)
  const input = alice.win.getByLabel('Chat message')
  await input.pressSequentially('@b')
  await expect(alice.win.getByRole('option', { name: 'Bob' })).toHaveAttribute('aria-selected', 'true')
  await input.press('Enter')
  await expect(input).toHaveValue('@Bob ')
  await input.pressSequentially('the 2.8 beta')
  await input.press('Enter')
  await expect(alice.win.locator('.chat-replying')).toHaveCount(0)

  // Bob sees the answer quoting his question, and that it mentions him.
  const answer = bob.win.locator('.chat-message', { hasText: 'the 2.8 beta' })
  await expect(answer.locator('.chat-quote')).toContainText('which build are you on?')
  await expect(answer.locator('.chat-mention')).toHaveText('@Bob')
  await expect(answer).toHaveClass(/mentioned/)
  if (shots) await bob.win.screenshot({ path: `${shots}/3-reply.png` })
  // Clicking the quote brings the question back into view.
  await answer.locator('.chat-quote').click()
  await expect(bob.win.locator('.chat-message.flash')).toContainText('which build are you on?')
  // Alice's own message doesn't stand out for her.
  await expect(alice.win.locator('.chat-message', { hasText: 'the 2.8 beta' })).not.toHaveClass(/mentioned/)

  // The host deletes the question: the answer no longer shows it.
  await question.hover()
  await question.getByRole('button', { name: 'Delete message' }).click()
  await expect(answer.locator('.chat-quote')).toHaveText('Original message deleted')
})
