/** Strip Electron's "Error invoking remote method 'x': Error: " prefix. */
export function errorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatBitrate(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
  return `${Math.round(kbps)} kbps`
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const chars = parts.length === 1 ? [...parts[0]].slice(0, 2) : [[...parts[0]][0], [...parts[parts.length - 1]][0]]
  return chars.join('').toUpperCase()
}

export function roomUrl(ep: { address: string; port: number; tls: boolean }): string {
  const host = ep.address.includes(':') ? `[${ep.address}]` : ep.address
  return `${ep.tls ? 'wss' : 'ws'}://${host}:${ep.port}/ws`
}

export function latencyClass(ms: number | null): 'good' | 'ok' | 'bad' | 'unknown' {
  if (ms === null) return 'unknown'
  if (ms < 100) return 'good'
  if (ms < 150) return 'ok'
  return 'bad'
}
