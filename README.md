# ScreenShare — LAN screen sharing with rooms and chat

A desktop app (Electron + React + TypeScript) for real-time screen sharing and chat between 2–10 people on a LAN or VPN. Rooms are discovered automatically over mDNS. They can be public or protected by a PIN, and the stream runs at 1080p60 with hardware encoding. Nothing leaves your network: no accounts, no cloud, no STUN/TURN.

## Quick start

```bash
npm install
npm run dev          # run with hot reload
npm test             # unit + integration tests (server, PIN lockout, adaptive quality, TLS, codecs)
npm run typecheck
npm run dist:win     # Windows installer (.exe, NSIS)  → release/<version>/
npm run dist:mac     # macOS disk image (.dmg), must run on a Mac
```

To try host and viewer on one machine, start two isolated instances:

```bash
npx electron . --profile=host
npx electron . --profile=viewer
```

(`--profile=<name>` gives each instance its own settings and identity. Run `npm run build` first.)

## How it works

```
 Host machine                                             Viewer machines
┌──────────────────────────────────────────────┐
│ Renderer                                     │   WebRTC (UDP, DTLS-SRTP)      ┌───────────┐
│  getDisplayMedia ─► HW encoder ─► RTCPeer ×N ├───────────────────────────────►│ <video>   │
│  (DXGI / ScreenCaptureKit)                   │   one PeerConnection/viewer    │           │
│  WebCodecs encoder (TCP fallback) ──┐        │                                │           │
│                                     ▼        │   wss:// (TLS, self-signed,    │           │
│ Main process: RoomServer  ◄── ws ───┘        │   fingerprint-pinned)          │           │
│  • GET /info (discovery probe)               ├───────────────────────────────►│ chat, PIN │
│  • /ws: PIN auth, chat, presence, signaling, │   chat · presence · signaling  │ signaling │
│    moderation, TCP video relay               │   + TCP video fallback         │           │
│  • mDNS advert  _lanshare._tcp               │                                └───────────┘
└──────────────────────────────────────────────┘
```

* **Relay model.** The host runs a small relay server (`src/main/server.ts`) for its room. Viewers only talk to the host and never to each other. Video goes host → viewer over WebRTC, with one `RTCPeerConnection` per viewer. Each viewer therefore gets its own congestion control and its own adaptive quality, and a slow viewer never degrades the others.
* **Capture.** Chromium's capture stack uses **DXGI Desktop Duplication** on Windows (Windows.Graphics.Capture for single windows) and **ScreenCaptureKit** on macOS. Frames stay on the GPU and go to the hardware encoder.
* **Codec selection** (`src/shared/codecs.ts`). At startup the app asks `MediaCapabilities` which codecs are hardware-accelerated (`powerEfficient`), and each viewer reports its decoders when it joins. Automatic mode prefers hardware H.264, then H.265 if both ends have hardware support, then software H.264, VP9 and VP8. The Settings panel lets you force a codec, and it shows the detected hardware support.
* **Transport.** WebRTC media over UDP comes first, and ICE also tries TCP candidates. If WebRTC hasn't connected within 8 s, or it fails, the viewer switches to the **TCP fallback**. In fallback the host encodes with WebCodecs (hardware H.264), the room's WebSocket carries the encoded chunks, and the viewer decodes them into a `MediaStreamTrack`. Relay backpressure drops frames up to the next keyframe so the stream stays live.
* **System audio.** When sharing, the host can include everything playing on the computer: WASAPI loopback on Windows, ScreenCaptureKit on macOS 13+. On Windows this is always the whole system mix, even when a single window is shared. Audio travels as a second WebRTC track in the same stream, so WebRTC keeps it in lip-sync with the video. Opus is set up for music rather than voice: stereo, 128 kbps, in-band FEC, no DTX, and no echo cancellation, noise suppression or auto-gain. The host can mute audio without stopping the video, and pausing silences it too. Viewers get a volume slider and a mute button, and the setting is remembered. On the TCP fallback, audio is encoded as Opus with WebCodecs and follows the same path as the video.
* **Surround output devices on Windows** (`native/win-audio-capture`). Chromium opens WASAPI loopback as stereo. If the default output device runs in 5.1 or 7.1 mode, which is common with gaming headsets, Windows rejects that with `AUDCLNT_E_UNSUPPORTED_FORMAT`. In that case the app starts a small bundled helper instead. It captures loopback in the device's own mix format and downmixes to stereo (centre and surrounds at −3 dB, LFE dropped). The PCM goes through the main process to the renderer, which turns it into a normal `MediaStreamTrack` for WebRTC and the TCP fallback. The helper is compiled with the C# compiler that ships with Windows (`npm run build:native`, which runs automatically before `dev` and `build`), so it needs no SDK or NuGet packages.
* **Adaptive quality** (`src/shared/quality.ts`). Every second the controller reads packet loss, RTT and WebRTC's `qualityLimitationReason` for each viewer and moves along the ladder **Native60 → 1080p60 (15 Mbps) → 720p60 (10) → 720p30 (5) → 480p30 (2.5)**. It uses hysteresis, and when an upgrade fails the wait before the next one grows exponentially. Chromium's own per-frame adaptation still runs underneath.
* **Discovery** (`src/main/roomManager.ts`, `src/utils/mdns.ts`). Each room advertises `_lanshare._tcp` over mDNS using a pure-JS responder, so Bonjour/Avahi is not required. Every 3 s, each room found by mDNS or added by hand is polled at `GET /info` for live data such as viewer count, privacy and sharing state. Rooms appear and disappear on their own. Use **Connect by IP** for VPNs and other subnets, where multicast doesn't reach.

## Security

* **Private rooms** need a 4–6 digit PIN, generated with a CSPRNG. It exists only in memory and is never written to disk. The host can switch privacy, regenerate the PIN or set a custom one during a session, and people already in the room stay connected. **Three wrong PINs lock the source address out for 5 minutes.** PINs are compared in constant time.
* **Encryption.** Video is always encrypted with DTLS-SRTP (WebRTC). Chat and signaling go over **TLS (wss://)**, which is on by default. The host uses a self-signed certificate that stays the same across sessions. Its fingerprint is advertised over mDNS or recorded on the first probe, and the app accepts a self-signed certificate only if the fingerprint matches (`setCertificateVerifyProc`).
* **Host authority.** The host's own UI authenticates with a random per-room token. The server checks every host-only action (kick, delete message, mute chat, end room, sharing state), and viewers can't send signaling to each other or inject video. A kicked client can't rejoin that session.
* **Viewer restrictions.** Viewers can't control the host. The app offers no recording or chat export, and while a viewer is watching, its window is hidden from OS screen capture (`setContentProtection`).

## Feature map

| Requirement | Where |
|---|---|
| Room list, live refresh, search, manual IP, auto-rejoin | `HomeScreen.tsx`, `roomManager.ts`, `App.tsx` |
| Create room, public/private, auto PIN, copy PIN | `Dialogs.tsx` (CreateRoomDialog), `HostControls.tsx` (AccessPanel) |
| Screen view with zoom (wheel), pan (drag), fullscreen, FPS/latency | `ScreenViewer.tsx`, `RoomView.tsx` |
| Chat with timestamps, avatars, emoji, history | `ChatPanel.tsx`, server history (in memory, 500 messages) |
| Viewer list, status, kick | `ViewerList.tsx` |
| Pause/resume, change source, stop, end room, live stats (bandwidth, RTT, FPS, encode time, encoder, CPU, memory) | `RoomView.tsx`, `HostControls.tsx`, `hostStreamer.ts` |
| System audio (share toggle, host mute, viewer volume) | `hostStreamer.ts`, `tcpStream.ts`, `ScreenViewer.tsx`, `Dialogs.tsx` |
| Chat moderation (delete, mute) | `ChatPanel.tsx`, `server.ts` |
| Reconnection | `roomClient.ts` resumes the same seat without the PIN within 30 s; the stream renegotiates automatically |
| Minimize/close | Streaming keeps running when minimized (optional pause-on-minimize setting). Closing asks for confirmation, then ends the room and tells viewers |
| Logs | `%APPDATA%\ScreenShare\logs\screenshare.log`, `~/Library/Logs/ScreenShare/screenshare.log` (Settings → Open logs) |

## Measured results (Windows 10, NVIDIA GPU, both instances on one machine)

| Scenario | Result |
|---|---|
| WebRTC, 1 viewer | 1920×1080 @ 57–58 fps, H.265 through `MediaFoundationVideoEncodeAccelerator (NVIDIA HEVC Encoder MFT)`, encode 4.3 ms/frame, estimated glass-to-glass latency ~30–65 ms |
| WebRTC, 2 viewers | Both at 1080p ~58 fps; host ~5 % of total CPU (OS-measured, 24 threads) |
| TCP fallback | 1920×1080 @ 57 fps, WebCodecs hardware H.264 |
| Real system audio through a 7.1 headset (native helper) | The 880 Hz tone played on the PC was received as 879 Hz on WebRTC and on TCP (stereo). Changing source restarts the helper cleanly (always exactly one running), and it exits when the room ends |
| Audio (WebRTC and TCP) | A 440 Hz test tone was received as 439 Hz at the viewer. WebRTC used ~160 kbps next to 1080p57 video; TCP carried stereo Opus at 128 kbps. Host mute and pause silence it, and unmuting brings it back without renegotiating |
| PIN, kick, privacy change, end room, mDNS discovery | Tested end to end |

Automatic codec selection picked H.265 on this machine because it reported hardware HEVC encoding but not hardware H.264 encoding for WebRTC.

## Known limitations

* Latency is an **estimate** on WebRTC: capture + encode + ½ RTT + jitter buffer + decode + display. On the TCP path it is measured with the host's clock, synchronised over the WebSocket.
* The macOS build has not been compiled or run: it has to be built on a Mac, and distributing it needs code signing and notarisation. On first use the app asks for Screen Recording and Local Network permissions.
* The adaptive controller is unit-tested. Real packet loss wasn't simulated because all testing ran over loopback.
* Discovery depends on multicast. On VPNs, use Connect by IP (default port 47800, or the next free one).
* **macOS audio** depends on Chromium's ScreenCaptureKit loopback, which is behind feature flags (`MacLoopbackAudioForScreenShare`) that the app turns on. It needs macOS 13+ and hasn't been tested yet. If it fails, sharing continues with video only.
* Out of scope for v1, as specified: remote control, microphone audio, multi-monitor, recording, Linux.

## Project layout

```
src/
  main/        index.ts (app, IPC, security), roomManager.ts, server.ts, screenCapture.ts, settings.ts, logger.ts
  preload/     index.ts (contextBridge API)
  renderer/    App.tsx, components/*, lib/ (roomClient, hostStreamer, viewerReceiver, tcpStream, codecs, session)
  shared/      types.ts, constants.ts, quality.ts, codecs.ts, ipc.ts
  utils/       mdns.ts, crypto.ts, network.ts
tests/         server, crypto, quality, network/TLS/codec tests (vitest)
```
