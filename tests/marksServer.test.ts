import { afterEach, describe, expect, it } from 'vitest'
import { RoomServer } from '../src/main/server'
import { POINTER_RATE } from '../src/shared/marks'
import type { Participant, ServerMessage } from '../src/shared/types'
import { TestClient } from './helpers'

// Drawing on a stream (shared/marks.ts): the room server relays marks only
// inside a stream's audience, and only what's valid.

const HOST_TOKEN = 'host-secret-token'
let server: RoomServer | null = null
const clients: TestClient[] = []

afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  await server?.stop('test over')
  server = null
})

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

async function join(port: number, name: string, host = false): Promise<{ c: TestClient; id: string }> {
  const c = await TestClient.connect(port, host ? { hostToken: HOST_TOKEN, name } : { name, clientId: name })
  clients.push(c)
  const welcome = await c.wait('welcome')
  return { c, id: welcome.selfId }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const marks = (c: TestClient): ServerMessage[] =>
  c.messages.filter((m) => m.type === 'pointer' || m.type === 'stroke' || m.type === 'marks-cleared')

/** Alice (host) shares and allows drawing; Bob and Carol watch; Dave is in the room but doesn't watch. */
/** `drawing: 'missing'` is an app before 2.6.0, which doesn't say. */
async function room(drawing: boolean | 'missing' = true) {
  const port = await startServer()
  const alice = await join(port, 'Alice', true)
  const bob = await join(port, 'Bob')
  const carol = await join(port, 'Carol')
  const dave = await join(port, 'Dave')
  alice.c.send({ type: 'stream-state', sharing: true, paused: false, audio: false, ...(drawing === 'missing' ? {} : { drawing }) })
  await bob.c.wait('participants', (m) => !!m.participants.find((p) => p.id === alice.id)?.stream)
  for (const w of [bob, carol]) w.c.send({ type: 'watch', streamer: alice.id, transport: 'webrtc' })
  await alice.c.wait('watch-request', (m) => m.from === carol.id)
  return { port, alice, bob, carol, dave }
}

describe('marks on a stream', () => {
  it("relays a watcher's pointer and strokes to the streamer and the other watchers only", async () => {
    const { alice, bob, carol, dave } = await room()
    bob.c.send({ type: 'pointer', streamer: alice.id, x: 0.25, y: 0.75 })
    bob.c.send({ type: 'stroke', streamer: alice.id, id: 's1', points: [0.1, 0.1, 0.2, 0.2], done: true })
    for (const c of [alice.c, carol.c]) {
      expect(await c.wait('pointer')).toEqual({ type: 'pointer', from: bob.id, streamer: alice.id, x: 0.25, y: 0.75 })
      expect(await c.wait('stroke')).toEqual({ type: 'stroke', from: bob.id, streamer: alice.id, id: 's1', points: [0.1, 0.1, 0.2, 0.2], done: true })
    }
    await sleep(100)
    expect(marks(bob.c)).toHaveLength(0) // not echoed
    expect(marks(dave.c)).toHaveLength(0) // not watching
  })

  it('drops marks from people not watching, and anything out of range or malformed', async () => {
    const { alice, bob, carol, dave } = await room()
    dave.c.send({ type: 'pointer', streamer: alice.id, x: 0.5, y: 0.5 })
    bob.c.send({ type: 'pointer', streamer: alice.id, x: 1.5, y: 0.5 })
    bob.c.send({ type: 'pointer', streamer: alice.id, x: 0.5, y: null })
    bob.c.send({ type: 'stroke', streamer: alice.id, id: 'has space', points: [0.1, 0.1], done: false })
    bob.c.send({ type: 'stroke', streamer: alice.id, id: 's2', points: [0.1], done: false })
    bob.c.send({ type: 'stroke', streamer: alice.id, id: 's3', points: new Array(200).fill(0.5), done: false })
    // The streamer marks only by clearing: no pointer or strokes of its own.
    alice.c.send({ type: 'pointer', streamer: alice.id, x: 0.5, y: 0.5 })
    // A pointer that leaves the picture is fine.
    bob.c.send({ type: 'pointer', streamer: alice.id, x: null, y: null })
    expect(await carol.c.wait('pointer')).toMatchObject({ from: bob.id, x: null, y: null })
    await sleep(150)
    expect(marks(carol.c)).toHaveLength(1)
    expect(marks(alice.c)).toHaveLength(1)
  })

  it('limits how fast someone can send pointer updates', async () => {
    const { alice, bob } = await room()
    for (let i = 0; i < POINTER_RATE + 20; i++) bob.c.send({ type: 'pointer', streamer: alice.id, x: i / 100, y: 0.5 })
    await sleep(300)
    const got = marks(alice.c).length
    expect(got).toBeGreaterThan(POINTER_RATE / 2)
    expect(got).toBeLessThanOrEqual(POINTER_RATE)
  })

  it("clears one watcher's marks, or everyone's when the streamer clears", async () => {
    const { alice, bob, carol } = await room()
    bob.c.send({ type: 'clear-marks', streamer: alice.id })
    expect(await carol.c.wait('marks-cleared')).toEqual({ type: 'marks-cleared', from: bob.id, streamer: alice.id, all: false })
    alice.c.send({ type: 'clear-marks', streamer: alice.id })
    for (const c of [bob.c, carol.c]) {
      expect(await c.wait('marks-cleared', (m) => m.all)).toEqual({ type: 'marks-cleared', from: alice.id, streamer: alice.id, all: true })
    }
  })

  it("relays nothing for a streamer that doesn't allow drawing, or an older app that doesn't say", async () => {
    for (const drawing of [false, 'missing'] as const) {
      const { alice, bob } = await room(drawing)
      const stream = (bob.c.messages.filter((m) => m.type === 'participants').at(-1) as { participants: Participant[] })
        .participants.find((p) => p.id === alice.id)?.stream
      expect(stream?.drawing).toBe(drawing === 'missing' ? undefined : drawing)
      expect(stream && 'drawing' in stream).toBe(drawing !== 'missing')
      bob.c.send({ type: 'pointer', streamer: alice.id, x: 0.5, y: 0.5 })
      await sleep(150)
      expect(marks(alice.c)).toHaveLength(0)
      for (const c of clients.splice(0)) c.close()
      await server?.stop('next')
    }
  })

  it('lets only the host turn drawing off for the room', async () => {
    const { alice, bob, carol } = await room()
    expect((await bob.c.wait('room')).room.drawingAllowed).toBe(true)
    bob.c.send({ type: 'allow-drawing', allowed: false })
    expect(await bob.c.wait('error')).toMatchObject({ code: 'host_only' })
    alice.c.send({ type: 'allow-drawing', allowed: false })
    await bob.c.wait('room', (m) => m.room.drawingAllowed === false)
    bob.c.send({ type: 'pointer', streamer: alice.id, x: 0.5, y: 0.5 })
    await sleep(150)
    expect(marks(carol.c)).toHaveLength(0)
    alice.c.send({ type: 'allow-drawing', allowed: true })
    await bob.c.wait('room', (m) => m.room.drawingAllowed === true)
    bob.c.send({ type: 'pointer', streamer: alice.id, x: 0.5, y: 0.5 })
    expect(await carol.c.wait('pointer')).toMatchObject({ from: bob.id })
  })

  it('keeps the drawing setting when the streamer changes other things', async () => {
    const { alice, bob } = await room()
    alice.c.send({ type: 'stream-state', sharing: true, paused: true, audio: false, drawing: false })
    const last = await bob.c.wait('participants', (m) => !!m.participants.find((p) => p.id === alice.id)?.stream?.paused)
    expect(last.participants.find((p) => p.id === alice.id)?.stream).toMatchObject({ paused: true, drawing: false })
  })
})
