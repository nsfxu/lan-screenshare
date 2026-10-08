import { createRoom, decodedFrames, expect, joinByIp, test } from './fixtures'

const shots = process.env.E2E_SHOTS

/** The volume Bob's player uses for the stream he watches. */
const playedVolume = (win: import('@playwright/test').Page): Promise<{ volume: number; muted: boolean }> =>
  win.evaluate(() => {
    const v = document.querySelector<HTMLVideoElement>('.stream-tile video')!
    return { volume: Math.round(v.volume * 100) / 100, muted: v.muted }
  })

test('click to focus, double-click for full screen; volume below a focused stream and in its menu', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice, 'public', { audio: true })
  await joinByIp(bob, port)
  const { win } = bob
  await win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect.poll(() => decodedFrames(win), { timeout: 30_000 }).toBeGreaterThan(10)
  const aliceStream = win.locator('.stream-tile')

  // Watching it opened it focused; a click goes back to the grid, another focuses it again. No controls on the stream itself.
  await expect(win.locator('.spotlight-main video')).toHaveCount(1)
  await expect(aliceStream.locator('.tile-bar')).toContainText('Alice')
  await expect(aliceStream.getByRole('button')).toHaveCount(0)
  await win.locator('.spotlight-main .stream-tile').click()
  await expect(win.locator('.stage-spotlight')).toHaveCount(0)

  // The controls float over the stage: they hide after a moment without the mouse moving there, and come back.
  const controls = win.locator('.stage-controls')
  const stageBox = (await win.locator('.stage-area').boundingBox())!
  await win.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + 30)
  const controlsOpacity = () => controls.evaluate((el) => getComputedStyle(el).opacity)
  await expect.poll(controlsOpacity, { timeout: 6_000 }).toBe('0')
  await win.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + 60)
  await expect.poll(controlsOpacity).toBe('1')
  // Each control has a tooltip of its own, shown when pointed at.
  const fullscreenButton = controls.getByRole('button', { name: 'Full screen' })
  const tip = () =>
    fullscreenButton.evaluate((el) => {
      const after = getComputedStyle(el, '::after')
      return { text: after.content, opacity: after.opacity }
    })
  await fullscreenButton.hover()
  await expect.poll(tip).toEqual({ text: '"Full screen"', opacity: '1' })
  if (shots) await win.screenshot({ path: `${shots}/0-tooltip.png` })

  // Focused: the speaker in the controls mutes and unmutes back to the volume; pointing at it shows the slider.
  await aliceStream.click()
  const speaker = win.getByRole('button', { name: 'Mute Alice' })
  await speaker.click()
  await expect(win.getByRole('button', { name: 'Unmute Alice' })).toBeVisible()
  expect((await playedVolume(win)).muted).toBe(true)
  await win.getByRole('button', { name: 'Unmute Alice' }).click()
  expect((await playedVolume(win)).muted).toBe(false)
  await win.getByRole('button', { name: 'Mute Alice' }).hover()
  const slider = win.locator('.volume-pop').getByLabel('Volume of Alice')
  await expect(slider).toBeVisible()
  await slider.fill('0.4')
  await expect.poll(() => playedVolume(win)).toEqual({ volume: 0.4, muted: false })
  if (shots) await win.screenshot({ path: `${shots}/1-focus-volume.png` })

  // The right-click menu has the same volume.
  await win.locator('.spotlight-main .stream-tile').click({ button: 'right' })
  const menu = win.getByRole('menu', { name: "Alice's stream" })
  await expect(menu.getByLabel('Volume of Alice')).toHaveValue('0.4')
  await menu.getByLabel('Volume of Alice').fill('0.7')
  await expect.poll(() => playedVolume(win)).toEqual({ volume: 0.7, muted: false })
  if (shots) await win.screenshot({ path: `${shots}/2-menu-volume.png` })
  await win.keyboard.press('Escape')

  // Double-click: the stream fills the whole screen with no frame, the strip and the controls float over it...
  await win.locator('.spotlight-main .stream-tile').dblclick()
  await expect.poll(() => win.evaluate(() => document.fullscreenElement?.className ?? '')).toContain('stage-area')
  await expect(win.locator('.spotlight-main video')).toHaveCount(1)
  await expect(win.locator('.spotlight-strip .person-tile', { hasText: 'Bob' })).toBeVisible()
  const main = win.locator('.spotlight-main .stream-tile')
  await expect
    .poll(() =>
      main.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return { fills: box.width === innerWidth && box.height === innerHeight, border: style.borderTopWidth }
      })
    )
    .toEqual({ fills: true, border: '0px' })
  if (shots) await win.screenshot({ path: `${shots}/3-fullscreen.png` })

  // ...and everything but the picture hides after a moment without the mouse moving.
  const opacity = (selector: string) => win.locator(selector).first().evaluate((el) => getComputedStyle(el).opacity)
  const why = () =>
    win.evaluate(() => ({
      stage: document.querySelector('.stage-area')?.className,
      active: document.activeElement?.tagName + ' ' + (document.activeElement?.getAttribute('aria-label') ?? ''),
      hovered: [...document.querySelectorAll(':hover')].map((e) => e.className).slice(-3),
      menu: !!document.querySelector('[role=menu]')
    }))
  for (const part of ['.stage-controls', '.spotlight-strip', '.spotlight-main .tile-bar']) {
    await expect
      .poll(() => opacity(part), { timeout: 6_000, message: `${part} hides` })
      .toBe('0')
      .catch(async (err) => {
        console.log('WHY', JSON.stringify(await why()))
        throw err
      })
  }
  if (shots) await win.screenshot({ path: `${shots}/4-fullscreen-idle.png` })
  await win.mouse.move(10, 10)
  await expect.poll(() => opacity('.stage-controls')).toBe('1')
  await expect.poll(() => opacity('.spotlight-main .tile-bar')).toBe('1')
  await win.getByRole('button', { name: 'Exit full screen' }).click()
  await expect.poll(() => win.evaluate(() => !!document.fullscreenElement)).toBe(false)

  // Entering full screen with its button (which keeps focus after the click) still lets the controls hide.
  await win.locator('.stage-controls').getByRole('button', { name: 'Full screen' }).click()
  await expect.poll(() => win.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await win.mouse.move(200, 200)
  await expect.poll(() => opacity('.stage-controls'), { timeout: 6_000, message: 'controls hide' }).toBe('0')
  await win.mouse.move(10, 10)
  await win.getByRole('button', { name: 'Exit full screen' }).click()
  await expect.poll(() => win.evaluate(() => !!document.fullscreenElement)).toBe(false)

  // Focus his own picture: Alice's stream goes to the strip, and the grid button appears.
  await win.locator('.person-tile', { hasText: 'Bob (you)' }).click()
  await expect(win.locator('.spotlight-strip video')).toHaveCount(1)
  await expect(win.getByRole('button', { name: 'Grid view' })).toBeVisible()

  // Putting the strip away pauses Alice's video to him; she sees it.
  await win.getByRole('button', { name: 'Hide others' }).click()
  await expect(win.locator('.spotlight-strip')).toBeHidden()
  const bobOnAlice = alice.win.locator('.room-members .member', { hasText: 'Bob' })
  await expect(bobOnAlice).toContainText('not looking (video paused)', { timeout: 15_000 })
  await win.getByRole('button', { name: 'Show others (1)' }).click()
  await expect(bobOnAlice).not.toContainText('not looking', { timeout: 15_000 })

  await win.getByRole('button', { name: 'Grid view' }).click()
  await expect(win.locator('.stage-spotlight')).toHaveCount(0)
})
