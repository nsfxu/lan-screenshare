import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { RoomServer } from '../src/main/server'
import { PinGuard } from '../src/utils/crypto'
import { TestClient } from './helpers'

const HOST_TOKEN = 'host-secret-token'
let server: RoomServer | null = null
const clients: TestClient[] = []

async function startServer(opts: Partial<ConstructorParameters<typeof RoomServer>[0]> = {}): Promise<number> {
  server = new RoomServer({
    roomId: 'room1',
    name: 'Test room',
    hostName: 'Alice',
    privacy: 'public',
    pin: null,
    hostToken: HOST_TOKEN,
    port: 0,
    bindAddress: '127.0.0.1',
    ...opts
  })
  return server.start()
}

async function connect(port: number, hello: Parameters<typeof TestClient.connect>[1]): Promise<TestClient> {
  const c = await TestClient.connect(port, hello)
  clients.push(c)
  return c
}

function getJson(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      })
      .on('error', reject)
  })
}

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close())
  await server?.stop()
  server = null
})

describe('RoomServer', () => {
  it('serves public room info without secrets', async () => {
    const port = await startServer({ privacy: 'private', pin: '123456' })
    const res = await getJson(port, '/info')
    expect(res.status).toBe(200)
    const info = JSON.parse(res.body)
    expect(info).toMatchObject({ id: 'room1', name: 'Test room', privacy: 'private', viewerCount: 0 })
    expect(res.body).not.toContain('123456')
    expect(res.body).not.toContain(HOST_TOKEN)
    expect((await getJson(port, '/nope')).status).toBe(404)
  })

  it('lets viewers join a public room and broadcasts presence and chat', async () => {
    const port = await startServer()
    const host = await connect(port, { hostToken: HOST_TOKEN, name: 'Alice' })
    const welcomeHost = await host.wait('welcome')
    expect(welcomeHost.selfId).toBe('host')

    const bob = await connect(port, { name: 'Bob', clientId: 'bob' })
    const welcome = await bob.wait('welcome')
    expect(welcome.room.viewerCount).toBe(1)
    expect(welcome.participants.map((p) => p.name).sort()).toEqual(['Alice', 'Bob'])

    await host.wait('participants', (m) => m.participants.length === 2)
    bob.send({ type: 'chat', text: '  hello world  ' })
    const chat = await host.wait('chat', (m) => m.message.text === 'hello world')
    expect(chat.message.name).toBe('Bob')
    expect(chat.message.userId).toBe(welcome.selfId)
  })

  it('requires the PIN for private rooms and locks out after 3 wrong attempts', async () => {
    const guard = new PinGuard(3, 60_000)
    const port = await startServer({ privacy: 'private', pin: '4321', pinGuard: guard })

    const noPin = await connect(port, { name: 'Eve' })
    expect((await noPin.wait('error')).code).toBe('pin_required')
    await noPin.waitClosed()

    for (const attemptsLeft of [2, 1]) {
      const c = await connect(port, { name: 'Eve', pin: '0000' })
      const err = await c.wait('error')
      expect(err.code).toBe('bad_pin')
      expect(err.attemptsLeft).toBe(attemptsLeft)
    }
    const third = await connect(port, { name: 'Eve', pin: '0000' })
    expect((await third.wait('error')).code).toBe('locked')

    // Even the right PIN is refused while locked out.
    const locked = await connect(port, { name: 'Eve', pin: '4321' })
    const err = await locked.wait('error')
    expect(err.code).toBe('locked')
    expect(err.retryAfterMs).toBeGreaterThan(0)
  })

  it('accepts the correct PIN and honours a PIN change for new joiners only', async () => {
    const port = await startServer({ privacy: 'private', pin: '4321' })
    const bob = await connect(port, { name: 'Bob', pin: '4321' })
    await bob.wait('welcome')

    server!.update({ pin: '9999' })
    await bob.wait('room')
    expect(bob.closed).toBe(false)

    const old = await connect(port, { name: 'Carol', pin: '4321' })
    expect((await old.wait('error')).code).toBe('bad_pin')
    const fresh = await connect(port, { name: 'Carol', pin: '9999' })
    await fresh.wait('welcome')
  })

  it('rejects a forged host token', async () => {
    const port = await startServer()
    const c = await connect(port, { hostToken: 'wrong' })
    expect((await c.wait('error')).code).toBe('host_only')
  })

  it('lets only the host kick, and kicked users cannot rejoin', async () => {
    const port = await startServer()
    const host = await connect(port, { hostToken: HOST_TOKEN })
    await host.wait('welcome')
    const bob = await connect(port, { name: 'Bob', clientId: 'bob' })
    const bobWelcome = await bob.wait('welcome')
    const carol = await connect(port, { name: 'Carol', clientId: 'carol' })
    await carol.wait('welcome')

    carol.send({ type: 'kick', userId: bobWelcome.selfId })
    expect((await carol.wait('error')).code).toBe('host_only')

    host.send({ type: 'kick', userId: bobWelcome.selfId })
    await bob.wait('kicked')
    await bob.waitClosed()
    await host.wait('participants', (m) => m.participants.length === 2)

    const again = await connect(port, { name: 'Bob', clientId: 'bob' })
    expect((await again.wait('error')).code).toBe('kicked')
  })

  it('supports chat mute and message deletion by the host', async () => {
    const port = await startServer()
    const host = await connect(port, { hostToken: HOST_TOKEN })
    await host.wait('welcome')
    const bob = await connect(port, { name: 'Bob' })
    await bob.wait('welcome')

    bob.send({ type: 'chat', text: 'first' })
    const first = await host.wait('chat', (m) => m.message.text === 'first')
    host.send({ type: 'delete-message', id: first.message.id })
    await bob.wait('chat-deleted', (m) => m.id === first.message.id)

    host.send({ type: 'mute-chat', muted: true })
    await bob.wait('room', (m) => m.room.chatMuted)
    bob.send({ type: 'chat', text: 'blocked' })
    expect((await bob.wait('error')).code).toBe('chat_muted')
    host.send({ type: 'chat', text: 'host can still talk' })
    await bob.wait('chat', (m) => m.message.text === 'host can still talk')
  })

  it('resumes a dropped viewer seat without the PIN', async () => {
    const port = await startServer({ privacy: 'private', pin: '5555' })
    const bob = await connect(port, { name: 'Bob', clientId: 'bob', pin: '5555' })
    const welcome = await bob.wait('welcome')
    bob.ws.terminate()
    await bob.waitClosed()

    const back = await connect(port, { name: 'Bob', clientId: 'bob', resumeToken: welcome.resumeToken })
    const again = await back.wait('welcome')
    expect(again.selfId).toBe(welcome.selfId)
    expect(again.participants.filter((p) => p.name === 'Bob')).toHaveLength(1)
  })

  it('enforces the room capacity', async () => {
    const port = await startServer({ maxUsers: 3 })
    const host = await connect(port, { hostToken: HOST_TOKEN })
    await host.wait('welcome')
    for (const name of ['A', 'B']) await (await connect(port, { name })).wait('welcome')
    const extra = await connect(port, { name: 'C' })
    expect((await extra.wait('error')).code).toBe('room_full')
  })

  it('tells everyone when the room ends', async () => {
    const port = await startServer()
    const host = await connect(port, { hostToken: HOST_TOKEN })
    await host.wait('welcome')
    const bob = await connect(port, { name: 'Bob' })
    await bob.wait('welcome')
    host.send({ type: 'end-room' })
    const ended = await bob.wait('room-ended')
    expect(ended.reason).toMatch(/ended/)
    await bob.waitClosed()
  })
})
