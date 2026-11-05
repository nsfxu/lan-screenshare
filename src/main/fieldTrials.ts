/**
 * WebRTC field trials the app runs with (Chromium's `--force-fieldtrials`).
 * Pure, so the string is tested; index.ts applies it before the app is ready.
 */

/**
 * Send big frames faster. WebRTC sends a keyframe every 3000 frames on its own (~50 s at 60 fps) and paces
 * packets at only 1.0x (screen content) or 1.1x (video) its target bitrate, so a keyframe of a detailed 1080p
 * desktop took ~0.2-0.9 s to arrive and the picture froze meanwhile. At 10x the same keyframes arrive without a
 * freeze (measured with `npm run perf`, see docs/en-US/media-pipeline.md). Screen content keeps WebRTC's other
 * defaults ("1.0,2875,80,40,-60,3" in rtc_base/experiments/alr_experiment.cc).
 */
const FAST_PACING = 'WebRTC-ProbingScreenshareBwe/10.0,2875,80,40,-60,3/WebRTC-Video-Pacing/factor:10.0/'

/**
 * Latency Automatic or Lowest (Settings → Advanced, src/shared/latency.ts): a playout delay of 0 makes the
 * viewer use WebRTC's low-latency rendering, showing each frame as soon as it's decoded instead of smoothing
 * over network jitter (video/rtp_video_stream_receiver2.cc, modules/video_coding/timing/timing.cc). Measured
 * on a wired LAN: 50 → 25 ms screen to screen. Over Wi-Fi or a VPN the picture can stutter without that
 * smoothing, so Automatic gives each stream that stutters a jitter buffer of its own (subscription.ts).
 */
const ZERO_PLAYOUT_DELAY = 'WebRTC-ForcePlayoutDelay/min_ms:0,max_ms:0/'

export function fieldTrials(options: { zeroPlayoutDelay: boolean }): string {
  return FAST_PACING + (options.zeroPlayoutDelay ? ZERO_PLAYOUT_DELAY : '')
}
