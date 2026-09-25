import type { QualityPresetId } from './quality'

export type Privacy = 'public' | 'private'
export type Role = 'host' | 'viewer'
export type Transport = 'webrtc' | 'tcp'
export type CodecPreference = 'auto' | 'h264' | 'h265' | 'vp9' | 'av1'
export type ContentHint = 'motion' | 'detail'

/** Live, public information about a room (served at GET /info, no secrets). */
export interface RoomInfo {
  id: string
  name: string
  hostName: string
  privacy: Privacy
  viewerCount: number
  maxUsers: number
  /** Number of participants currently sharing their screen. */
  streams: number
  protocol: number
  startedAt: number
}

/** Full room state pushed to connected participants. */
export interface RoomState extends RoomInfo {
  chatMuted: boolean
  allowRecording: boolean
}

/** A room as it appears in the home-screen list. */
export interface DiscoveredRoom extends RoomInfo {
  /** Stable key: `address:port`. */
  key: string
  address: string
  port: number
  tls: boolean
  source: 'mdns' | 'manual'
  reachable: boolean
  lastSeen: number
  /** Ping to the room's /info endpoint in ms. */
  probeMs?: number
}

/** Where to connect: enough to build a wss:// URL. */
export interface RoomEndpoint {
  address: string
  port: number
  tls: boolean
  name?: string
}

export type MediaState = 'idle' | 'negotiating' | 'streaming' | 'failed'

/** What a participant is sharing. Anyone in a room may share their screen. */
export interface StreamInfo {
  paused: boolean
  /** System audio is being sent (captured and not muted). */
  audio: boolean
  startedAt: number
}

export interface Participant {
  id: string
  name: string
  role: Role
  color: string
  joinedAt: number
  status: 'connected' | 'reconnecting'
  /**
   * Small room-unique number identifying this participant in binary
   * (TCP-fallback) packets, which the server prefixes with the sender's slot.
   */
  slot: number
  /** Non-null while this participant shares their screen. */
  stream: StreamInfo | null
  /** Ids of the participants whose streams this participant is watching. */
  watching: string[]
}

export interface ChatMessage {
  id: string
  userId: string
  name: string
  color: string
  text: string
  ts: number
  system?: boolean
}

/** Stats a viewer reports to the host (and shows itself). */
export interface ViewerStats {
  fps: number
  latencyMs: number | null
  bitrateKbps: number
  packetLossPct: number
  width: number
  height: number
  codec: string
  transport: Transport | null
  decoder: string
  framesDropped: number
  /** Received audio bitrate; 0 when no audio is arriving. */
  audioKbps: number
}

/** Stats computed by the host for its own overlay. */
export interface HostStats {
  fps: number
  width: number
  height: number
  bitrateKbps: number
  avgRttMs: number | null
  encodeMs: number | null
  encoder: string
  codec: string
  cpuPercent: number
  memoryMB: number
  viewers: number
  qualityLimitation: string
  /** Sent audio bitrate summed over viewers; null when not sharing audio. */
  audioKbps: number | null
}

export interface CodecSupport {
  mimeType: string
  /** True when the platform reports the codec as power-efficient (≈ hardware). */
  hardware: boolean
}

export type ErrorCode =
  | 'bad_request'
  | 'version_mismatch'
  | 'pin_required'
  | 'bad_pin'
  | 'locked'
  | 'room_full'
  | 'kicked'
  | 'host_only'
  | 'chat_muted'
  | 'rate_limited'
  | 'not_sharing'

// ---------------------------------------------------------------------------
// Wire protocol (JSON over WebSocket). Binary frames carry TCP-fallback media.
//
// Streaming model: any participant may share ("streamer"); others explicitly
// watch it ("watcher"). The server only relays signaling between a streamer
// and its current watchers, so media flows directly streamer -> watcher.
// ---------------------------------------------------------------------------

/** Structurally identical to DOM's RTCIceCandidateInit (usable without DOM types). */
export interface IceCandidate {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type SignalData =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'candidate'; candidate: IceCandidate | null }

export type ClientMessage =
  | {
      type: 'hello'
      protocol: number
      clientId: string
      name: string
      pin?: string
      hostToken?: string
      resumeToken?: string
      /** Codecs this client can decode, used by the host's codec selection. */
      decoders?: CodecSupport[]
    }
  | { type: 'chat'; text: string }
  /** Only between a streamer and one of its watchers (either direction). */
  | { type: 'signal'; to: string; data: SignalData }
  | { type: 'ping'; t: number }
  | { type: 'bye' }
  // as a streamer
  | { type: 'stream-state'; sharing: boolean; paused: boolean; audio: boolean }
  | { type: 'publisher-stats'; encodeMs: number | null }
  // as a watcher
  | { type: 'watch'; streamer: string; transport: Transport }
  | { type: 'unwatch'; streamer: string }
  | { type: 'stats'; streamer: string; stats: ViewerStats; mediaState: MediaState }
  | { type: 'keyframe-request'; streamer: string }
  // host only
  | { type: 'kick'; userId: string }
  | { type: 'stop-stream'; userId: string }
  | { type: 'delete-message'; id: string }
  | { type: 'mute-chat'; muted: boolean }
  | { type: 'end-room' }

export type ServerMessage =
  | {
      type: 'welcome'
      selfId: string
      resumeToken: string
      room: RoomState
      participants: Participant[]
      history: ChatMessage[]
    }
  | { type: 'error'; code: ErrorCode; message: string; retryAfterMs?: number; attemptsLeft?: number; fatal: boolean }
  | { type: 'room'; room: RoomState }
  | { type: 'participants'; participants: Participant[] }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chat-deleted'; id: string }
  | { type: 'signal'; from: string; data: SignalData }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'kicked' }
  | { type: 'room-ended'; reason: string }
  // delivered to a streamer, about its watchers
  | { type: 'watch-request'; from: string; transport: Transport; decoders: CodecSupport[] }
  | { type: 'watcher-left'; id: string }
  | { type: 'watcher-stats'; from: string; stats: ViewerStats; mediaState: MediaState }
  | { type: 'keyframe-request'; from: string }
  | { type: 'tcp-feedback'; sent: number; dropped: number }
  /** The host stopped this participant's stream. */
  | { type: 'stream-stopped'; reason: string }
  // delivered to a watcher, about a streamer it watches
  | { type: 'publisher-stats'; from: string; encodeMs: number | null }
  /** The streamer stopped sharing or left; the subscription is gone. */
  | { type: 'stream-ended'; streamer: string }

// ---------------------------------------------------------------------------
// Local (IPC) types
// ---------------------------------------------------------------------------

export interface Settings {
  clientId: string
  displayName: string
  maxQuality: QualityPresetId
  adaptiveQuality: boolean
  codec: CodecPreference
  contentHint: ContentHint
  forceTcp: boolean
  useTls: boolean
  preferredPort: number
  autoRejoin: boolean
  lastRoom: RoomEndpoint | null
  manualServers: RoomEndpoint[]
  notifications: boolean
  pauseOnMinimize: boolean
  showStatsOverlay: boolean
  /** Capture system audio along with the screen when sharing. */
  shareAudio: boolean
}

export interface CreateRoomRequest {
  name: string
  privacy: Privacy
  pinLength: number
}

export interface HostedRoom {
  info: RoomInfo
  port: number
  tls: boolean
  hostToken: string
  pin: string | null
  addresses: string[]
}

export interface UpdateRoomRequest {
  name?: string
  privacy?: Privacy
  /** A specific PIN, or 'regenerate'. */
  pin?: string | 'regenerate'
  pinLength?: number
}

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
  displayId: string
  width?: number
  height?: number
}

export interface SystemStats {
  cpuPercent: number
  memoryMB: number
}

export interface AppInfo {
  version: string
  platform: string
  logDir: string
}

export type ScreenPermission = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

/** PCM format produced by the native Windows loopback helper (float32 interleaved). */
export interface NativeAudioFormat {
  /** Identifies one helper run; events from earlier runs must be ignored. */
  id: number
  sampleRate: number
  channels: number
}
