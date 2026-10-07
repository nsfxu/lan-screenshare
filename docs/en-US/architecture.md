# Architecture

This page explains how ScreenShare is put together: which process does what, how the pieces talk to each other, and why it is built this way. Read it before changing anything non-trivial.

> **Language:** English · [Português (Brasil)](../pt-BR/architecture.md)

## Contents

- [The big picture](#the-big-picture)
- [Design principles](#design-principles)
- [Electron processes](#electron-processes)
- [Source layout](#source-layout)
- [Main process](#main-process)
- [Renderer: the session objects](#renderer-the-session-objects)
- [Renderer: the UI](#renderer-the-ui)
- [VPN rooms](#vpn-rooms)
- [Key flows](#key-flows)
- [Where state lives](#where-state-lives)

## The big picture

Every participant runs the same desktop app. One of them **hosts** the room: their app also runs a small server (`RoomServer`) that everyone connects to. The server handles joining, chat, presence and moderation, and it passes WebRTC signaling messages between participants. It **never carries WebRTC video**: video goes directly from each person who shares (a *streamer*) to each person who chose to watch them (a *watcher*).

```mermaid
flowchart LR
  subgraph HostPC["Host's computer"]
    direction TB
    HM["Main process<br/>RoomServer + mDNS advert"]
    HR["Renderer<br/>(the host is also a participant)"]
    HR <-->|"wss://127.0.0.1"| HM
  end
  A["Alice's app"]
  B["Bob's app"]
  A <-->|"wss: auth, chat, signaling"| HM
  B <-->|"wss: auth, chat, signaling"| HM
  A == "WebRTC media (UDP), direct" ==> B
  HR == "WebRTC media, direct" ==> A
  A -. "TCP fallback: media relayed over the WebSocket" .-> HM
```

- **Discovery**: rooms advertise themselves over mDNS (`_lanshare._tcp`). Other apps browse for them and also poll each room's `GET /info` every 3 s for live data. People on VPNs or other subnets can type an address instead (**Join by IP**).
- **Signaling**: WebRTC offers, answers and ICE candidates travel through the room's WebSocket, but only between a streamer and one of its current watchers.
- **Media**: one `RTCPeerConnection` per streamer→watcher pair. When UDP is blocked, that single pair falls back to a **TCP path**: the streamer encodes with WebCodecs and the server relays the encoded chunks.

## Design principles

These choices explain most of the code. Please keep them unless there is a strong reason not to.

1. **LAN only, no external services.** No accounts, no cloud, no STUN/TURN servers. Everything works on an isolated network.
2. **The server is thin.** It authenticates, relays and enforces rules. It does not encode, decode or mix media.
3. **Nothing plays unless you ask.** Watching is explicit. Your own stream is not played back either until you click **Show my stream**. This saves bandwidth and GPU time.
4. **One connection per watcher.** Each watcher gets its own congestion control, adaptive quality and resolution cap, so one slow viewer never degrades the others.
5. **Only send what is shown.** Watchers report how big they display each stream. Streamers never send more pixels than that, and they split their upload budget fairly.
6. **The server enforces authority.** Host-only actions, PIN checks, rate limits and input validation happen on the server, never only in the UI.
7. **Pure logic lives in `src/shared`.** Quality ladders, codec ordering, crop maths and image validation have no DOM or Node dependencies, so they can be unit tested.

## Electron processes

```mermaid
flowchart TB
  subgraph Main["Main process (Node.js) · src/main"]
    RM["RoomManager<br/>hosting + discovery"]
    RS["RoomServer<br/>HTTP /info + WebSocket /ws"]
    MD["MdnsDiscovery<br/>src/utils/mdns.ts"]
    SC["ScreenCapture<br/>source picker + display-media handler"]
    NL["NativeLoopback<br/>spawns win-audio-capture.exe"]
    ST["SettingsStore<br/>settings.json"]
    LG["File logger"]
    RM --> RS
    RM --> MD
  end
  subgraph Preload["Preload · src/preload"]
    API["contextBridge<br/>window.api"]
  end
  subgraph Renderer["Renderer (Chromium, sandboxed) · src/renderer"]
    UI["React UI<br/>App, RoomsSidebar, RoomView…"]
    SES["Session<br/>RoomClient + Publisher + WatchManager"]
    UI --> SES
  end
  Renderer <-->|"IPC (invoke / events)"| Preload
  Preload <-->|"ipcRenderer ↔ ipcMain"| Main
  SES <-->|"WebSocket to the room server"| RS
  NL -. "PCM audio over IPC" .-> SES
```

| Process | Runs | Responsibilities |
|---|---|---|
| **Main** | Node.js | Window lifecycle, settings, logs, hosting a room (`RoomServer`), discovery (mDNS + probing), TLS identity and certificate pinning, the capture source picker, the Windows audio helper. |
| **Preload** | Isolated bridge | Exposes a small, typed API as `window.api` (see `ScreenShareApi` in `src/shared/ipc.ts`). The renderer has no Node access. |
| **Renderer** | Chromium, sandboxed | All UI, all WebRTC and WebCodecs work, the connection to the room (`RoomClient`), sharing (`Publisher`) and watching (`WatchManager`, `Subscription`). |

The host's renderer talks to its own server over `wss://127.0.0.1` exactly like any other participant. It proves it is the host with a random per-room **host token**.

## Source layout

```text
src/
  main/        Electron main process
    index.ts         app start-up, window, IPC handlers, Chromium switches, security settings
    roomManager.ts   hosting (server + TLS + mDNS advert) and discovery (mDNS + manual + /info probes)
    server.ts        RoomServer: auth, chat, presence, moderation, signaling relay, TCP media relay
    screenCapture.ts source list, display-media request handler, macOS permission
    nativeAudio.ts   runs the Windows audio helper and forwards PCM to the renderer
    cursorWatch.ts   runs the Windows cursor helper (games that hide the cursor)
    vpn/             VPN rooms: manager (host or guest), host (enrolment), tunnel (drives the helper), helper + elevate (find, check and start it with administrator rights), fake (tests)
    settings.ts      settings.json load/validate/save
    logger.ts        rotating file logger
  preload/
    index.ts         contextBridge: window.api
  renderer/
    App.tsx          top-level screens, joining/hosting, toasts, settings
    components/      React components (see "Renderer: the UI")
    lib/             session logic: roomClient, publisher, subscription, watches, tcpStream,
                     nativeAudio, gameCursor, foregroundWatch, autoContentHint, codecs, images,
                     session, format, emitter
    styles.css       all styles (dark theme)
  shared/            code used by both sides; no DOM/Node APIs in the pure modules
    types.ts         wire protocol + settings + IPC types
    constants.ts     protocol version, limits, timings
    ipc.ts           IPC channel names and the window.api interface
    vpn.ts           VPN room maths: networks, guest addresses, invites, enrolment validation
    quality.ts       quality ladder, adaptive controller, per-watcher limits, budget split
    codecs.ts        codec ordering and SDP tweaks
    crop.ts          profile picture crop maths
    images.ts        data-URL validators for previews and profile pictures
  utils/             main-process helpers
    mdns.ts          DNS-SD advert + browse (bonjour-service, pure JS)
    network.ts       addresses, URLs, /info probing, certificate fingerprints
    crypto.ts        PIN generation/comparison, lockout, random ids
    wireguard.ts     WireGuard key pairs, and the requests the helper's control socket understands
native/
  win-audio-capture/Program.cs   Windows audio helper (C#, built with the compiler that ships with Windows)
  win-cursor-watch/Program.cs    Windows helper that reports when a game hides the cursor (C#)
scripts/build-native.cjs         builds the helpers before `dev`/`build` (no-op off Windows)
tests/                           vitest: server, streams, quality, crop, codecs/TLS, crypto;
                                 renderer/ for renderer logic (game cursor)
build/                           packaging resources (macOS entitlements)
```

## Main process

### RoomManager (`src/main/roomManager.ts`)

Owns everything about rooms on this machine.

- **Hosting.** `createRoom()` generates the PIN (private rooms) and the host token, loads or creates the TLS identity, starts a `RoomServer`, and publishes the mDNS advert. `updateRoom()` changes the name, privacy or PIN live. `closeRoom()` stops everything.
- **TLS identity.** A self-signed EC P-256 certificate is generated once and stored in `host-identity.json` (user data folder) for two years, so its fingerprint stays stable and viewers can pin it.
- **Discovery.** It keeps a list of rooms from mDNS and from manual addresses, probes each one at `GET /info` every 3 s (`PROBE_INTERVAL_MS`), and drops rooms that have not answered for 10 s (`ROOM_STALE_MS`).
- **Certificate trust.** It remembers which certificate fingerprints belong to which host (from the mDNS TXT record or from the first probe). `index.ts` asks it to approve self-signed certificates in `setCertificateVerifyProc`.

### RoomServer (`src/main/server.ts`)

One instance per hosted room. It keeps a **seat** per participant:

```mermaid
classDiagram
  class RoomServer {
    -seats: Map~id, Seat~
    -history: ChatMessage[]
    -pinGuard: PinGuard
    -banned: Set~clientId~
    +start() port
    +stop(reason)
    +update(name, privacy, pin)
    +getInfo() RoomInfo
  }
  class Seat {
    participant: Participant
    clientId
    ws: WebSocket or null
    resumeToken
    watchers: Map~watcherId, Subscription~
    snapshot: preview image or null
    avatar: picture or null
  }
  class Participant {
    id, name, role, color
    slot: 0..255
    stream: StreamInfo or null
    watching: ids[]
    status: connected or reconnecting
  }
  RoomServer "1" o-- "many" Seat
  Seat --> Participant
```

What it does:

- Serves `GET /info` (public, no secrets) and the WebSocket at `/ws`.
- Checks `hello`: protocol version, host token, PIN (with lockout), capacity, bans, and seat **resume** after a network drop.
- Chat with history (500 messages in memory), rate limit and host moderation.
- Tracks who shares and who watches whom. It relays signaling **only** inside an existing streamer↔watcher pair.
- Relays TCP-fallback media: it prefixes each binary packet with the streamer's **slot** byte, applies per-watcher backpressure, and requests keyframes.
- Stores and redistributes stream previews and profile pictures, with validation and rate limits.

The full message list is in the [protocol reference](protocol.md).

### ScreenCapture and NativeLoopback

- `ScreenCapture` lists screens and windows with thumbnails for the app's own picker, then answers Chromium's `getDisplayMedia()` request with the chosen source (`setDisplayMediaRequestHandler`), with or without loopback audio.
- `NativeLoopback` runs `win-audio-capture.exe` when Chromium can't capture the audio we need (surround devices, everything except Discord, or only the shared window's app) and forwards its PCM to the renderer over IPC. See [media pipeline → audio](media-pipeline.md#system-audio).
- `CursorWatch` runs `win-cursor-watch.exe` while sharing on Windows and reports whether the cursor is hidden and which window is in front (fullscreen or not, on which display). The renderer shares it between its users (`foregroundWatch.ts`): on Windows before 11 24H2, a fullscreen game's window is shared in place of the screen while it hides the cursor (see [media pipeline → games that hide the cursor](media-pipeline.md#games-that-hide-the-cursor-windows)); and **Optimize for: Automatic** picks smooth motion or sharp text (see [capture](media-pipeline.md#capture)).

## Renderer: the session objects

When you join or host a room, `src/renderer/lib/session.ts` creates a **Session**:

```mermaid
classDiagram
  class Session {
    role: host or viewer
    client: RoomClient
    publisher: Publisher
    watches: WatchManager
    hosted: HostedRoom or null
  }
  class RoomClient {
    participants, room, messages
    snapshots, avatars
    rttMs, clockOffsetMs
    +send(msg)
    +sendBinary(data)
    +setAvatar(image)
    +leave()
  }
  class Publisher {
    one RTCPeerConnection per watcher
    +startCapture(source, audio, excludeDiscord)
    +setPaused(paused)
    +setAudioMuted(muted)
    +stopSharing()
    +updateSettings(settings)
  }
  class WatchManager {
    +watch(streamerId)
    +unwatch(streamerId)
    routes TCP packets by slot
  }
  class Subscription {
    state: idle, negotiating, streaming, failed, ended
    transport: webrtc or tcp
    +setViewHeight(px)
    +setQuality(id)
    +retry(transport)
  }
  class TcpEncoder
  class TcpDecoder
  Session --> RoomClient
  Session --> Publisher
  Session --> WatchManager
  WatchManager "1" o-- "many" Subscription
  Publisher ..> TcpEncoder : TCP watchers
  Subscription ..> TcpDecoder : TCP fallback
  Publisher ..> RoomClient : signaling
  Subscription ..> RoomClient : signaling
```

| Object | File | Job |
|---|---|---|
| `RoomClient` | `lib/roomClient.ts` | The WebSocket to the room: hello/welcome, presence, chat, previews, profile pictures, ping and clock offset, automatic reconnect that resumes the same seat. |
| `Publisher` | `lib/publisher.ts` | Your own share: capture, audio, one `RTCPeerConnection` per watcher, adaptive quality, view-size caps, upload budget, previews, stats. One shared WebCodecs encoder for TCP watchers. |
| `WatchManager` | `lib/watches.ts` | The set of streams you chose to watch. Re-subscribes if a watched streamer comes back within 30 s. Routes relayed TCP packets to the right `Subscription` by slot. |
| `Subscription` | `lib/subscription.ts` | Watching one streamer: asks for WebRTC, falls back to TCP after 8 s or on ICE failure, reports stats and the displayed size and quality choice. |
| `TcpEncoder` / `TcpDecoder` | `lib/tcpStream.ts` | The TCP fallback: WebCodecs encode on the streamer side, decode into a `MediaStreamTrack` on the watcher side. |

## Renderer: the UI

```mermaid
flowchart TB
  App["App.tsx<br/>settings, toasts, join/host"]
  App --> Rooms["RoomsSidebar (left)<br/>recent and network rooms, PIN, Join by IP, name, settings"]
  Rooms --> Members["RoomMembers<br/>people in your room: live, watch, preview, host menu"]
  App --> Welcome["Welcome<br/>centre when not in a room"]
  App --> Room["RoomView<br/>centre and right, one per session"]
  App --> Dlg["Dialogs<br/>CreateRoom, ChangeSource, Settings (+ picture cropper)"]
  Room --> Info["RoomInfo (ⓘ)<br/>details; AccessPanel and End room for the host"]
  Room --> Stage["Stage<br/>a 16:9 tile per person (bestTileGrid), or spotlight"]
  Stage --> Person["PersonTile<br/>picture, or a live stream's preview + Watch"]
  Stage --> Self["SelfTile<br/>your stream, after Show my stream"]
  Stage --> Remote["RemoteTile<br/>one per watched stream"]
  Self --> SV["ScreenViewer<br/>video, stats badges, volume (lib/volume.ts)"]
  Remote --> SV
  Room --> Bar["Control bar<br/>share, pause, audio, source, stop, stats and quality, leave"]
  Room --> Chat["ChatPanel (right)"]
```

Components subscribe to the session objects' events (`client.on('participants', …)`, `publisher.on('stats', …)`, …) and keep React state as copies. Session objects never import React.

## VPN rooms

A room can open a VPN for guests outside the network (see [VPN rooms](vpn-rooms.md) for the user's view). The pieces, all in the main process:

| Piece | File | Job |
|---|---|---|
| `VpnManager` | `src/main/vpn/manager.ts` | One VPN at a time: creates the host side, or enrols as a guest from an invite. Decides what this computer can do (`VpnEnvironment`). |
| `VpnHost` | `src/main/vpn/host.ts` | The host's tunnel, key pair, invite secret and guest addresses. Answers `POST /vpn/enroll` (secret check with lockout, one enrolment at a time). |
| `VpnTunnel` | `src/main/vpn/tunnel.ts` | `SystemTunnel`: starts the helper with administrator rights, then sets keys and peers over its control socket. |
| helper, elevate | `src/main/vpn/helper.ts`, `elevate.ts` | Find the bundled helper, check it against build-time checksums, and start it through the system's permission prompt (macOS authorization, UAC, pkexec). |
| `ssvpn` | `native/ssvpn/` (Go) | The only code that runs as administrator: creates the interface (Wintun, utun, TUN) with WireGuard's Go library, sets address, route and forwarding, serves the control socket to your user, undoes everything when the app is gone. Built by `scripts/build-vpn.cjs`. |
| `fake.ts` | `src/main/vpn/fake.ts` | A tunnel that carries nothing, for end-to-end tests (`SCREENSHARE_FAKE_VPN=1`). |

`RoomServer` only parses `POST /vpn/enroll` and hands it to the `VpnEnrollHandler` it was given. `RoomManager.createRoom()` creates the `VpnHost` first, starts the server, then brings the tunnel up with the server's port, and puts the invite in `HostedRoom.vpn`. `RoomManager.joinVpn()` is the guest's side: enrol, tunnel up, then wait for the room to answer at the host's VPN address, and list it like a manually added room (not saved to settings).

## Key flows

### Hosting a room

```mermaid
sequenceDiagram
  participant UI as Renderer (App)
  participant Main as Main (RoomManager)
  participant Srv as RoomServer
  participant LAN as mDNS
  UI->>Main: host.create(name, privacy, pinLength)
  Main->>Main: load or create TLS identity, make PIN + host token
  Main->>Srv: start() on port 47800 (or next free)
  Main->>LAN: publish _lanshare._tcp with TXT id, v, tls, fp
  Main-->>UI: HostedRoom (port, pin, hostToken, addresses)
  UI->>Srv: wss://127.0.0.1 hello(hostToken)
  Srv-->>UI: welcome
  UI->>UI: startCapture(source), publish stream-state
```

### Joining a room

```mermaid
sequenceDiagram
  participant V as Viewer app
  participant M as Viewer main process
  participant S as RoomServer
  M->>M: mDNS browse finds the room (or Join by IP)
  M->>S: GET /info (checks certificate fingerprint)
  S-->>M: name, privacy, people, live streams
  V->>M: rooms.resolve (fresh probe, trusts the certificate)
  V->>S: WebSocket hello(clientId, name, pin?, decoders)
  alt wrong PIN
    S-->>V: error bad_pin (attemptsLeft) or locked
  else accepted
    S-->>V: welcome(selfId, resumeToken, room, participants, history)
    S-->>V: snapshot and avatar messages for the current state
    V->>S: set-avatar (current picture or none)
  end
```

### Sharing and watching

See the sequence diagrams in the [protocol reference](protocol.md#watching-a-stream-webrtc) and the pipeline in [media pipeline](media-pipeline.md).

### Network drop and resume

```mermaid
sequenceDiagram
  participant C as RoomClient
  participant S as RoomServer
  Note over C,S: The connection drops
  S->>S: seat becomes "reconnecting", its stream ends, 30 s grace timer
  C->>C: retry with backoff 0.5 s, 1 s, 2 s … up to 8 s (for up to 60 s)
  C->>S: hello(clientId, resumeToken)
  S-->>C: welcome (same seat, no PIN needed)
  C->>S: stream-state (if it was sharing), set-avatar
  Note over C: Subscriptions re-request their streams, watchers of our stream re-subscribe
```

## Where state lives

| State | Owner | Persisted? |
|---|---|---|
| Settings (name, picture, quality, audio, network…) | `SettingsStore` (main) | `settings.json` in the user data folder |
| Host TLS key and certificate | `RoomManager` | `host-identity.json` (mode 600) |
| Room membership, chat history, previews, pictures | `RoomServer` (host) | Memory only; gone when the room ends |
| PIN | `RoomManager` / `RoomServer` | Memory only, never written to disk |
| Per-stream volume and quality choice | Renderer | `localStorage`, keyed by streamer name |
| Logs | File logger (main) | `screenshare.log`, rotated at 5 MB |

Paths for these files are listed in the [user guide](user-guide.md#where-your-files-are).
