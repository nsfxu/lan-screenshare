export const APP_NAME = 'ScreenShare'

/** DNS-SD service type, advertised as `_lanshare._tcp.local`. */
export const MDNS_SERVICE_TYPE = 'lanshare'

/** Bumped whenever the wire protocol changes incompatibly. */
export const PROTOCOL_VERSION = 3

/** First port tried when hosting; the next free port is used if it is taken. */
export const DEFAULT_PORT = 47800
export const PORT_SEARCH_RANGE = 20

/** Host + up to 9 viewers. */
export const MAX_USERS = 10

export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 6
export const DEFAULT_PIN_LENGTH = 6
export const MAX_PIN_ATTEMPTS = 3
export const PIN_LOCKOUT_MS = 5 * 60_000

export const CHAT_HISTORY_LIMIT = 500
export const CHAT_MAX_LENGTH = 2000
/** Max chat messages a single user may send per second. */
export const CHAT_RATE_LIMIT = 5
export const NAME_MAX_LENGTH = 32
export const ROOM_NAME_MAX_LENGTH = 48

/** How long a dropped viewer keeps its seat (and skips the PIN) while reconnecting. */
export const RESUME_GRACE_MS = 30_000

/** Discovery: how often known rooms are probed for live info. */
export const PROBE_INTERVAL_MS = 3_000
/** A room that fails probes for this long is removed from the list. */
export const ROOM_STALE_MS = 10_000

/** WebSocket keep-alive. */
export const HEARTBEAT_INTERVAL_MS = 10_000

/** Stats sampling interval used by the adaptive controller and the UI. */
export const STATS_INTERVAL_MS = 1_000

/** If WebRTC has not connected within this time the viewer falls back to TCP. */
export const WEBRTC_CONNECT_TIMEOUT_MS = 8_000

/** Binary TCP-fallback packets start with [kind, flags]; flags bit 0 = keyframe (video only). */
export const BINARY_KIND_VIDEO = 1
export const BINARY_KIND_AUDIO = 2
export const BINARY_FLAG_KEY = 1

/** Server-side send buffer limit per TCP-fallback viewer before frames are dropped. */
export const TCP_MAX_BUFFERED_BYTES = 2 * 1024 * 1024
