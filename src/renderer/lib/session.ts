import type { CodecSupport, HostedRoom, RoomEndpoint, Settings } from '../../shared/types'
import { roomUrl } from './format'
import { HostStreamer } from './hostStreamer'
import { RoomClient, type ClientError } from './roomClient'
import { ViewerReceiver } from './viewerReceiver'

export interface HostSession {
  role: 'host'
  client: RoomClient
  endpoint: RoomEndpoint
  streamer: HostStreamer
  hosted: HostedRoom
}

export interface ViewerSession {
  role: 'viewer'
  client: RoomClient
  endpoint: RoomEndpoint
  receiver: ViewerReceiver
}

export type Session = HostSession | ViewerSession

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

export async function joinRoom(
  endpoint: RoomEndpoint,
  settings: Settings,
  decoders: CodecSupport[],
  pin?: string
): Promise<ViewerSession> {
  const client = new RoomClient({
    url: roomUrl(endpoint),
    clientId: settings.clientId,
    name: settings.displayName,
    pin,
    decoders
  })
  await waitForWelcome(client)
  const receiver = new ViewerReceiver(client, settings.forceTcp)
  return { role: 'viewer', client, endpoint, receiver }
}

export async function hostRoom(
  hosted: HostedRoom,
  settings: Settings,
  encoders: CodecSupport[]
): Promise<HostSession> {
  const endpoint: RoomEndpoint = { address: '127.0.0.1', port: hosted.port, tls: hosted.tls, name: hosted.info.name }
  const client = new RoomClient({
    url: roomUrl(endpoint),
    clientId: settings.clientId,
    name: settings.displayName,
    hostToken: hosted.hostToken
  })
  await waitForWelcome(client)
  const streamer = new HostStreamer(client, settings, encoders)
  return { role: 'host', client, endpoint, streamer, hosted }
}

export function disposeSession(session: Session): void {
  if (session.role === 'host') session.streamer.dispose()
  else session.receiver.dispose()
  session.client.leave()
}
