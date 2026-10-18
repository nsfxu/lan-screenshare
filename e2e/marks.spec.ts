import type { Page } from '@playwright/test'
import { createRoom, expect, joinByIp, resizeWindow, test, type Person } from './fixtures'

const shots = process.env.E2E_SHOTS

/** The streamer's see-through marks window (lib/marksWindow.ts), once it's open. */
async function marksWindow(person: Person): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(async () => {
      for (const page of person.app.windows()) {
        if ((await page.locator('.marks-window').count().catch(() => 0)) > 0) found = page
      }
      return !!found
    })
    .toBe(true)
  return found!
}

// Drawing on a stream: people watching point at it and draw; everyone watching
// sees it on their tile, and the streamer in a window over the shared screen.
test('watchers point and draw on a stream; everyone watching and the streamer see it', async ({ people }) => {
  const [alice, bob, carol] = await people(3)
  await resizeWindow(bob, 1200, 800)
  const port = await createRoom(alice)
  for (const p of [bob, carol]) {
    await joinByIp(p, port)
    await p.win.getByRole('button', { name: "Watch Alice's stream" }).click()
    await expect(p.win.locator('.stream-tile video')).toHaveCount(1)
  }

  // Alice's marks window: on top of everything, never focused, hidden from screen capture.
  const overlay = await marksWindow(alice)
  const props = await alice.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isFocusable())
    return w ? { onTop: w.isAlwaysOnTop(), protectedFromCapture: w.isContentProtected() } : null
  })
  expect(props).toEqual({ onTop: true, protectedFromCapture: true })

  // Bob turns his pen on from the controls under the focused stream.
  const tile = bob.win.locator('.spotlight-main .stream-tile, .stage-grid .stream-tile').first()
  await tile.hover()
  await bob.win.locator('.stage-controls').getByRole('button', { name: 'Draw on the stream' }).click()
  await expect(bob.win.locator('.stage-controls').getByRole('button', { name: 'Stop drawing' })).toHaveAttribute('aria-pressed', 'true')

  // Pointing: Carol and Alice see a dot with his name.
  const box = (await bob.win.locator('.stream-tile .marks-layer').first().boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await bob.win.mouse.move(cx, cy)
  await bob.win.mouse.move(cx + 5, cy + 5)
  const carolLayer = carol.win.locator('.stream-tile .marks-layer').first()
  await expect(carolLayer).toHaveAttribute('data-pointers', 'Bob')
  await expect(overlay.locator('.marks-layer')).toHaveAttribute('data-pointers', 'Bob')

  // Drawing: a stroke shows at once for Bob, and for Carol and Alice. Clicking with the pen doesn't leave the focus view.
  await bob.win.mouse.down()
  for (let i = 1; i <= 10; i++) await bob.win.mouse.move(cx + i * 12, cy + i * 6)
  await bob.win.mouse.up()
  await expect(bob.win.locator('.stream-tile .marks-layer').first()).toHaveAttribute('data-strokes', '1')
  await expect(carolLayer).toHaveAttribute('data-strokes', '1')
  await expect(overlay.locator('.marks-layer')).toHaveAttribute('data-strokes', '1')
  await expect(bob.win.locator('.spotlight-main .stream-tile')).toHaveCount(1)
  if (shots) {
    await carol.win.screenshot({ path: `${shots}/marks-carol.png` })
    await bob.win.screenshot({ path: `${shots}/marks-bob.png` })
  }

  // Clear my marks: gone for everyone.
  await bob.win.locator('.stage-controls').getByRole('button', { name: 'Clear my marks' }).click()
  await expect(carolLayer).toHaveAttribute('data-strokes', '0')
  await expect(overlay.locator('.marks-layer')).toHaveAttribute('data-strokes', '0')

  // The host turns drawing off for the room: Bob's pen goes away.
  await alice.win.locator('.room-info-button').click()
  // (It shows the room's state, so it flips when the room server confirms.)
  const allow = alice.win.getByRole('checkbox', { name: 'Allow drawing on streams' })
  await expect(allow).toBeChecked()
  await allow.click()
  await expect(allow).not.toBeChecked()
  await expect(bob.win.locator('.stage-controls').getByRole('button', { name: /Draw on the stream|Stop drawing/ })).toHaveCount(0)
  await expect(bob.win.locator('.stream-tile .marks-layer[data-pen="on"]')).toHaveCount(0)
})
