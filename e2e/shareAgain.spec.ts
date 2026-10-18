import { createRoom, expect, joinByIp, resizeWindow, test } from './fixtures'

const shots = process.env.E2E_SHOTS

// "Share again" shares the last screen or window, with its sound options, in one click.
test('Share again picks up the last source and its sound', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice, 'public', { audio: true })
  const { win } = alice
  const sharingMenu = async (): Promise<void> => {
    await win.getByRole('button', { name: 'Sharing', exact: true }).click()
  }

  // Bob has never shared: only Share screen.
  await joinByIp(bob, port)
  await expect(bob.win.getByRole('button', { name: 'Share screen' })).toBeVisible()
  await expect(bob.win.locator('.bar-btn.share-again')).toHaveCount(0)

  // Alice stops: Share again offers the fake screen.
  await sharingMenu()
  await win.getByRole('menuitem', { name: 'Stop sharing' }).click()
  const again = win.getByRole('button', { name: 'Share “Fake screen” again' })
  await expect(again).toBeVisible()
  if (shots) {
    await again.hover()
    await win.screenshot({ path: `${shots}/share-again.png` })
  }

  // A small window keeps just its icon, and the controls still fit.
  await resizeWindow(alice, 700, 700)
  await expect.poll(async () => (await again.boundingBox())?.width ?? 999).toBeLessThan(70)
  const right = await win.locator('.stage-controls .bar-btn').evaluateAll((els) =>
    Math.max(...els.map((e) => e.getBoundingClientRect().right))
  )
  expect(right).toBeLessThanOrEqual(await win.evaluate(() => window.innerWidth))
  if (shots) await win.screenshot({ path: `${shots}/share-again-small.png` })
  await resizeWindow(alice, 1280, 800)

  // One click: sharing again, with sound (she shared with it), and Bob can watch.
  await again.click()
  await expect(win.getByRole('button', { name: 'Sharing', exact: true })).toBeVisible()
  await sharingMenu()
  await expect(win.getByRole('menuitem', { name: 'Mute audio' })).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(bob.win.getByRole('button', { name: "Watch Alice's stream" })).toBeVisible()
})

test("Share again opens the picker when the last window isn't there anymore", async ({ people }) => {
  const [alice, bob] = await people(2)
  // Bob shared a window in an earlier run; it's closed now.
  await bob.win.evaluate(() =>
    localStorage.setItem(
      'screenshare.lastShare',
      JSON.stringify({
        source: { id: 'window:1234:0', name: 'Old game', kind: 'window', displayId: '' },
        audio: { enabled: false, excludeDiscord: false, appOnly: false }
      })
    )
  )
  await bob.win.reload() // read at startup
  await bob.win.waitForSelector('.rooms-sidebar')

  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await bob.win.getByRole('button', { name: 'Share “Old game” again' }).click()
  await expect(bob.win.locator('.toast', { hasText: '“Old game” isn’t there anymore' })).toBeVisible()
  await expect(bob.win.locator('.modal .source', { hasText: 'Fake screen' })).toBeVisible()
})
