import { createRoom, expect, joinByIp, sendChat, test } from './fixtures'

const shots = process.env.E2E_SHOTS

test('chat groups messages, and counts unread ones while it is hidden', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
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
