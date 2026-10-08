# Changelog

Every user-visible change to ScreenShare, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/) with one rule of our own (see [development → versions](docs/en-US/development.md#versions-and-the-changelog)):

- **Major** (2.0.0): `PROTOCOL_VERSION` changed (older apps can't join rooms of this version, so everyone must update), or a big redesign. The release notes always say whether older apps can still join.
- **Minor** (1.1.0): new features that still work with other 1.x apps.
- **Patch** (1.0.1): fixes only.

Each change adds its line under **Unreleased** in the same pull request, written for the people using the app. `npm run release` turns that section into a version.

## [Unreleased]

## [2.3.0] - 2026-10-08

### Changed

- **More room for the streams**: the bar at the top of the room is gone, and so is the strip of buttons under it. The controls now float over the bottom of the room, show when you move the mouse there and hide after a moment, each with a tooltip: on the left the room details (ⓘ) and, for a focused stream, the grid and strip buttons; in the middle **Share screen** (a green screen icon while you share, with **Stream stats** now in its menu) and the red leave button, both a little larger; on the right the focused stream's volume, **New window**, and **Full screen**. All with new, bolder icons.
- The room's name is in the title bar, and the chat button floats at the top right of the room, under the window's own buttons. Notices appear above the controls instead of covering them.
- Questions like "End the room for everyone?" or "Remove Bob?" now appear in the app's own dialog, in its colours, instead of a plain system box. **Esc** closes an open dialog or menu before it leaves the focused view.
- **The first stream you watch opens focused**, with everyone else in the strip below.
- **Watch all** is gone; start streams from their tiles or the rooms column.

### Added

- **Who's watching**: a stream shows how many people watch it, with their pictures; point at it for their names.
- **New window**: open a stream in a window of its own, for example full size on a second monitor. It has the app's title bar, colours and controls (volume, back to the room, full screen), keeps playing when the room is minimized, and the tile says where it went.
- **Show only streams** (in the right-click menu) leaves out the people who aren't sharing, so the streams get all the space. It's remembered.
- A stream you muted shows a crossed-out speaker next to its name.

## [2.2.1] - 2026-10-08

### Fixed

- **No more short freeze about once a minute** when watching a shared desktop at full size. Every minute or so the stream sends a full picture, and it used to arrive slowly enough to stall the video for a moment (0.2–0.9 s); it now arrives without a pause.

## [2.2.0] - 2026-10-07

### Added

- **Automatic updates on Windows**: the app looks for a new version every few hours, downloads it in the background, and shows **Restart to update** in the title bar when it's ready. You choose when to restart (it asks first if you're in a room); nothing installs by itself when you close the app. On macOS the title bar offers **Update to …**, which opens the download page. Turn it off in **Settings → About**, where **Check now** also is. This is the only thing the app does on the internet. From this version on, you won't need to download new versions by hand on Windows.

## [2.1.0] - 2026-10-07

### Changed

- **No more blue border around the focused stream.**
- **Full screen works like a video player**: the stream fills the whole screen with no frame around it, and the strip and the controls float over its bottom instead of taking space. After a moment without moving the mouse everything but the picture hides, the name and the stats badges included; moving the mouse brings it back.

### Added

- **Stats** also shows the whole computer's CPU and memory (games and other apps included), next to the app's, so you can tell when the computer itself is the bottleneck.
- A guide to [playing over ZeroTier](docs/en-US/zerotier.md) with friends on other networks: set up in a few minutes, and rooms show up in the list by themselves.

## [2.0.0] - 2026-10-06

### Added

- **Themes**: choose the app's colours in **Settings → Appearance**: Classic, Graphite, Midnight or Charcoal. They apply immediately.

### Changed

- New layout in three columns: your rooms on the left, the room in the middle, people and chat on the right. You can switch rooms in one click, and hide either side column (the app remembers which). Your name, picture and Settings are at the bottom left.
- **Recent rooms**: the last 5 rooms you joined are listed first, so you can go back to one in one click, even on a VPN.
- The people in your room are listed under it in the rooms column, with a **Live** badge on whoever is sharing. Click someone live to watch them (hover to see a preview first), and click again to stop. Hosts moderate from the **⋯** next to a name.
- Private rooms ask for the PIN right under the room in the list, instead of in a separate window.
- Everyone in the room has a tile in the middle, with their picture and name; people sharing show a preview of their stream with a **Watch stream** button, and watched streams play in their tile. Tiles keep a 16:9 shape and grow with the window. When you're alone, an **Invite people** tile shows your address.
- A new control bar under the tiles: share and your sharing controls, **Stats** (now also where you set the quality you send), and a red button to leave. In a narrow window the buttons show only their icons.
- Chat: messages someone sends within 5 minutes share one name and picture (hover for each time), the message box says which room you're writing to, and while the chat is hidden its button counts the new messages.
- While you share, a green **Sharing** button replaces the row of sharing buttons: click it for change source, mute audio, the quality you send and stop sharing. It sits right of the leave button, like **Share screen**. Pausing by hand is gone (**Pause sharing while minimized** still pauses on its own).
- Right-click menus: on your own tile (show or hide your stream, and the sharing options), on someone else's (volume slider, mute, stop watching, focus, full screen, the quality you receive) and on people in the rooms column. Hosts also find stop stream and remove there.
- Streams show just their name over the top: the quality, focus and stop buttons moved to the right-click menu, and zooming is gone. Under a focused stream, a speaker mutes it (or unmutes to the last volume; point at it for a slider), next to a full-screen button.
- Double-click a stream for full screen: the stream with everyone else and its controls below, which fade (with the pointer) when the mouse rests.
- Click a tile to focus it, and again (or the grid button under it, or Esc) to go back to the grid. In focus, **Hide others** puts the strip away and pauses the video of the streams in it.
- The window has its own title bar in the theme's colours (the system's window buttons stay as they are).
- The room's header is slimmer and shows who's in the room as pictures instead of a head count.
- **Join by IP** (was the unlabelled "Connect by IP" icon) is now a labelled button next to **Create room**; refreshing the list moved next to "Rooms on your network".
- Settings lists its sections on the side (Profile, Appearance, Sharing, Notifications, Connection, Advanced, About); a click jumps there.
- In a small window (from 640×480, for example snapped next to a game) the chat and then the rooms column make room for the tiles, and open over the room when you need them.
- Stream previews refresh about once a minute instead of every 5 seconds (still right away when someone starts sharing or switches source), so a room of streamers sends far fewer images around.
- The room's details, privacy, PIN and **End room** are behind the **ⓘ** next to the room's name; the right column is just the chat.
- The window title shows the room you're in.

## [1.2.0] - 2026-10-05

### Added

- Rooms on an incompatible version now say who has to update, e.g. "This room runs ScreenShare 2.0.0, you have 1.2.0: update to join", on the room card and when joining, instead of "Unreachable" or "This room runs a different app version". Rooms report their app version from now on, so this works when 2.0.0 arrives.
- When someone in your room runs a newer version of ScreenShare, you get a one-time suggestion to update.
- When your stream struggles for a while, the room says why: your computer can't encode fast enough, your upload can't keep up with everyone, or your graphics card ran out of hardware encoders. A button lowers your quality one step. Each notice shows at most once every 10 minutes and goes away once the problem does.
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

[Unreleased]: https://github.com/nsfxu/lan-screenshare/compare/v2.3.0...HEAD
[2.3.0]: https://github.com/nsfxu/lan-screenshare/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/nsfxu/lan-screenshare/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/nsfxu/lan-screenshare/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/nsfxu/lan-screenshare/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/nsfxu/lan-screenshare/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/nsfxu/lan-screenshare/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/nsfxu/lan-screenshare/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/nsfxu/lan-screenshare/releases/tag/v1.0.0
