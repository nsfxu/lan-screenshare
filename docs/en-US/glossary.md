# Glossary

Words used in the code and in these docs.

> **Language:** English · [Português (Brasil)](../pt-BR/glossary.md)

| Term | Meaning |
|---|---|
| **Adaptive controller** | `AdaptiveController` in `src/shared/quality.ts`. Moves one connection up or down the quality ladder based on loss, RTT and WebRTC's quality limitation. |
| **Avatar** | A participant's profile picture: a 128 px JPEG data URL, sent with `set-avatar` and redistributed as `avatar`. |
| **Budget (upload budget)** | The streamer's total upload limit, split between watchers by max-min fairness (`splitBudget`). |
| **clientId** | A random id created on first launch and stored in settings. Identifies an install to rooms (used for resume and kick bans). |
| **Endpoint loopback** | Capturing everything an output device plays (WASAPI loopback). |
| **Fingerprint** | SHA-256 of the host's TLS certificate. Advertised over mDNS and pinned by viewers. |
| **Host** | The participant whose app runs the `RoomServer` for the room. Also a participant who can share and watch. |
| **Host token** | A random secret that proves to the server that a connection is the host's own app. |
| **Ladder / preset** | The list of quality levels (`QUALITY_PRESETS`): Native60, 1080p60, 720p60, 720p30, 480p30. |
| **Main process / renderer / preload** | Electron's Node.js process, the sandboxed Chromium page, and the bridge between them. |
| **mDNS / DNS-SD** | Multicast DNS service discovery, used to advertise and find rooms (`_lanshare._tcp`). |
| **Participant** | Anyone in a room, including the host. |
| **Preview / snapshot** | A 320 px JPEG of a live stream, refreshed every 5 s, shown on stream cards. |
| **Process loopback** | Capturing the system mix minus one process tree (Windows 10 2004+). Used to leave Discord out. |
| **Profile (`--profile`)** | A command-line option that gives an app instance its own settings folder, for running several instances on one computer. |
| **Protocol version** | `PROTOCOL_VERSION`. Must match between everyone in a room. |
| **Publisher** | The renderer object that handles *your* share (`src/renderer/lib/publisher.ts`). |
| **Resume token** | Given in `welcome`. Lets a client that dropped get its seat back within 30 s without the PIN. |
| **RoomServer** | The server inside the host's main process (`src/main/server.ts`). |
| **Seat** | The server's record for one participant: connection, stream, watchers, preview, picture. |
| **Signaling** | The WebRTC offer/answer/ICE messages that set up a connection. Relayed by the server. |
| **Slot** | A small number (0–255) per participant. The server prefixes TCP-fallback packets with the streamer's slot so watchers can route them. |
| **Spotlight** | The layout where one watched stream is big and the others are in a strip. |
| **Streamer** | A participant who is sharing their screen. |
| **Subscription** | The renderer object for watching one streamer (`src/renderer/lib/subscription.ts`). |
| **TCP fallback** | The backup transport when WebRTC can't connect: WebCodecs encoding, packets relayed over the room's WebSocket. |
| **View limit** | What a watcher asks for: the height it displays the stream at (or its chosen maximum) and an optional fps cap. |
| **Watcher** | A participant who is watching someone's stream. |
| **WatchManager** | The renderer object that holds all your subscriptions (`src/renderer/lib/watches.ts`). |
