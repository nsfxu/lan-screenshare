import type { LanguageSetting } from './i18n'
import type { QualityPresetId } from './quality'
import type { StruggleKind } from './struggle'
import type { ThemeId } from './themes'

export type Privacy = 'public' | 'private'
export type Role = 'host' | 'viewer'
export type Transport = 'webrtc' | 'tcp'
export type CodecPreference = 'auto' | 'h264' | 'h265' | 'vp9' | 'av1'
export type ContentHint = 'motion' | 'detail'
/** "Optimize for": a fixed hint, or automatic (see autoContentHint). */
export type ContentHintSetting = 'auto' | ContentHint

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
  /** The host's app version (e.g. "1.2.0"); missing for hosts before 1.2.0. */
  appVersion?: string
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
  /** Their app version, as sent in hello; missing for apps before 1.2.0. */
  appVersion?: string
}

export interface ChatMessage {
  id: string
  userId: string
  name: string
  color: string
  text: string
  ts: number
  system?: boolean
  /**
   * What a system line is about, so each app can say it in its own language
   * (2.4.0+). `text` stays, in English, for older apps and as the fallback.
   */
  event?: SystemEvent
}

/** The room's announcements in the chat (see systemText in shared/chat.ts). */
export type SystemEvent =
  | { kind: 'joined' | 'left' | 'removed' | 'started-sharing' | 'stopped-sharing' | 'stream-stopped'; name: string }
  | { kind: 'chat-muted' | 'chat-unmuted' }

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
  /** The whole computer, games and other apps included (see SystemStats). */
  computerCpuPercent: number | null
  computerMemoryMB: number
  computerMemoryTotalMB: number
  viewers: number
  qualityLimitation: string
  /** Sent audio bitrate summed over viewers; null when not sharing audio. */
  audioKbps: number | null
  /** The content hint in use, and whether it was chosen automatically. */
  contentHint: ContentHint
  contentHintAuto: boolean
  /** What we've been struggling with recently (see shared/struggle.ts); empty when all is well. */
  struggling: StruggleKind[]
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
      /** Our app version (e.g. "1.2.0"), shown to others in the room. Optional: older apps don't send it. */
      appVersion?: string
    }
  | { type: 'chat'; text: string }
  /** My profile picture (small JPEG/WebP/PNG data URL) or null to remove it; sent after every welcome. */
  | { type: 'set-avatar'; image: string | null }
  /**
   * Only between a streamer and one of its watchers (either direction).
   * `stream` names the streamer whose connection this belongs to, since two
   * people can watch each other and then share two connections.
   */
  | { type: 'signal'; to: string; stream: string; data: SignalData }
  | { type: 'ping'; t: number }
  | { type: 'bye' }
  // as a streamer
  | { type: 'stream-state'; sharing: boolean; paused: boolean; audio: boolean }
  | { type: 'publisher-stats'; encodeMs: number | null }
  /** Small preview of the shared screen (JPEG/WebP data URL), sent periodically. */
  | { type: 'snapshot'; image: string }
  // as a watcher
  | { type: 'watch'; streamer: string; transport: Transport }
  | { type: 'unwatch'; streamer: string }
  | { type: 'stats'; streamer: string; stats: ViewerStats; mediaState: MediaState }
  | { type: 'keyframe-request'; streamer: string }
  /**
   * Pixel height I display this stream at, or the lower maximum I chose, and
   * the frame rate I chose (null = no limit), so the streamer can send less.
   */
  | { type: 'view-size'; streamer: string; height: number | null; fps: number | null }
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
  | { type: 'signal'; from: string; stream: string; data: SignalData }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'kicked' }
  | { type: 'room-ended'; reason: string }
  // delivered to a streamer, about its watchers
  | { type: 'watch-request'; from: string; transport: Transport; decoders: CodecSupport[] }
  | { type: 'watcher-left'; id: string }
  | { type: 'watcher-stats'; from: string; stats: ViewerStats; mediaState: MediaState }
  | { type: 'keyframe-request'; from: string }
  | { type: 'tcp-feedback'; sent: number; dropped: number }
  | { type: 'watcher-view'; from: string; height: number | null; fps: number | null }
  /** The host stopped this participant's stream. */
  | { type: 'stream-stopped'; reason: string }
  // delivered to a watcher, about a streamer it watches
  | { type: 'publisher-stats'; from: string; encodeMs: number | null }
  /** The streamer stopped sharing or left; the subscription is gone. */
  | { type: 'stream-ended'; streamer: string }
  // delivered to everyone
  /** Latest preview of someone's stream; null when their stream ended. */
  | { type: 'snapshot'; from: string; image: string | null }
  /** Someone's profile picture (also our own, echoed); null when removed. */
  | { type: 'avatar'; from: string; image: string | null }

// ---------------------------------------------------------------------------
// Local (IPC) types
// ---------------------------------------------------------------------------

export interface Settings {
  clientId: string
  displayName: string
  maxQuality: QualityPresetId
  adaptiveQuality: boolean
  codec: CodecPreference
  contentHint: ContentHintSetting
  forceTcp: boolean
  useTls: boolean
  preferredPort: number
  autoRejoin: boolean
  lastRoom: RoomEndpoint | null
  /** Rooms joined lately, newest first (see shared/roomList.ts). */
  recentRooms: RoomEndpoint[]
  manualServers: RoomEndpoint[]
  notifications: boolean
  pauseOnMinimize: boolean
  showStatsOverlay: boolean
  /** Capture system audio along with the screen when sharing. */
  shareAudio: boolean
  /** Windows: leave Discord (the voice call) out of the shared system audio. */
  excludeDiscordAudio: boolean
  /** Windows: when a single window is shared, share only that app's sound. */
  appAudioOnly: boolean
  /** Format version of the settings file (see migrate() in main/settings.ts). */
  settingsVersion: number
  /** Total upload for my stream, shared between my watchers (Mbps); 0 = unlimited. */
  uploadBudgetMbps: number
  /** Profile picture shown to others (square JPEG data URL), or null for initials. */
  avatar: string | null
  /** Colour theme of the app (src/shared/themes.ts). */
  theme: ThemeId
  /** Look for new versions on the releases page, and on Windows download them for a restart. */
  autoUpdate: boolean
  /** The app's language, or 'system' to follow the computer's (src/shared/i18n). */
  language: LanguageSetting
}

/**
 * Where the app is with updates. On Windows a new version downloads by itself
 * and waits for a restart (`ready`); on macOS, where unsigned apps can't
 * replace themselves, the app only says one is `available` to download.
 */
export type UpdateStatus =
  /** Up to date, or not checked yet (`checkedAt` is when it last looked). */
  | { state: 'idle'; checkedAt: number | null }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'available'; version: string; url: string }
  | { state: 'error'; message: string }
  /** Development builds don't update themselves. */
  | { state: 'unsupported' }

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
  /** This app (all its processes), as a share of the whole computer. */
  cpuPercent: number
  memoryMB: number
  /** The whole computer since the previous call; null on the first one. */
  computerCpuPercent: number | null
  /** Memory in use on the whole computer, and how much it has. */
  computerMemoryMB: number
  computerMemoryTotalMB: number
}

export interface AppInfo {
  version: string
  platform: string
  logDir: string
  /** The computer's languages, most preferred first (e.g. ["pt-BR", "en-US"]), for Settings → Language → System. */
  languages: string[]
}

export type ScreenPermission = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export interface NativeAudioOptions {
  /** Capture everything except Discord (per-process loopback) instead of the device's loopback. */
  excludeDiscord: boolean
  /** Capture only the app that owns this window (capture source id "window:<HWND>:0"); wins over excludeDiscord. */
  appWindow?: string | null
}

/** The sound that goes with a share, as chosen in the share dialogs. */
export interface AudioChoice {
  /** Share sound at all. */
  enabled: boolean
  /** Windows: leave Discord out of the system sound. */
  excludeDiscord: boolean
  /** Windows, when a single window is shared: only that app's sound. */
  appOnly: boolean
}

/** PCM format produced by the native Windows loopback helper (float32 interleaved). */
/** Reported while a screen is shared on Windows before 11 24H2 (see main/cursorWatch.ts). */
export interface CursorWatchState {
  /** An app hides the mouse cursor, but screen capture still shows an arrow. */
  hidden: boolean
  /** Capture source id of the foreground window. */
  windowId: string | null
  /** The foreground window covers its whole display (a fullscreen game). */
  fullscreen: boolean
  /** Display the foreground window is on (CaptureSource.displayId). */
  displayId: string | null
}

export interface NativeAudioFormat {
  /** Identifies one helper run; events from earlier runs must be ignored. */
  id: number
  sampleRate: number
  channels: number
}
