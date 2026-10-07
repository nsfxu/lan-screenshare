/** One CPU core's time counters, as Node's os.cpus() reports them (milliseconds since boot). */
export interface CpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

/**
 * How busy the whole computer was between two samples of every core, in
 * percent (0–100), or null when the samples can't be compared (first sample,
 * a core count change, or no time passed).
 */
export function cpuBusyPercent(before: readonly CpuTimes[], after: readonly CpuTimes[]): number | null {
  if (before.length === 0 || before.length !== after.length) return null
  let busy = 0
  let total = 0
  for (let i = 0; i < after.length; i++) {
    const a = before[i]
    const b = after[i]
    const idle = b.idle - a.idle
    const all = b.user - a.user + (b.nice - a.nice) + (b.sys - a.sys) + (b.irq - a.irq) + idle
    if (all < 0 || idle < 0) return null
    busy += all - idle
    total += all
  }
  if (total <= 0) return null
  return Math.round((busy / total) * 1000) / 10
}
