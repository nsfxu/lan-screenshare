import type { Page } from '@playwright/test'
import { createRoom, decodedFrames, expect, joinByIp, test } from './fixtures'

/**
 * Make WebRTC report that every video sender is limited by `reason` (or stop
 * doing so with null), as if the computer or the network couldn't keep up.
 */
async function fakeLimitation(win: Page, reason: 'cpu' | 'bandwidth' | null): Promise<void> {
  await win.evaluate((r) => {
    const proto = RTCPeerConnection.prototype as RTCPeerConnection & { realGetStats?: RTCPeerConnection['getStats'] }
    proto.realGetStats ??= proto.getStats
    if (!r) {
      proto.getStats = proto.realGetStats
      return
    }
    proto.getStats = async function (this: RTCPeerConnection, ...args: Parameters<RTCPeerConnection['getStats']>) {
      const report = await proto.realGetStats!.apply(this, args)
      const copy = new Map<string, unknown>()
      report.forEach((s: Record<string, unknown>, id: string) =>
        copy.set(id, s.type === 'outbound-rtp' && s.kind === 'video' ? { ...s, qualityLimitationReason: r } : s)
      )
      return copy as unknown as RTCStatsReport
    } as RTCPeerConnection['getStats']
  }, reason)
}

test('a streamer who struggles is told why, and can lower the quality from the notice', async ({ people }) => {
  const [alice, bob] = await people(2)
  const port = await createRoom(alice)
  await joinByIp(bob, port)
  await bob.win.getByRole('button', { name: "Watch Alice's stream" }).click()
  await expect.poll(() => decodedFrames(bob.win), { timeout: 30_000 }).toBeGreaterThan(30)

  // A short spike says nothing; a lasting problem does, after ~8 s.
  const notice = alice.win.locator('.struggle-hint')
  await fakeLimitation(alice.win, 'cpu')
  await alice.win.waitForTimeout(4000)
  await expect(notice).toHaveCount(0)
  await expect(notice).toContainText('Your computer is struggling to encode', { timeout: 15_000 })

  // It goes away by itself once the problem is gone.
  await fakeLimitation(alice.win, null)
  await expect(notice).toHaveCount(0, { timeout: 15_000 })

  // The network this time: lower the quality from the notice.
  const quality = alice.win.getByLabel('Maximum quality you send')
  const before = await quality.inputValue()
  await fakeLimitation(alice.win, 'bandwidth')
  await expect(notice).toContainText("The network can't keep up", { timeout: 20_000 })
  await notice.getByRole('button', { name: /^Lower to / }).click()
  await expect(notice).toHaveCount(0)
  await expect(quality).not.toHaveValue(before)
})
