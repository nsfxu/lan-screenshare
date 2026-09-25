import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { BINARY_FLAG_KEY, BINARY_KIND_AUDIO, BINARY_KIND_VIDEO } from '../src/shared/constants'
import { RoomServer } from '../src/main/server'
import type { Participant, ViewerStats } from '../src/shared/types'
import { TestClient } from './helpers'

const HOST_TOKEN = 'host-secret-token'
let server: RoomServer | null = null
const clients: TestClient[] = []

async function startServer(): Promise<number> {
  server = new RoomServer({
    roomId: 'room1',
    name: 'Test room',
    hostName: 'Alice',
    privacy: 'public',
    pin: null,
    hostToken: HOST_TOKEN,
    port: 0,
    bindAddress: '127.0.0.1'
  })
  return server.start()
}

/** Join and return the client plus its participant id. */
async function join(port: number, name: string, host = false): Promise<{ c: TestClient; id: string }> {
  const c = await TestClient.connect(port, host ? { hostToken: HOST_TOKEN, name } : { name, clientId: name })
  clients.push(c)
  const welcome = await c.wait('welcome')
  return { c, id: welcome.selfId }
}

function share(c: TestClient, opts: { paused?: boolean; audio?: boolean } = {}): void {
  c.send({ type: 'stream-state', sharing: true, paused: opts.paused ?? false, audio: opts.audio ?? false })
}

const latest = (c: TestClient): Participant[] => {
  const list = c.messages.filter((m) => m.type === 'participants')
  const last = list[list.length - 1]
  return last && last.type === 'participants' ? last.participants : []
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const STATS: ViewerStats = {
  fps: 60,
  latencyMs: 30,
  bitrateKbps: 8000,
  packetLossPct: 0,
  width: 1920,
  height: 1080,
  codec: 'H264',
  transport: 'webrtc',
  decoder: 'x',
  framesDropped: 0,
  audioKbps: 128
}

function getInfo(port: number): Promise<{ streams: number }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/info`, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve(JSON.parse(body)))
      })
      .on('error', reject)
  })
}

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close())
  await server?.stop()
  server = null
})

describe('multi-stream: sharing', () => {
  it('lets any participant share and publishes it to the room', async () => {
    const port = await startServer()
    const host = await join(port, 'Host', true)
    const bob = await join(port, 'Bob')

    share(bob.c, { audio: true })
    await host.c.wait('participants', (m) => !!m.participants.find((p) => p.id === bob.id)?.stream)
    const p = latest(host.c).find((x) => x.id === bob.id)!
    expect(p.stream).toMatchObject({ paused: false, audio: true })
    await host.c.wait('room', (m) => m.room.streams === 1)
    expect((await getInfo(port)).streams).toBe(1)
    await host.c.wait('chat', (m) => m.message.text === 'Bob started sharing their screen')

    // Pausing also reports audio as off.
    share(bob.c, { paused: true, audio: true })
    await host.c.wait('participants', (m) => !!m.participants.find((x) => x.id === bob.id)?.stream?.paused)
    expect(latest(host.c).find((x) => x.id === bob.id)!.stream!.audio).toBe(false)
  })

  it('assigns distinct slots to participants', async () => {
    const port = await startServer()
    const host = await join(port, 'Host', true)
    await join(port, 'Bob')
    await join(port, 'Carol')
    await host.c.wait('participants', (m) => m.participants.length === 3)
    const slots = latest(host.c).map((p) => p.slot)
    expect(new Set(slots).size).toBe(3)
  })

  it('refuses to watch someone who is not sharing, or yourself', async () => {
    const port = await startServer()
    await join(port, 'Host', true)
    const bob = await join(port, 'Bob')
    const carol = await join(port, 'Carol')

    carol.c.send({ type: 'watch', streamer: bob.id, transport: 'webrtc' })
    const err = await carol.c.wait('error')
    expect(err).toMatchObject({ code: 'not_sharing', fatal: false })

    share(carol.c)
    await carol.c.wait('room', (m) => m.room.streams === 1)
    carol.c.send({ type: 'watch', streamer: carol.id, transport: 'webrtc' })
    await carol.c.wait('error', (e) => e.code === 'bad_request')
    expect(carol.c.closed).toBe(false)
  })
})

describe('multi-stream: watching and signaling', () => {
  it('connects a watcher to a streamer and isolates signaling to that pair', async () => {
    const port = await startServer()
    const host = await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')
    const carol = await join(port, 'Carol')

    share(alice.c)
    await bob.c.wait('room', (m) => m.room.streams === 1)
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
    const req = await alice.c.wait('watch-request')
    expect(req).toMatchObject({ from: bob.id, transport: 'webrtc' })
    await host.c.wait('participants', (m) => m.participants.find((p) => p.id === bob.id)?.watching[0] === alice.id)

    // Streamer <-> watcher works both ways.
    alice.c.send({ type: 'signal', to: bob.id, data: { kind: 'offer', sdp: 'offer' } })
    expect((await bob.c.wait('signal')).from).toBe(alice.id)
    bob.c.send({ type: 'signal', to: alice.id, data: { kind: 'answer', sdp: 'answer' } })
    expect((await alice.c.wait('signal')).from).toBe(bob.id)

    // Nobody else — not even the host — can signal into that pair.
    carol.c.send({ type: 'signal', to: alice.id, data: { kind: 'answer', sdp: 'evil' } })
    carol.c.send({ type: 'signal', to: bob.id, data: { kind: 'offer', sdp: 'evil' } })
    host.c.send({ type: 'signal', to: bob.id, data: { kind: 'offer', sdp: 'evil' } })
    await sleep(150)
    expect(alice.c.messages.filter((m) => m.type === 'signal')).toHaveLength(1)
    expect(bob.c.messages.filter((m) => m.type === 'signal')).toHaveLength(1)
  })

  it('supports several streamers at once, each watched independently', async () => {
    const port = await startServer()
    const host = await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')

    share(host.c)
    share(alice.c)
    await bob.c.wait('room', (m) => m.room.streams === 2)
    bob.c.send({ type: 'watch', streamer: host.id, transport: 'webrtc' })
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'tcp' })
    expect((await host.c.wait('watch-request')).transport).toBe('webrtc')
    expect((await alice.c.wait('watch-request')).transport).toBe('tcp')
    await bob.c.wait('participants', (m) => m.participants.find((p) => p.id === bob.id)?.watching.length === 2)

    // Host watches Alice too: streamers can watch each other.
    host.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
    await alice.c.wait('watch-request', (m) => m.from === host.id)

    bob.c.send({ type: 'unwatch', streamer: host.id })
    expect((await host.c.wait('watcher-left')).id).toBe(bob.id)
    await bob.c.wait('participants', (m) => {
      const w = m.participants.find((p) => p.id === bob.id)?.watching
      return w?.length === 1 && w[0] === alice.id
    })
    expect(alice.c.messages.some((m) => m.type === 'watcher-left')).toBe(false)
  })

  it('routes stats and keyframe requests to the streamer, and publisher stats to its watchers', async () => {
    const port = await startServer()
    await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')
    const carol = await join(port, 'Carol')

    share(alice.c)
    await bob.c.wait('room', (m) => m.room.streams === 1)
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
    await alice.c.wait('watch-request')

    bob.c.send({ type: 'stats', streamer: alice.id, stats: STATS, mediaState: 'streaming' })
    const stats = await alice.c.wait('watcher-stats')
    expect(stats).toMatchObject({ from: bob.id, mediaState: 'streaming' })
    expect(stats.stats.fps).toBe(60)

    bob.c.send({ type: 'keyframe-request', streamer: alice.id })
    expect((await alice.c.wait('keyframe-request')).from).toBe(bob.id)

    alice.c.send({ type: 'publisher-stats', encodeMs: 4.2 })
    expect(await bob.c.wait('publisher-stats')).toMatchObject({ from: alice.id, encodeMs: 4.2 })

    // Carol isn't watching: she gets neither, and her stats go nowhere.
    carol.c.send({ type: 'stats', streamer: alice.id, stats: STATS, mediaState: 'streaming' })
    await sleep(150)
    expect(carol.c.messages.some((m) => m.type === 'publisher-stats')).toBe(false)
    expect(alice.c.messages.filter((m) => m.type === 'watcher-stats')).toHaveLength(1)
  })
})

describe('multi-stream: ending streams', () => {
  it('tells watchers when a streamer stops, and closes the signaling path', async () => {
    const port = await startServer()
    await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')

    share(alice.c)
    await bob.c.wait('room', (m) => m.room.streams === 1)
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
    await alice.c.wait('watch-request')

    alice.c.send({ type: 'stream-state', sharing: false, paused: false, audio: false })
    expect((await bob.c.wait('stream-ended')).streamer).toBe(alice.id)
    await bob.c.wait('room', (m) => m.room.streams === 0)
    await bob.c.wait('participants', (m) => m.participants.find((p) => p.id === bob.id)?.watching.length === 0)

    bob.c.send({ type: 'signal', to: alice.id, data: { kind: 'answer', sdp: 'late' } })
    await sleep(150)
    expect(alice.c.messages.some((m) => m.type === 'signal')).toBe(false)
  })

  it('ends the stream when the streamer disconnects, and drops a disconnected watcher', async () => {
    const port = await startServer()
    await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')
    const carol = await join(port, 'Carol')

    share(alice.c)
    share(carol.c)
    await bob.c.wait('room', (m) => m.room.streams === 2)
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
    bob.c.send({ type: 'watch', streamer: carol.id, transport: 'webrtc' })
    await alice.c.wait('watch-request')
    await carol.c.wait('watch-request')

    alice.c.ws.terminate()
    expect((await bob.c.wait('stream-ended')).streamer).toBe(alice.id)

    bob.c.ws.terminate()
    expect((await carol.c.wait('watcher-left')).id).toBe(bob.id)
  })

  it('lets only the host stop someone else’s stream', async () => {
    const port = await startServer()
    const host = await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')

    share(alice.c)
    await bob.c.wait('room', (m) => m.room.streams === 1)
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
    await alice.c.wait('watch-request')

    bob.c.send({ type: 'stop-stream', userId: alice.id })
    expect((await bob.c.wait('error')).code).toBe('host_only')

    host.c.send({ type: 'stop-stream', userId: alice.id })
    expect((await alice.c.wait('stream-stopped')).reason).toMatch(/host/)
    expect((await bob.c.wait('stream-ended')).streamer).toBe(alice.id)
    await host.c.wait('chat', (m) => m.message.text === "The host stopped Alice's stream")
  })

  it('ends a kicked streamer’s stream for its watchers', async () => {
    const port = await startServer()
    const host = await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')

    share(alice.c)
    await bob.c.wait('room', (m) => m.room.streams === 1)
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
    await alice.c.wait('watch-request')
    host.c.send({ type: 'kick', userId: alice.id })
    expect((await bob.c.wait('stream-ended')).streamer).toBe(alice.id)
  })
})

describe('multi-stream: TCP fallback relay', () => {
  it('tags packets with the streamer slot and gates video per subscription', async () => {
    const port = await startServer()
    const host = await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')
    const carol = await join(port, 'Carol')

    share(host.c)
    share(alice.c)
    await bob.c.wait('room', (m) => m.room.streams === 2)
    bob.c.send({ type: 'watch', streamer: host.id, transport: 'tcp' })
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'tcp' })
    carol.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
    await host.c.wait('watch-request')
    await alice.c.wait('watch-request', (m) => m.from === carol.id)
    await alice.c.wait('watch-request', (m) => m.from === bob.id)
    const slots = new Map(latest(bob.c).map((p) => [p.id, p.slot]))

    const key = (tag: number): Buffer => Buffer.from([BINARY_KIND_VIDEO, BINARY_FLAG_KEY, tag])
    const delta = (tag: number): Buffer => Buffer.from([BINARY_KIND_VIDEO, 0, tag])
    host.c.ws.send(delta(1)) // dropped: no keyframe yet on the host subscription
    alice.c.ws.send(key(2)) // opens only Alice's gate
    host.c.ws.send(delta(3)) // still dropped
    alice.c.ws.send(delta(4))
    host.c.ws.send(key(5))
    host.c.ws.send(delta(6))
    await sleep(250)

    // Packets from different streamers arrive over different sockets, so only
    // the order within one streamer's stream is guaranteed.
    const from = (id: string): { key: number; tag: number }[] =>
      bob.c.binary.filter((b) => b[0] === slots.get(id) && b[1] === BINARY_KIND_VIDEO).map((b) => ({ key: b[2], tag: b[3] }))
    expect(bob.c.binary).toHaveLength(4)
    expect(from(alice.id)).toEqual([
      { key: BINARY_FLAG_KEY, tag: 2 },
      { key: 0, tag: 4 }
    ])
    expect(from(host.id)).toEqual([
      { key: BINARY_FLAG_KEY, tag: 5 },
      { key: 0, tag: 6 }
    ])
    // WebRTC watchers never receive relayed media.
    expect(carol.c.binary).toHaveLength(0)

    // Someone who isn't sharing can't inject media.
    carol.c.ws.send(key(9))
    await sleep(100)
    expect(bob.c.binary).toHaveLength(4)
  })

  it('relays audio without opening the video keyframe gate', async () => {
    const port = await startServer()
    await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')

    share(alice.c, { audio: true })
    await bob.c.wait('room', (m) => m.room.streams === 1)
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'tcp' })
    await alice.c.wait('watch-request')

    alice.c.ws.send(Buffer.from([BINARY_KIND_AUDIO, 0, 7])) // delivered before any keyframe
    alice.c.ws.send(Buffer.from([BINARY_KIND_VIDEO, 0, 1])) // still gated
    alice.c.ws.send(Buffer.from([BINARY_KIND_VIDEO, BINARY_FLAG_KEY, 2]))
    await sleep(200)
    expect(bob.c.binary.map((b) => [b[1], b[2]])).toEqual([
      [BINARY_KIND_AUDIO, 0],
      [BINARY_KIND_VIDEO, BINARY_FLAG_KEY]
    ])
  })

  it('reports TCP relay stats to the streamer they belong to', async () => {
    const port = await startServer()
    const host = await join(port, 'Host', true)
    const alice = await join(port, 'Alice')
    const bob = await join(port, 'Bob')

    share(alice.c)
    await bob.c.wait('room', (m) => m.room.streams === 1)
    bob.c.send({ type: 'watch', streamer: alice.id, transport: 'tcp' })
    await alice.c.wait('watch-request')
    alice.c.ws.send(Buffer.from([BINARY_KIND_VIDEO, 0, 1])) // dropped (no keyframe)
    alice.c.ws.send(Buffer.from([BINARY_KIND_VIDEO, BINARY_FLAG_KEY, 2])) // sent

    const feedback = await alice.c.wait('tcp-feedback', () => true, 4000)
    expect(feedback).toMatchObject({ sent: 1, dropped: 1 })
    expect(host.c.messages.some((m) => m.type === 'tcp-feedback')).toBe(false)
  })
})
