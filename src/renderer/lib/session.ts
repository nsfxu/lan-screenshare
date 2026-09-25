import type { CodecSupport, HostedRoom, RoomEndpoint, Role, Settings } from '../../shared/types'
import { roomUrl } from './format'
import { Publisher } from './publisher'
import { RoomClient, type ClientError } from './roomClient'
import { WatchManager } from './watches'

/**
 * A joined room. Everyone can share (publisher) and watch others (watches);
 * the host additionally owns the room itself (`hosted`).
 */
export interface Session {
  role: Role
  client: RoomClient
  endpoint: RoomEndpoint
  publisher: Publisher
  watches: WatchManager
  hosted: HostedRoom | null
}

export class JoinError extends Error {
  constructor(readonly detail: ClientError) {
    super(detail.message)
  }
}

/** Open a RoomClient and resolve once the server has welcomed us. */
function waitForWelcome(client: RoomClient): Promise<void> {
  return new Promise((resolve, reject) => {
    let lastError: ClientError | null = null
    const offs = [
      client.on('welcome', () => {
        offs.forEach((o) => o())
        resolve()
      }),
      client.on('error', (e) => {
        lastError = e
      }),
      client.on('closed', ({ reason, code }) => {
        offs.forEach((o) => o())
        reject(new JoinError(lastError ?? { code: code === 'ended' || code === 'kicked' ? 'connection' : code, message: reason }))
      })
    ]
  })
}

interface Codecs {
  encoders: CodecSupport[]
  decoders: CodecSupport[]
}

function createSession(
  role: Role,
  client: RoomClient,
  endpoint: RoomEndpoint,
  settings: Settings,
  codecs: Codecs,
  hosted: HostedRoom | null
): Session {
  return {
    role,
    client,
    endpoint,
    publisher: new Publisher(client, settings, codecs.encoders),
    watches: new WatchManager(client, settings),
    hosted
  }
}

export async function joinRoom(endpoint: RoomEndpoint, settings: Settings, codecs: Codecs, pin?: string): Promise<Session> {
  const client = new RoomClient({
    url: roomUrl(endpoint),
    clientId: settings.clientId,
    name: settings.displayName,
    pin,
    decoders: codecs.decoders
  })
  await waitForWelcome(client)
  return createSession('viewer', client, endpoint, settings, codecs, null)
}

export async function hostRoom(hosted: HostedRoom, settings: Settings, codecs: Codecs): Promise<Session> {
  const endpoint: RoomEndpoint = { address: '127.0.0.1', port: hosted.port, tls: hosted.tls, name: hosted.info.name }
  const client = new RoomClient({
    url: roomUrl(endpoint),
    clientId: settings.clientId,
    name: settings.displayName,
    hostToken: hosted.hostToken,
    decoders: codecs.decoders
  })
  await waitForWelcome(client)
  return createSession('host', client, endpoint, settings, codecs, hosted)
}

export function disposeSession(session: Session): void {
  session.watches.dispose()
  session.publisher.dispose()
  session.client.leave()
}

export function updateSessionSettings(session: Session, settings: Settings): void {
  session.publisher.updateSettings(settings)
  session.watches.updateSettings(settings)
}
