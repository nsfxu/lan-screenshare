import type { CodecSupport, Settings } from './types'

/**
 * "Copy diagnostics" (Settings → About): what a bug report needs, as text to
 * paste. The main process gathers most of it (MainDiagnostics); the renderer
 * adds the codecs it found and formats it. PINs, tokens and our client id
 * never go in: the settings hold none of the first two, the client id is left
 * out, and the log tail is scrubbed of anything that looks like a secret.
 */

/** How much of the end of the log to include: enough for the last session or two. */
export const LOG_TAIL_BYTES = 64 * 1024
export const LOG_TAIL_LINES = 300

export interface MainDiagnostics {
  app: { version: string; protocol: number; electron: string; chrome: string; node: string; packaged: boolean }
  os: { platform: string; version: string; release: string; arch: string; cpu: string; cores: number; memoryGB: number }
  /** GPUs Chromium found (vendor:device ids in hex), and what it accelerates. */
  gpu: { devices: string[]; features: Record<string, string> }
  /** This computer's IPv4 addresses, by interface (the ones a room can be reached on). */
  network: { name: string; address: string }[]
  settings: Settings
  logTail: string
}

export interface Diagnostics extends MainDiagnostics {
  encoders: CodecSupport[]
  decoders: CodecSupport[]
}

/** The settings worth reporting: everything except who we are to rooms (client id) and the picture itself. */
export function reportableSettings(settings: Settings): Record<string, unknown> {
  const { clientId: _clientId, avatar, ...rest } = settings
  return { ...rest, avatar: avatar ? 'set' : 'none' }
}

const SECRET = /\b(pin|token|hosttoken|resumetoken|password|secret)(["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi

/** Hides values that look like secrets ("pin=1234", "token": "…"). The log shouldn't have any; this makes sure. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET, (_m, key: string, sep: string) => `${key}${sep}[hidden]`)
}

/** The last `maxLines` whole lines of `text` (a partial first line, from reading the file's end, is dropped). */
export function lastLines(text: string, maxLines: number, partialStart = false): string {
  let lines = text.split(/\r?\n/)
  if (partialStart && lines.length > 1) lines = lines.slice(1)
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-maxLines).join('\n')
}

function codecs(list: CodecSupport[]): string {
  if (list.length === 0) return 'none found'
  return list.map((c) => `${c.mimeType.replace(/^video\//, '')}${c.hardware ? ' (hardware)' : ''}`).join(', ')
}

/** The report, as plain text that reads well pasted into an issue or a chat. */
export function formatDiagnostics(d: Diagnostics, now = new Date()): string {
  const settings = Object.entries(reportableSettings(d.settings))
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
    .join('\n')
  const features = Object.entries(d.gpu.features)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
  return [
    `ScreenShare diagnostics (${now.toISOString()})`,
    '',
    `App: ${d.app.version}${d.app.packaged ? '' : ' (development)'}, protocol ${d.app.protocol}`,
    `Electron ${d.app.electron}, Chromium ${d.app.chrome}, Node ${d.app.node}`,
    `OS: ${d.os.platform} ${d.os.version} (${d.os.release}, ${d.os.arch})`,
    `CPU: ${d.os.cpu} (${d.os.cores} cores), memory ${d.os.memoryGB} GB`,
    `GPU: ${d.gpu.devices.join('; ') || 'unknown'}`,
    `GPU features: ${features || 'unknown'}`,
    `Encoders: ${codecs(d.encoders)}`,
    `Decoders: ${codecs(d.decoders)}`,
    `Network: ${d.network.map((n) => `${n.address} (${n.name})`).join(', ') || 'none'}`,
    '',
    'Settings:',
    settings,
    '',
    `Log (last ${LOG_TAIL_LINES} lines at most):`,
    '```',
    redactSecrets(d.logTail),
    '```',
    ''
  ].join('\n')
}
