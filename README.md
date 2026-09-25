# ScreenShare — LAN screen sharing with rooms and chat

A desktop app (Electron + React + TypeScript) for real-time screen sharing and chat between 2–10 people on a LAN or VPN. **Anyone in a room can share their screen**, several people can share at once, and everyone chooses which streams to watch. Rooms are discovered automatically over mDNS and can be public or protected by a PIN. Streams run at up to 1080p60 with hardware encoding, plus system audio. Nothing leaves your network: no accounts, no cloud, no STUN/TURN.

## Quick start

```bash
npm install
npm run dev          # run with hot reload
npm test             # unit + integration tests (server routing, PIN lockout, adaptive quality, budgets, TLS, codecs)
npm run typecheck
npm run dist:win     # Windows installer (.exe, NSIS)  → release/<version>/
npm run dist:mac     # macOS disk image (.dmg), must run on a Mac
```

To try several people on one machine, start isolated instances:

```bash
npx electron . --profile=alice
npx electron . --profile=bob
```

(`--profile=<name>` gives each instance its own settings and identity. Run `npm run build` first.)

## Using it

* **Create a room** to host it (public, or private with a PIN). The host's app runs the room's server.
* **Share your screen** from the toolbar. Anyone can, at any time, and optionally with system audio. On Windows, **Leave out Discord** (on by default) keeps your Discord call out of the shared audio, so people in the same call don't hear themselves.
* **Nothing plays automatically.** Live streams appear as preview cards (a thumbnail refreshed every 5 s). Click **Watch**, or **Watch all**, to open them. Watched streams play in a grid. Focus one to put it in the spotlight while the others keep playing in a strip. Every watched stream plays audio, and each has its own remembered volume.
* **Your own stream isn't played back either**, which saves GPU time on the machine that is capturing and encoding it. It appears as a "You" card (or chip) with its preview; click **Show** to open it as a tile, and close the tile to hide it again. Sharing continues either way.
* The **host** can stop anyone's stream, kick people, mute the chat and delete messages.

## How it works

```
  Alice (sharing)                       Host machine                           Bob (watching Alice + Host)
┌────────────────────────┐   ┌─────────────────────────────────────┐   ┌──────────────────────────┐
│ Publisher              │   │ Main process: RoomServer            │   │ WatchManager             │
│  capture ─► HW encoder │   │  • GET /info (discovery probe)      │   │  Subscription(Alice) ──┐ │
│  one RTCPeerConnection │   │  • /ws: PIN, chat, presence,        │   │  Subscription(Host)  ──┤ │
│  per watcher ──────────┼───┼──── signaling only between a  ──────┼──►│  tiles / spotlight ◄───┘ │
│                        │   │    streamer and its watchers        │   │                          │
│  WebRTC (UDP) media ───┼───┼──────────── direct, peer to peer ───┼──►│                          │
│  TCP fallback chunks ──┼──►│  • TCP relay, tagged per streamer ──┼──►│                          │
└────────────────────────┘   │  • mDNS advert _lanshare._tcp       │   └──────────────────────────┘
                             │ Renderer: its own Publisher / WatchManager like everyone else         │
                             └─────────────────────────────────────┘
```

* **Streaming model.** Each participant has a `Publisher` (their own share) and a `WatchManager` (the streams they chose to watch, one `Subscription` each). Watching is explicit. The room server keeps track of who watches whom, relays WebRTC signaling **only between a streamer and its current watchers**, and never carries WebRTC media: video goes directly from each streamer to each watcher, with one `RTCPeerConnection` per watcher. Every watcher therefore gets its own congestion control and adaptive quality, and a slow watcher never degrades anyone else. Signaling messages name the streamer they belong to, so two people watching each other keep their two connections apart.
* **Only send what's shown.** Each watcher reports the pixel height it actually displays a stream at: tile size × zoom × screen DPI, rounded up to 360/480/720/1080/1440/2160. The streamer caps that connection's resolution and scales its bitrate with the pixel count. A small grid tile costs ~1.7 Mbps instead of 15. Spotlight, fullscreen or zooming in raises it back to full quality within a second.
* **Upload budget.** A streamer's total upload is limited by a setting (default 100 Mbps, "Unlimited" for wired gigabit, lower for Wi-Fi/VPN) and split fairly between watchers (max-min fair share). Watchers that need little, such as small tiles, get what they need, and the rest is shared by bigger views. It applies immediately, including mid-session from the in-room Settings.
* **Previews.** Each streamer sends a 320 px JPEG (~10–15 KB) every 5 s. The server accepts previews only from people who are sharing, checks their type and size, rate-limits them, sends the current ones to late joiners, and clears them when a stream ends.
* **Capture.** Chromium's capture stack uses **DXGI Desktop Duplication** on Windows (Windows.Graphics.Capture for single windows) and **ScreenCaptureKit** on macOS. Frames stay on the GPU and go to the hardware encoder.
* **Codec selection** (`src/shared/codecs.ts`). At startup the app asks `MediaCapabilities` which codecs are hardware-accelerated (`powerEfficient`), and every participant reports its decoders when it joins. Automatic mode prefers hardware H.264, then H.265 if both ends have hardware support, then software H.264, VP9 and VP8. The choice is made per watcher, and the Settings panel can force a codec.
* **Transport.** WebRTC media over UDP comes first, and ICE also tries TCP candidates. If a watch hasn't connected within 8 s, or it fails, that subscription switches to the **TCP fallback**. The streamer encodes once with WebCodecs (hardware H.264 + Opus). The room's WebSocket carries the chunks, and the server tags each packet with the streamer's slot so each watcher's app sends it to the right tile. Per-watcher backpressure drops video up to the next keyframe so the stream stays live.
* **System audio.** Sharing can include everything playing on the computer: WASAPI loopback on Windows, ScreenCaptureKit on macOS 13+. On Windows this is always the whole system mix, even when a single window is shared, except for Discord when **Leave out Discord** is on (below). Audio is a second WebRTC track in the same stream, which keeps it in lip-sync with the video. Opus is tuned for music rather than voice: stereo, 128 kbps, in-band FEC, no DTX, and no echo cancellation, noise suppression or auto-gain. The streamer can mute audio without stopping the video, and pausing silences it too.
* **Leaving out Discord on Windows** (`native/win-audio-capture`, `--exclude`). When you share in a Discord call, the others' voices play on your computer, so plain loopback would send them back through your stream. With **Leave out Discord** on, the app captures audio with the bundled helper instead of Chromium. The helper uses Windows' process loopback (Windows 10 2004+ / Windows 11, the same API as OBS's Application Audio Capture), which captures the whole system mix except one process tree. It finds Discord's main process (`Discord.exe`, PTB, Canary, Development) and leaves out that process and its children. It rescans every 2 s, so Discord can start, quit or restart mid-share. While Discord isn't running, it leaves out ScreenShare itself instead (streams you watch while sharing aren't echoed back), because process loopback can exclude only one app at a time. Windows converts to 48 kHz stereo, so surround devices work in this mode too. On older Windows the app falls back to normal capture and says so.
* **Surround output devices on Windows** (`native/win-audio-capture`). Chromium opens WASAPI loopback as stereo, and Windows rejects that (`AUDCLNT_E_UNSUPPORTED_FORMAT`) when the default output device runs in 5.1/7.1 mode, which is common with gaming headsets. The app then starts a small bundled helper instead. It captures in the device's own mix format and downmixes to stereo (centre and surrounds at −3 dB, LFE dropped), and its output feeds the same audio pipeline as a normal track. It is compiled with the C# compiler that ships with Windows (`npm run build:native`, run automatically before `dev` and `build`).
* **Adaptive quality** (`src/shared/quality.ts`). Every second each connection's controller reads packet loss, RTT and WebRTC's `qualityLimitationReason`, and moves along the ladder **Native60 → 1080p60 (15 Mbps) → 720p60 (10) → 720p30 (5) → 480p30 (2.5)**, with hysteresis and exponential back-off after failed upgrades. The view-size cap and the budget apply on top.
* **Discovery** (`src/main/roomManager.ts`, `src/utils/mdns.ts`). Rooms advertise `_lanshare._tcp` over mDNS using a pure-JS responder, so Bonjour/Avahi is not required. Every 3 s, known rooms are polled at `GET /info` for live data (people, privacy, number of live streams). Use **Connect by IP** for VPNs and other subnets.
* **Reconnection.** After a network drop the app reconnects and resumes the same seat without the PIN (within 30 s). It re-announces its own stream, and every watched stream renegotiates automatically. If a watched streamer drops and comes back within 30 s, watchers pick their stream up again by themselves.

## Security

* **Private rooms** need a 4–6 digit PIN, generated with a CSPRNG. It exists only in memory and is never written to disk. The host can switch privacy, regenerate the PIN or set a custom one mid-session, and people already in the room stay connected. **Three wrong PINs lock the source address out for 5 minutes.** PINs are compared in constant time.
* **Encryption.** Media is always DTLS-SRTP encrypted (WebRTC). Chat, signaling, previews and the TCP fallback use **TLS (wss://)**, on by default. The host uses a self-signed certificate that stays the same across sessions. Its fingerprint is advertised over mDNS or recorded on the first probe, and the app accepts a self-signed certificate only if the fingerprint matches (`setCertificateVerifyProc`).
* **Authority.** The host's own UI authenticates with a random per-room token. The server enforces every host-only action (kick, stop someone's stream, delete message, mute chat, end room). Signaling is only relayed within an existing streamer ↔ watcher pair and only for that streamer's connection. Only people who are sharing can send media or previews. A kicked client can't rejoin that session.
* **No recording.** The app offers no recording or chat export, and while you're watching streams your window is hidden from OS screen capture (`setContentProtection`).

## Feature map

| Requirement | Where |
|---|---|
| Room list, live refresh, search, manual IP, auto-rejoin | `HomeScreen.tsx`, `roomManager.ts`, `App.tsx` |
| Create room, public/private, auto PIN, copy PIN | `Dialogs.tsx` (CreateRoomDialog), `HostControls.tsx` (AccessPanel) |
| Anyone can share; explicit watching; several streams at once | `publisher.ts`, `subscription.ts`, `watches.ts`, `server.ts` |
| Live-now preview cards, Watch all, "also live" bar, grid + spotlight, per-stream volume | `RoomView.tsx`, `ScreenViewer.tsx` |
| Zoom (wheel), pan (drag), fullscreen, FPS/latency overlay per tile | `ScreenViewer.tsx`, `RoomView.tsx` |
| Chat with timestamps, avatars, emoji, history, moderation | `ChatPanel.tsx`, `server.ts` (in memory, 500 messages) |
| People list: who shares, who watches whom, per-watcher stats, kick / stop stream | `ViewerList.tsx` |
| Pause/resume, change source, stop sharing, live stats (bandwidth, RTT, FPS, encode time, encoder, CPU, memory) | `RoomView.tsx`, `HostControls.tsx`, `publisher.ts` |
| System audio (share toggle, mute, per-stream volume, leave out Discord) | `publisher.ts`, `nativeAudio.ts`, `tcpStream.ts`, `ScreenViewer.tsx`, `native/win-audio-capture` |
| Per-watcher view-size cap and upload budget | `shared/quality.ts`, `publisher.ts`, `subscription.ts` |
| Reconnection | `roomClient.ts`, `subscription.ts`, `watches.ts` |
| Minimize/close | Streaming keeps running when minimized (optional pause-on-minimize setting). Closing while hosting asks for confirmation, then ends the room for everyone |
| Logs | `%APPDATA%\ScreenShare\logs\screenshare.log`, `~/Library/Logs/ScreenShare/screenshare.log` (Settings → Open logs) |

## Measured results (Windows 10, NVIDIA GPU, all instances on one machine)

| Scenario | Result |
|---|---|
| One stream, WebRTC | 1920×1080 @ 57–58 fps, H.265 through `MediaFoundationVideoEncodeAccelerator (NVIDIA HEVC Encoder MFT)`, encode 4.3 ms/frame, estimated glass-to-glass latency ~30–65 ms |
| Hardware encoder capacity | 8 simultaneous 1080p hardware encodes (H.264 and H.265) at ~57 fps each, ~13 % total CPU, while decoding 8 streams at the same time |
| Two people sharing, a third watching both | Both at 1080p ~57 fps; the two streamers also watched each other at the same time |
| View-size cap | Two grid tiles (≈276 px tall) → each stream sent at 640×360. Spotlight (505 px) → 1280×720. Zooming to 212 % → 1920×1080. Thumbnail strip stays at 640×360 |
| Upload budget | A streamer's upload went from 6.2–7.5 Mbps to 2.3–3.5 Mbps with a 3 Mbps limit, applied mid-session |
| TCP fallback | Two streams at once over TCP, each routed to its tile by slot, 57–58 fps, WebCodecs hardware H.264 |
| Audio | 440 Hz test tone received as 439 Hz (WebRTC ~160 kbps, TCP stereo Opus 128 kbps). Real system audio through a 7.1 headset via the native helper: 880 Hz received as 879 Hz |
| Reconnection | A forced connection drop showed "Reconnecting…", then the app reconnected and both watched streams were renegotiated within ~45 ms |
| Moderation | Host stopping a stream removes it for everyone and notifies the streamer; when the streamer shares again, watchers resume automatically |
| PIN, lockout, kick, privacy change, end room, mDNS discovery, previews for late joiners | Tested end to end |

Automatic codec selection picked H.265 on this machine because the driver reports hardware HEVC encoding as power-efficient but not H.264, even though hardware H.264 encoding works when forced.

## Known limitations

* Latency is an **estimate** on WebRTC: capture + encode + ½ RTT + jitter buffer + decode + display. On the TCP path it is measured with the host's clock, synchronised over the WebSocket.
* On the TCP fallback, a streamer encodes once for all TCP watchers, so the view-size cap doesn't apply there (the budget does).
* The macOS build has not been compiled or run: it has to be built on a Mac, and distributing it needs code signing and notarisation. On first use the app asks for Screen Recording and Local Network permissions.
* **macOS audio** depends on Chromium's ScreenCaptureKit loopback behind feature flags (`MacLoopbackAudioForScreenShare`) that the app turns on. It needs macOS 13+ and is untested. If it fails, sharing continues with video only.
* **Leave out Discord** is Windows-only and leaves out all of Discord's sound (notifications and soundboard too), not just voices. It excludes one app at a time: while Discord is left out, audio from streams you watch while sharing is still captured. The process-loopback mode has not been measured the way the results above were.
* The adaptive controller and budget split are unit-tested. Real packet loss wasn't simulated, since all testing ran over loopback.
* Discovery depends on multicast. On VPNs, use Connect by IP (default port 47800, or the next free one).
* All participants must run the same app version (protocol v3).
* Out of scope: remote control, microphone audio, multi-monitor capture in one stream, recording, Linux.

## Project layout

```
src/
  main/        index.ts (app, IPC, security), roomManager.ts, server.ts, screenCapture.ts, nativeAudio.ts, settings.ts, logger.ts
  preload/     index.ts (contextBridge API)
  renderer/    App.tsx, components/*, lib/ (roomClient, publisher, subscription, watches, tcpStream, nativeAudio, codecs, session)
  shared/      types.ts (protocol v3), constants.ts, quality.ts, codecs.ts, ipc.ts
  utils/       mdns.ts, crypto.ts, network.ts
native/        win-audio-capture (WASAPI loopback helper, C#: device loopback, or all audio except Discord)
tests/         server, streams (multi-stream routing), crypto, quality, network/TLS/codec tests (vitest)
```
