import { describe, expect, it } from 'vitest'
import { cpuBusyPercent, type CpuTimes } from '../src/shared/systemStats'

const core = (busy: number, idle: number): CpuTimes => ({ user: busy, nice: 0, sys: 0, idle, irq: 0 })

describe('cpuBusyPercent', () => {
  it('averages every core over the time between two samples', () => {
    const before = [core(1000, 9000), core(2000, 8000)]
    // Core 1: 300 busy of 1000; core 2: 700 busy of 1000 → 50 %.
    const after = [core(1300, 9700), core(2700, 8300)]
    expect(cpuBusyPercent(before, after)).toBe(50)
  })

  it('counts system, nice and interrupt time as busy', () => {
    const before = [{ user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }]
    const after = [{ user: 100, nice: 50, sys: 100, idle: 700, irq: 50 }]
    expect(cpuBusyPercent(before, after)).toBe(30)
  })

  it('has no answer without two comparable samples', () => {
    expect(cpuBusyPercent([], [core(1, 1)])).toBeNull()
    expect(cpuBusyPercent([core(1, 1)], [core(1, 1), core(1, 1)])).toBeNull()
    expect(cpuBusyPercent([core(5, 5)], [core(5, 5)])).toBeNull()
    expect(cpuBusyPercent([core(9, 9)], [core(5, 5)])).toBeNull()
  })
})
