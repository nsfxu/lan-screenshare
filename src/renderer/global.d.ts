import type { ScreenShareApi } from '../shared/ipc'

declare global {
  interface Window {
    api: ScreenShareApi
  }

  // Chromium "insertable streams" for raw video frames (not yet in lib.dom).
  class MediaStreamTrackProcessor<T = VideoFrame> {
    constructor(init: { track: MediaStreamTrack; maxBufferSize?: number })
    readonly readable: ReadableStream<T>
  }

  class MediaStreamTrackGenerator<T = VideoFrame> extends MediaStreamTrack {
    constructor(init: { kind: 'video' | 'audio' })
    readonly writable: WritableStream<T>
  }
}

export {}
