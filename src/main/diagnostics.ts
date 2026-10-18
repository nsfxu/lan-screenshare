import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import { PROTOCOL_VERSION } from '../shared/constants'
import { lastLines, LOG_TAIL_BYTES, LOG_TAIL_LINES, type MainDiagnostics } from '../shared/diagnostics'
import type { Settings } from '../shared/types'

/** What only the main process can see, for "Copy diagnostics" (see shared/diagnostics.ts). */
export async function gatherDiagnostics(logFile: string, settings: Settings): Promise<MainDiagnostics> {
  const cpus = os.cpus()
  return {
    app: {
      version: app.getVersion(),
      protocol: PROTOCOL_VERSION,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      packaged: app.isPackaged
    },
    os: {
      platform: process.platform,
      version: process.getSystemVersion(),
      release: os.release(),
      arch: process.arch,
      cpu: cpus[0]?.model.trim() ?? 'unknown',
      cores: cpus.length,
      memoryGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10
    },
    gpu: await gpu(),
    network: networkAddresses(),
    settings,
    logTail: readLogTail(logFile)
  }
}

async function gpu(): Promise<MainDiagnostics['gpu']> {
  const features = Object.fromEntries(Object.entries(app.getGPUFeatureStatus()).map(([k, v]) => [k, String(v)]))
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: Record<string, unknown>[] }
    const hex = (n: unknown): string => (typeof n === 'number' ? n.toString(16).padStart(4, '0') : '?')
    const devices = (info.gpuDevice ?? []).map((d) => {
      const driver = [d.driverVendor, d.driverVersion].filter((x) => typeof x === 'string' && x).join(' ')
      return `${hex(d.vendorId)}:${hex(d.deviceId)}${d.active ? ' (active)' : ''}${driver ? `, driver ${driver}` : ''}`
    })
    return { devices, features }
  } catch {
    return { devices: [], features }
  }
}

function networkAddresses(): MainDiagnostics['network'] {
  const out: MainDiagnostics['network'] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address })
  }
  return out
}

/** The end of the log: read only its last bytes, the file can be megabytes long. */
function readLogTail(file: string): string {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    return lastLines(buffer.toString('utf8'), LOG_TAIL_LINES, start > 0)
  } catch {
    return '(no log)'
  } finally {
    if (fd !== null) fs.closeSync(fd)
  }
}
