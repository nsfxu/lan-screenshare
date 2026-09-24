import { WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '../src/shared/types'
import { PROTOCOL_VERSION } from '../src/shared/constants'

/** Test WebSocket client that records messages and can await specific ones. */
export class TestClient {
  readonly messages: ServerMessage[] = []
  readonly binary: Buffer[] = []
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []
  closed = false

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.binary.push(data as Buffer)
        return
      }
      const msg = JSON.parse(data.toString()) as ServerMessage
      this.messages.push(msg)
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(msg)) return true
        w.resolve(msg)
        return false
      })
    })
    ws.on('close', () => {
      this.closed = true
    })
  }

  static async connect(port: number, hello: Partial<Extract<ClientMessage, { type: 'hello' }>>): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve())
      ws.once('error', reject)
    })
    const client = new TestClient(ws)
    client.send({ type: 'hello', protocol: PROTOCOL_VERSION, clientId: 'c-' + Math.random(), name: 'Test', ...hello } as ClientMessage)
    return client
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg))
  }

  wait<T extends ServerMessage['type']>(
    type: T,
    pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 3000
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const match = (m: ServerMessage): boolean => m.type === type && pred(m as Extract<ServerMessage, { type: T }>)
    const existing = this.messages.find(match)
    if (existing) return Promise.resolve(existing as Extract<ServerMessage, { type: T }>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as Extract<ServerMessage, { type: T }>)
        }
      })
    })
  }

  async waitClosed(timeoutMs = 3000): Promise<void> {
    const start = Date.now()
    while (!this.closed) {
      if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for close')
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  close(): void {
    this.ws.close()
  }
}
