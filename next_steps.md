# Next Steps

A roadmap by version. Anything that changes the protocol (`PROTOCOL_VERSION`: older apps can't share a room with newer ones) waits for **3.0.0** (2.0.0 was the redesign, with the same protocol); everything else ships in 2.x minor versions. Each item adds its line to `CHANGELOG.md` when it lands, and `npm run release -- minor` cuts the version.

| Version | Theme | Items |
|---|---|---|
| **1.2.0** | Safer releases, better game streaming | ✅ All done: UI test in CI, pause video for hidden viewers, game-only audio, game-aware quality, versions in the app, struggle warnings |
| **2.0.0** | Released: the redesign | ✅ New layout (PRs #11–#18), themes, menus, title bar, Settings sections |
| **2.1.0** | Released: better watching | ✅ Full screen like a player, no border on the focused stream, the computer's CPU and memory in Stats (PR #22), ZeroTier guide (PR #21; screenshots to come) |
| **2.2.0** | Released: automatic updates | ✅ Windows downloads new versions and offers **Restart to update**; macOS links to the download (PR #24). Everyone downloads 2.2.0 once by hand |
| **2.3.0** | Watching | Picture-in-picture, pop-out window, low-latency mode, share again, copy diagnostics, encoder-limit test |
| **2.4.0** | Portuguese and performance | App in Portuguese; the performance tasks are planned in `plans/performance.md` (for a cloud agent) |
| **3.0.0** | Rooms that survive | Host migration ("Make host", and the room goes on when the host leaves) |
| Anytime | Needs a Mac | Test the macOS build |
| Parked | Internet rooms | Joining over the internet without a VPN: built, not merged (ZeroTier covers it for now) |

⭐ = priority: do these first.

---

## 2.1.0: Better watching ✅ (released)

### ZeroTier guide (docs only, no version)
A short tutorial, in both languages: create a network (my.zerotier.com, Private, auto-assign IPv4), friends install ZeroTier One and paste the network ID, approve them under Members, answer **Yes** when Windows asks about being discoverable (a "Public" network gets blocked by the firewall). Then the room list, or **Join by IP** with the host's ZeroTier address.
- Link it from the user guide, troubleshooting ("the room doesn't show up") and the READMEs.
- Tested with friends: rooms show up in the list by themselves over ZeroTier (mDNS crosses it). Screenshots from the user to come.

### Full screen like a player
- The focused stream fills the whole screen: no accent border, no rounded frame, no gap.
- Everything else (strip, controls, name, stats badges, cursor) is hidden until the mouse moves, and floats over the picture instead of taking space from it. It fades again after a moment without movement.

### The computer's CPU and memory in the stats
The Stats panel shows the app's CPU and memory; add the whole computer's (games included), so a streamer sees when the PC itself is the bottleneck.

---

## 2.3.0: Watching

### Picture-in-picture for watched streams
Pop a friend's stream into a small always-on-top window, to keep watching while you play or use other apps.
- Chromium supports `video.requestPictureInPicture()` on the tile's `<video>`; offer it in the stream's right-click menu and next to the volume and full-screen buttons under a focused stream.
- For the TCP fallback, the tile's video is fed by a `MediaStreamTrackGenerator`: check PiP works there too.
- The view-size report (only send what's shown) should use the PiP window's size while it's open, and not count it as hidden.

### Pop out a stream into its own window
Open a watched stream in a separate app window (e.g. full size on a second monitor), independent of the room window.
- A second `BrowserWindow` needs the stream: either move the `Subscription` there, or relay the `MediaStream` (not transferable between windows; likely a second subscription or a `MediaStreamTrack` bridge). Needs a small design first.
- Closing the pop-out puts the tile back in the room.

### Low-latency mode for viewers
Already on: watchers set `jitterBufferTarget = 0`. What's left is measuring it, and maybe a "smoother playback" option for Wi-Fi/ZeroTier: Task 2 of `plans/performance.md`.
- Measure first: latency estimate and stutter/freeze counts before and after, on a LAN, on Wi-Fi and over ZeroTier.
- Probably a per-viewer setting (on by default on wired LANs?), since a small buffer can stutter on bad networks.

### "Share again" in one click
Remember the last source (screen or window, matched by name for windows since their ids change) and the audio options, and offer **Share again** next to **Share screen**.

### "Copy diagnostics" button
One click in Settings copies (or saves) what a bug report needs: app and protocol version, OS, GPU and codecs (hardware encoders/decoders), network addresses, current settings (no PINs or tokens) and the last part of the log.

### Test: how many viewers before hardware encoding runs out
Each viewer has their own connection and therefore their own hardware encoder session. 8 simultaneous 1080p hardware encodes were measured working on an NVIDIA GPU; consumer GPUs have a limit (and Intel/AMD have their own).
- Measure with 9–12 viewers (several `--profile` instances): what encoder does viewer 9+ get (`encoderImplementation`), CPU, fps, latency.
- Repeat on an Intel iGPU / AMD machine if available. Write the numbers in `docs/*/media-pipeline.md` (measured results).
- The results decide the fix in 2.4.0.

---

## Performance (plan for a cloud agent)

All performance work is planned step by step in [`plans/performance.md`](plans/performance.md): a measuring tool first (`npm run perf`), then the encoder-limit test, latency, faster capture, the encoder-limit fix, 120 fps, and no video for hidden TCP viewers. The agent builds; the owner runs the measurements on real PCs.

---

## 2.4.0: Portuguese and performance

### App in Portuguese
The interface is English only while the docs are bilingual.
- Extract UI strings into en/pt-BR dictionaries; a language setting that follows the system by default.
- The installers already keep Chromium's en-US and pt-BR language files (`electronLanguages`).
- Messages that come from the room server (errors, system chat lines): send a code alongside the current text, and translate on the client. Older apps keep using the text, so no protocol change.

### Faster capture path (experiment)
Chromium 152 has a zero-copy desktop capture feature (`kZeroCopyDesktopCapture`) that keeps frames on the GPU from capture to encoder.
- Enable it with `--enable-features`, then measure CPU, encode time and latency at 1080p60 against today, for screens and windows.
- Keep it only if it's stable (no black frames, no crashes after GPU driver resets). Same approach for `WebRtcAllowWgcUsingTexture` on window capture.

### High frame rate on LAN (experiment)
Try 120/144 fps for high-refresh games on wired LANs.
- Check whether capture delivers more than 60 fps (DXGI and WGC), whether hardware encoders keep up at 1080p120, and what the viewer's display does with it.
- Only add a quality preset (e.g. "1080p @ 120 fps", LAN only) if the measurements hold up. Check that older apps accept the new preset id in watch-quality messages; if not, it waits for 3.0.0.

### Encoder-limit fixes
Depending on the 2.3.0 test: for example, once a streamer runs out of hardware encoder sessions, move additional viewers to the TCP path (one WebCodecs encoder shared by all TCP viewers) instead of software-encoding each one, and tell the streamer.

---

## 3.0.0: Rooms that survive

Protocol changes: everyone updates together. "Show versions in the app" shipped in 1.2.0, so 1.x and 2.x users are told to update.

### Keep the room alive when the host leaves
Asked for after testing over ZeroTier: pass the host role to someone else and leave. Who hosts doesn't change video latency (on WebRTC each stream goes straight from the streamer to each watcher; only signaling, chat and the TCP fallback pass through the host).
Today the room server runs inside the host's app: if the host closes it or crashes, the room ends for everyone.
- Host migration: the host names a successor (right-click → **Make host**; or it's the longest-connected participant), their app starts a room server, and everyone moves over automatically, keeping chat, seats and streams.
- Building blocks already exist: seat resume without the PIN, watches that resume by themselves, connecting by IP (ZeroTier addresses work the same).
- To design: how clients learn the successor's address and certificate fingerprint in advance (sent by the server while the room is healthy), how the PIN/privacy settings carry over, what happens when two people think they're the successor, and the host role after migration.

### ~~Full video pause for hidden viewers~~ (moved)
On WebRTC it's already done (hidden watchers' encoding is `active: false`); the TCP half needs no protocol change. Now Task 6 of `plans/performance.md`.

---

## Anytime: needs a Mac

### Test the macOS build on a real Mac
The `.dmg` files are built by the release workflow but have never been run.
- Install (unsigned: right-click → Open), Screen Recording permission, Local Network permission, sharing a screen and a window, watching from Windows and back.
- System audio on macOS 13+ (ScreenCaptureKit loopback behind Chromium flags), and how the cursor behaves when a game hides it.
- Write down what works in `docs/*/troubleshooting.md` and remove "experimental" from the release notes once it does.

---

## Parked: internet rooms

Joining over the internet without a VPN. Parked on 2026-10-07: ZeroTier does the job for the group, and is faster to set up than a router change.
- **Phase 1 is built** on the local branch `feat/internet-rooms` (5 commits, all tests passing, never pushed: GitHub refused every push that day; a copy is in `release/internet-rooms.bundle`). The host's router opens the port (our own UPnP client: IGD v1 and v2, IP and PPP connections), Public and Private as on the LAN, a room-wide limit on wrong PINs from the internet, internet guests watch through the host's TCP relay, and the "LAN only" rule becomes "no outside services".
- **Lessons**: the host's router needs UPnP on (or a manual port forward, or IPv6), which many provider modems have off; CGNAT makes hosting impossible. Only the host needs it.
- **Phase 2 ideas** (3.0.0 or later): invite links with the certificate fingerprint, the host answering STUN so friends connect directly, a stand-alone room server a group rents for hosts behind CGNAT.

---

## Backlog

### Who's inside, in the room list
The room list shows a head count per room. Show the people's pictures (a row of avatars, "+5") instead.
- `/info` is probed every 3 s per room, so names and colours are cheap, but profile pictures must only be sent when they change (e.g. a picture hash in `/info` and a separate endpoint for the images).
- Private rooms keep showing only the count.
- Additive `/info` fields: no protocol change.

### Smaller ideas
- Join / leave / "went live" sounds (with a setting).
- A light theme that follows the system, and a spacing pass.
