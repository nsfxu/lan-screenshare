/**
 * Renderer side of the Windows native loopback helper: turns the PCM stream
 * from the main process into a MediaStreamTrack, so it plugs into WebRTC and
 * the TCP fallback exactly like Chromium's own loopback track.
 */
export interface NativeAudioCapture {
  track: MediaStreamTrack
  stop(): void
}

export async function startNativeLoopback(log: (msg: string) => void): Promise<NativeAudioCapture> {
  const api = window.api.capture.nativeAudio
  const generator = new MediaStreamTrackGenerator<AudioData>({ kind: 'audio' })
  const writer = generator.writable.getWriter()
  let timestampUs = 0
  let stopped = false
  let dropped = 0
  let sampleRate = 48_000
  let channels = 2
  let runId: number | null = null

  const offData = api.onData((id, chunk) => {
    if (stopped || id !== runId) return
    const frames = Math.floor(chunk.byteLength / (4 * channels))
    if (frames === 0) return
    // Keep latency bounded: if the track isn't consuming, drop rather than queue.
    if (writer.desiredSize !== null && writer.desiredSize <= 0) {
      dropped++
      return
    }
    // Copy into an aligned buffer (the IPC payload may have any byte offset).
    const samples = new Float32Array(frames * channels)
    new Uint8Array(samples.buffer).set(chunk.subarray(0, samples.byteLength))
    const data = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: timestampUs,
      data: samples
    })
    timestampUs += Math.round((frames / sampleRate) * 1_000_000)
    writer.write(data).catch(() => data.close())
  })
  const offEnded = api.onEnded((id, reason) => {
    if (id !== runId) return
    log(`native audio ended: ${reason}`)
    stop()
  })

  const stop = (): void => {
    if (stopped) return
    stopped = true
    offData()
    offEnded()
    if (dropped) log(`native audio dropped ${dropped} chunks`)
    // Only stop our own run: a newer capture may already own the helper.
    if (runId !== null) void api.stop(runId)
    void writer.close().catch(() => {})
    generator.stop()
  }

  try {
    const format = await api.start()
    runId = format.id
    sampleRate = format.sampleRate
    channels = format.channels
    log(`native loopback started: ${sampleRate} Hz x${channels}`)
  } catch (err) {
    stop()
    throw err
  }
  return { track: generator, stop }
}
