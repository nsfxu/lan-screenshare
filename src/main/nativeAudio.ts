import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, type WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import { DISCORD_PROCESSES, NO_PROCESS_LOOPBACK } from '../shared/constants'
import type { NativeAudioFormat, NativeAudioOptions } from '../shared/types'
import type { Logger } from './server'

const HEADER_BYTES = 10
const FRAME_BYTES = 8 // float32 stereo
/** Helper exit code: process loopback (capture all but one app) is not available on this Windows. */
const EXIT_NO_PROCESS_LOOPBACK = 3

/**
 * Windows system audio through the bundled WASAPI helper
 * (native/win-audio-capture), in one of two modes:
 *  - everything except Discord (per-process loopback), so viewers in the same
 *    voice call don't hear themselves. While Discord isn't running, the helper
 *    leaves out this app instead, and it follows Discord starting or quitting;
 *  - the output device's loopback, when Chromium's own loopback can't open the
 *    device, e.g. a headset in 7.1 mode (captured in the device's mix format).
 * Either way the helper produces stereo float32, which is forwarded to the
 * renderer in frame-aligned chunks.
 */
export class NativeLoopback {
  private child: ChildProcessWithoutNullStreams | null = null
  private runs = 0

  constructor(private readonly log: Logger) {}

  private get exePath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'win-audio-capture.exe')
      : path.join(app.getAppPath(), 'native', 'bin', 'win-audio-capture.exe')
  }

  available(): boolean {
    return process.platform === 'win32' && fs.existsSync(this.exePath)
  }

  start(target: WebContents, options: NativeAudioOptions = { excludeDiscord: false }): Promise<NativeAudioFormat> {
    this.stop()
    if (!this.available()) return Promise.reject(new Error('Native audio capture is not available'))
    const id = ++this.runs
    const args = options.excludeDiscord
      ? ['--exclude', DISCORD_PROCESSES.join(','), '--fallback-pid', String(process.pid)]
      : []
    this.log.info(`[win-audio] run ${id}: ${options.excludeDiscord ? 'all audio except Discord' : 'device loopback'}`)
    const child = spawn(this.exePath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    let pending: Buffer = Buffer.alloc(0)
    let format: NativeAudioFormat | null = null

    return new Promise((resolve, reject) => {
      const fail = (err: Error): void => {
        if (!format) reject(err)
      }
      child.stderr.on('data', (d: Buffer) => this.log.info(`[win-audio] ${d.toString().trim()}`))
      child.on('error', fail)
      child.on('exit', (code) => {
        // stop() clears this.child first, so only unexpected exits are reported.
        const unexpected = this.child === child
        if (unexpected) this.child = null
        this.log.info(`[win-audio] run ${id} exited with code ${code}`)
        fail(new Error(code === EXIT_NO_PROCESS_LOOPBACK ? NO_PROCESS_LOOPBACK : `audio helper exited (${code})`))
        if (unexpected && format && !target.isDestroyed()) target.send(IPC.nativeAudioEnded, id, `exit ${code}`)
      })
      child.stdout.on('data', (chunk: Buffer) => {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
        if (!format) {
          if (pending.length < HEADER_BYTES) return
          if (pending.subarray(0, 4).toString('ascii') !== 'SSA1') {
            fail(new Error('unexpected audio helper output'))
            this.stop()
            return
          }
          format = { id, sampleRate: pending.readUInt32LE(4), channels: pending.readUInt16LE(8) }
          pending = pending.subarray(HEADER_BYTES)
          resolve(format)
        }
        const usable = pending.length - (pending.length % FRAME_BYTES)
        if (usable === 0 || target.isDestroyed()) return
        // Copy: the IPC payload must not alias the remaining partial frame.
        target.send(IPC.nativeAudioData, id, Buffer.from(pending.subarray(0, usable)))
        pending = pending.subarray(usable)
      })
    })
  }

  /** Stop the helper; with `id`, only if that run is still the current one. */
  stop(id?: number): void {
    if (id !== undefined && id !== this.runs) return
    const child = this.child
    this.child = null
    if (!child) return
    child.stdin.end()
    setTimeout(() => {
      if (child.exitCode === null) child.kill()
    }, 1000)
  }
}
