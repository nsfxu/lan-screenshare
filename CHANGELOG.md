# Changelog

Every user-visible change to ScreenShare, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) with one rule of our own (see [development → versions](docs/en-US/development.md#versions-and-the-changelog)):

- **Major** (2.0.0): `PROTOCOL_VERSION` changed. Older apps can't join rooms of this version, so everyone must update.
- **Minor** (1.1.0): new features that still work with other 1.x apps.
- **Patch** (1.0.1): fixes only.

Each change adds its line under **Unreleased** in the same pull request, written for the people using the app. `npm run release` turns that section into a version.

## [Unreleased]

### Added

- Rooms on an incompatible version now say who has to update, e.g. "This room runs ScreenShare 2.0.0, you have 1.2.0: update to join", on the room card and when joining, instead of "Unreachable" or "This room runs a different app version". Rooms report their app version from now on, so this works when 2.0.0 arrives.
- When someone in your room runs a newer version of ScreenShare, you get a one-time suggestion to update.
- **Only this app's sound** (Windows): when you share a single window, viewers hear only that app, for example your game without Discord, music or notifications. On by default when you share a window; turn it off in the share dialog, or change the default in Settings.

### Changed

- **Optimize for** has a new **Automatic** setting, now the default (Windows): smooth 60 fps while a fullscreen game or video is in front of what you share, sharp text on the desktop. Settings from 1.1 that still had the old default (Smooth motion) move to Automatic; choose Smooth motion again in Settings to keep it. The Stats panel shows which one is in use.
- Streams you can't see stop sending you video while the app is minimized or another tile is full screen (you still hear them), saving the streamer's upload and your network. The picture comes back within a second, and streamers see you as "not looking (video paused)".

## [1.1.0] - 2026-09-30

### Added

- Games that hide the mouse cursor no longer show one to viewers while you share your screen on Windows 10 (or 11 before 24H2): while a fullscreen game hides the cursor, the app shares the game's window instead, and goes back to your screen when you alt-tab. A notice in the room says when this happens, with a button to keep sharing the screen. For games in a window, the room suggests sharing their window.

### Fixed

- Choosing a window that can no longer be captured (closed, or minimized like a fullscreen game after alt-tab) now shows an error instead of sharing your first screen.

## [1.0.0] - 2026-09-25

The first release.

### Added

- Rooms on the local network appear by themselves; **Connect by IP** for VPNs and other subnets.
- Public or private rooms, with a 4–6 digit PIN the host can change at any time. Three wrong tries lock that computer out for 5 minutes.
- Anyone in a room can share, several screens at once, in a grid or a spotlight. Nothing plays until you choose it, and your own stream stays hidden until you click **Show**.
- Up to 1080p60 (or native resolution) with hardware encoding. The streamer sets the maximum from the toolbar, each viewer picks what they receive per stream, small tiles cost less, and each viewer's quality adapts to their network.
- Computer sound, including 5.1/7.1 headsets, and **Leave out Discord** on Windows so the people in your call don't hear themselves.
- Chat, profile pictures with cropping, and host controls: remove people, stop streams, delete messages, mute the chat.
- Zoom, pan and full screen, with controls that hide when the mouse is still.
- Reconnects after short network drops, and switches to TCP when a network blocks WebRTC.
- Encrypted connections, the PIN kept only in memory, and the window hidden from screenshots while you watch.

[Unreleased]: https://github.com/nsfxu/lan-screenshare/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/nsfxu/lan-screenshare/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nsfxu/lan-screenshare/releases/tag/v1.0.0
