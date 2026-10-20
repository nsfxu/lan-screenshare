# User guide

Everything you can do in ScreenShare, from finding a room to fine-tuning quality. No technical background needed.

> **Language:** English · [Português (Brasil)](../pt-BR/user-guide.md)

## Contents

- [Before you start](#before-you-start)
- [Your name and picture](#your-name-and-picture)
- [Finding a room](#finding-a-room)
- [Creating a room](#creating-a-room)
- [Sharing your screen](#sharing-your-screen)
- [Watching other people](#watching-other-people)
- [Chat and people](#chat-and-people)
- [If you are the host](#if-you-are-the-host)
- [Settings](#settings)
- [Language](#language)
- [Updates](#updates)
- [Mouse and keyboard](#mouse-and-keyboard)
- [Privacy](#privacy)
- [Where your files are](#where-your-files-are)

## Before you start

- **Computers**: Windows 10/11 or macOS. System audio on macOS needs macOS 13 or newer. Leaving Discord out of the audio needs Windows 10 version 2004 or newer, or macOS 14.2 or newer.
- **Network**: everyone must be on the same local network or VPN. Nothing goes over the internet (apart from the update check) and there are no accounts.
- **Compatible versions**: 1.x and 2.x apps can share a room (2.0.0 changed the look, not how apps talk to each other). Only a version that changes the room protocol, such as a future 3.0.0, needs everyone to update; the room list then says who has to, e.g. "This room runs ScreenShare 3.0.0, you have 2.0.0: update to join". When someone in your room runs a newer version, you get a one-time suggestion to update.
- **macOS**: the first time you open the app, macOS blocks it until you allow it once; see [opening it for the first time on macOS](#opening-it-for-the-first-time-on-macos). The first time you share, macOS asks for **Screen Recording** permission, and it may ask for **Local Network** access. Allow both, then restart the app if asked.

```mermaid
flowchart LR
  A["Open ScreenShare"] --> B{"Is there a room?"}
  B -->|"Yes, in the list"| C["Join it"]
  B -->|"On a VPN or another subnet"| D["Join by IP"] --> C
  B -->|"No"| E["Create room"] --> F["Pick a screen or window"]
  C --> G["Watch streams, chat, share your own screen"]
  F --> G
```

### Opening it for the first time on macOS

ScreenShare isn't notarised by Apple yet, so macOS stops it the first time with the message *Apple could not verify "ScreenShare" is free of malware*. Clicking **Done** only closes that message; the app stays blocked until you allow it:

1. Drag ScreenShare from the disk image into **Applications** and open it from there (not from the disk image window).
2. When the message appears, click **Done**.
3. Open *System Settings → Privacy & Security* and scroll down to **Security**. It says ScreenShare was blocked; click **Open Anyway** next to it. The button only shows for about an hour after you tried to open the app: if it isn't there, open ScreenShare again, click **Done**, and come back.
4. Enter your password or use Touch ID. ScreenShare opens (if macOS asks once more, click **Open Anyway** or **Open**).

You only do this once per version you download; afterwards ScreenShare opens normally. On macOS 14 and older, right-clicking the app → **Open** → **Open** also works.

## Your name and picture

- Your **name** is shown at the bottom of the rooms column, on the left. Click it to change it. You can also change it in **Settings → Profile**.
- Your **profile picture** is set in **Settings → Profile → Choose…**. After you pick an image, a crop window opens:
  - drag the picture to move it;
  - scroll, or use the slider, to zoom;
  - the circle shows what other people will see, and a small preview shows the result.

  Click **Use picture** to save it or **Cancel** to keep the old one. **Remove** goes back to your initials. People in the room see the change right away.

## Finding a room

The window has three columns: **rooms** on the left, the room you're in (or a welcome page) in the middle, and the room's **chat** on the right.

The rooms column lists:

- **Recent**: the last 5 rooms you joined, newest first, with the one you're in marked by a blue edge and its people under it. Click one to go back to it, even if it's on a VPN and not found by itself. Rooms that don't answer are folded under **Offline**, which says when you were last there and shows, faded, the host's picture (or initials) from your last visit; it's kept on your computer only, with each room. The **×** on a row forgets it.
- **On your network**: everything else found on your network. It updates by itself; the round arrow searches again right away.

Each room shows its host's profile picture (or their initials, or the room's first letter for hosts before 2.7.0), with a red dot while someone shares and a lock for private rooms. Under its name: who's inside, as their pictures (up to 4 in the list and 5 on the cards, then *+N*; hover over one for the name), or just how many for private rooms and hosts before 2.8.0; hover over the room for who hosts it, how long it has been open and its address. A room on an incompatible version says *Update to join* or *Older version* (hover for who needs to update). Rooms you added by IP have a **×** to remove them from the list. Click a room to join it. If you're already in a room, you leave it first; the app asks before that ends a room you host or stops your share.

While you're not in a room, the middle shows the rooms on your network as cards, each with a **Join** button, next to a card to create your own.

The button at the top of each side column hides it (the rooms column shrinks to a strip of room initials; the chat button floats at the top right of the room, under the window's own buttons). The app remembers which columns you hid. In a small window (for example snapped next to a game) the columns make room for the tiles by themselves: below 1100 px wide the chat is closed, and below 760 px the rooms column is a strip. Their buttons then open them over the room, and clicking next to them puts them away.

**Join by IP**: if you are on a VPN or a different subnet, rooms may not appear automatically. Click **Join by IP** (next to **Create room**) and type the host's address, for example `10.8.0.5` or `192.168.1.20:47800`. Anyone in the room can see its address behind the **ⓘ** in the controls at the bottom of the room. The default port is 47800. The link under the room list opens the same box.

**Friends on other networks**: put everyone on a [ZeroTier](zerotier.md) network. It takes a few minutes, and rooms then show up in the list as if you were all at home.

**Private rooms** ask for a PIN (4 to 6 digits) right under the room in the list. After 3 wrong PINs, your computer has to wait 5 minutes before trying again.

## Creating a room

1. Click **Create room**.
2. Give it a name and choose **Public** (anyone on the network can join) or **Private** (people need a PIN, which is generated for you; pick 4, 5 or 6 digits).
3. Choose what to share: a whole **screen** or a single **window**.
4. **Share system audio** sends everything playing on your computer. On Windows and macOS, **Leave out Discord** (on by default) keeps your Discord call out of it, so people in the same call don't hear themselves through your stream. When you share a single **window** on Windows, **Only this app's sound** (on by default) sends just that app's sound, for example only your game, without Discord, music or notifications.
5. Click **Start sharing**.

For a private room, the PIN is copied to your clipboard so you can paste it to your friends.

Your computer now runs the room. If you close ScreenShare, the app asks first, because closing it ends the room for everyone.

## Sharing your screen

Anyone in a room can share, not just the host, and several people can share at the same time. Click **Share screen** in the controls at the bottom of the room and choose a screen or window.

**Share again**, next to it, shares the same screen or window as last time, with the same sound options, in one click (just its ↻ icon in a narrow window). It remembers your last share on this computer, also after a restart. A window is found again by its title, so if it's closed or its title changed, the picker opens instead.

**The controls** float over the bottom of the room: they show when you move the mouse over it, and hide after 2.5 s without movement or when the mouse leaves it. The name bar at the top of each stream hides and comes back with them. From the left:

| Where | Buttons |
|---|---|
| Left | **ⓘ** room details, the **cog** with the room settings (host only), then, when a stream is focused, **Grid** (back to the grid) and **Hide others / Show others** (the strip) |
| Middle | **Share screen** and **Share again** (or **Sharing** while you share), and the red **leave** button |
| Right | **Volume**, **New window** and **Picture in picture** (for the focused stream), and **Full screen** |

While you share, the button becomes a green screen icon. Click it (or right-click your own tile) for the sharing menu:

| Option | What it does |
|---|---|
| **Change source…** | Switch to another screen or window, or change the audio options, without anyone having to reconnect. |
| **Mute audio / Unmute audio** | Stops sending system audio while the video keeps going. It says **No audio** if audio isn't being captured. |
| **Quality you send** | The maximum quality you send (Native, 1080p, 720p at 60 or 30 fps, 480p). It applies immediately; each viewer may still get less, for example if their window is small or their network is slow. |
| **Stream stats** | Opens the stats panel (see below). |
| **Stop sharing** | Ends your stream. |

**Stream stats** shows your stream's resolution, frame rate, upload, encode time, codec, encoder, CPU and memory (the app's and the whole computer's, games included) and what is limiting quality, and also lets you change the quality you send.

The red button at the end leaves the room (for the host, it ends the room for everyone, after asking).

**When your stream struggles**, the room tells you why: your computer can't encode fast enough, your upload can't keep up with everyone watching, or your graphics card ran out of hardware encoders (some viewers are then encoded by the CPU). The notice only appears when the problem lasts several seconds, goes away once it's solved, and won't come back for the same reason for 10 minutes. **Lower to …** lowers your maximum quality one step.

**Your own stream isn't played back to you**, which saves your computer's GPU. Your own tile shows a preview that refreshes about once a minute. Click **Show my stream** to play it; **Hide my stream** in its right-click menu hides it again. You keep sharing either way.

**Playing a game while sharing your screen on Windows 10?** Windows would show your mouse cursor to viewers even when the game hides it. So while a fullscreen game hides the cursor, the app shares the game's window instead, which looks the same without the cursor, and goes back to your screen when you alt-tab. The room shows a notice while this happens. See [troubleshooting](troubleshooting.md#viewers-see-my-mouse-cursor-in-a-game) for windowed games.

## Watching other people

Everyone in the room has a **tile** in the middle: their picture and name. Tiles keep a 16:9 shape and grow as large as the window allows. Nothing plays until you choose: people who are sharing have a red **Live** badge, and their tile shows a preview of their stream, taken when they start and refreshed about once a minute.

- Click **Watch stream** on their tile, or click them in the rooms column (hover first to see their preview). Their tile then plays their stream, with their name over its top. Click them in the rooms column again, or **Stop watching** in the stream's right-click menu, to stop; an eye marks the streams you watch.
- **The first stream you watch opens in the spotlight**, with everyone else in a strip below. A second stream keeps the grid.
- **Click a tile** to put it in the **spotlight** (clicking one in the strip focuses it instead). Click the focused tile again, the **Grid** button in the controls, or press **Esc** to go back to the grid.
- **Show only streams** (in any tile's right-click menu) leaves out the people who aren't sharing, so the streams get all the space. It's remembered; while nobody shares, everyone shows anyway.
- **Who's watching**: a stream's name bar shows an eye with how many people watch it and their pictures; point at it for their names. A stream you muted shows a crossed-out speaker next to the name.
- The room's name is in the title bar, at the top of the window.
- **Double-click a stream** to fill the screen with it, like a video player: the stream takes the whole screen, and the strip and the controls float over its bottom. After 2.5 s without moving the mouse everything but the picture hides (the strip, the controls, the name, the stats badges and the pointer); move the mouse to bring them back. **Esc** or the **Full screen** button brings the window back. The same button, in the grid, fills the screen with the grid.
- **New window** (in the controls, or the stream's right-click menu) opens the focused stream in a window of its own, for example full size on a second monitor. It plays the same stream (no extra load on the person sharing), keeps playing when you minimize the room, and is hidden from screen recording like the room. Its tile says **Playing in another window**; **Bring back**, or closing the window, puts it back. The window has the app's title bar and colours, and the same controls as the room (volume, **Back to the room**, **Full screen**); double-click it for full screen.
- **Picture in picture** (in the controls, or the stream's right-click menu) pops the stream into a small window that stays on top of other apps, so you can keep watching while you play or work. Move and resize it as you like; it keeps playing when you minimize the room. One stream at a time: choosing another moves it there. Its sound still comes from the room, at the stream's volume. Click the button again, close the small window, or stop watching to end it.
- In the spotlight, **Hide others** puts the strip away so the focused tile gets the whole height; the streams in it stop sending you video until you show them again (you still hear them).
- When you're alone in your room, an **Invite people** tile shows the address to give people on a VPN.

**Right-click a stream** for everything about it, in sections:

| Option | What it does |
|---|---|
| **View**: **Focus**, **Show only streams / Show everyone**, **Full screen**, **Open in a new window**, **Picture in picture** | As above. **Show only streams** leaves out the people who aren't sharing (any tile's menu). |
| **Volume** (slider) | Each stream has its own volume, remembered per person; the speaker before the slider mutes and unmutes it. |
| **Quality you receive** | **Auto** follows the size you watch at, so a small tile uses little bandwidth. You can also cap it at 1080p, 720p, or 720p/480p/360p at 30 fps. Remembered per person. |
| **Try the faster connection again** | Only when the stream fell back to the slower TCP connection. |
| **Stop watching** | At the end, in red. |
| **Stop *name*'s stream**, **Remove from room** | Host only. |

**In the controls**, while a stream is focused, the speaker mutes it, or unmutes it back to the last volume; point at the speaker for its volume, on a slider that goes up and down.

The **stats badges** on a stream show its frame rate, latency, resolution, codec and connection type; turn them off in **Settings → Appearance**.

If a stream can't connect in 8 seconds (some VPNs and firewalls block it), the app switches to a TCP connection by itself. It adds a little latency but keeps working.

While you **minimize** the app, or put one tile in full screen, the streams you can't see stop sending you video (you still hear them), which saves the streamer's upload and your network. The picture comes back within a second when you look again. The streamer sees you as "not looking" under your name. A stream in picture-in-picture or in its own window keeps playing.

While you watch or share, your screen doesn't dim, go to sleep or lock by itself, like when you watch a video. It goes back to normal when you stop.

### Drawing on a stream

To point at something on a stream you watch, turn on the pen: **Draw on the stream** (the pen under a focused stream). While it's on, your mouse over the stream shows to everyone watching, and to the person sharing, as a dot in your colour with your name. Click and drag to draw a quick mark; marks fade after a few seconds. **Clear my marks** (the eraser next to the pen) removes yours. Click the pen again to stop.

When others draw on **your** stream, you see their marks on your own screen, over what you share, in a see-through window that clicks go through and that's left out of your stream (so marks don't show up twice). Marks go away when you stop sharing, and nothing is recorded.

- Turn it off for your stream with **Settings → Sharing → Allow drawing on my screen**. The host can turn it off for the whole room in the room settings (**cog → Allow drawing on streams**).
- The pen only shows when the host's app and the sharer's app are on 2.6.0 or later.
- Sharing a single window: watchers see each other's marks, but they don't show on your screen yet.

## Chat and people

- **Chat** is on the right: messages with time and picture, and an emoji picker. Messages someone sends within 5 minutes of each other share one name and picture (hover over one to see its time). Hide the chat with the chat button at the top right of the room; while it's hidden, that button counts the new messages. Messages are kept only while the room exists.
- **People** are listed under the room you're in, in the rooms column: who hosts it, who is **Live** (or **Paused**), and who is reconnecting. While you share, the people watching you show how it's going under their name (*watching you · 60 fps · 20 ms*, or *not looking*).

If your network drops for a moment, the app reconnects on its own and puts you back in your seat without asking for the PIN again, as long as you're back within 30 seconds. Streams you were watching reconnect automatically.

## If you are the host

The **ⓘ** at the left of the controls shows the room's details, the same for everyone: privacy, how long it has been open, who hosts it, the round trip to it, and the address people can use with **Join by IP** (click to copy it; point at it for all of yours).

The **cog** next to it opens the **room settings**, which only the host has:

- switch between **Public** and **Private** at any time; people already inside stay connected;
- show or hide the **PIN**, **copy** it, **generate a new one**, or **set your own**;
- **Allow drawing on streams** for everyone, or not;
- **Let viewers chat**: off, only you can write (people still see the history), and your chat says *Viewers can't chat*;
- **End room for everyone**.

Right-clicking a person (their tile, or their name in the rooms column, where a **⋯** button also appears on hover) lets you **stop their stream** or **remove** them from the room (they can't come back to this room session). In the chat you can **delete messages**.

**End room for everyone** (in the room settings, or the red button in the middle of the controls) closes the room for everyone.

## Settings

Open Settings with the gear icon at the bottom of the rooms column. The list on its left picks the section to show; each one groups its settings in boxes, with what each does under its name.

| Section | Setting | Default | Meaning |
|---|---|---|---|
| Profile | Profile picture | none | Shown instead of your initials. |
| Profile | Display name | your computer user name | Up to 32 characters. |
| Appearance | Language | Same as the computer | See [language](#language). |
| Appearance | Theme | Classic | The app's colours. Dark: **Classic** (blue on blue-grey), **Graphite** (neutral greys and indigo, so streams look true to colour), **Midnight** (blue-black and teal), **Charcoal** (warm greys and violet), **Black** (true black, for OLED screens), **Forest** (deep green and emerald) or **Ember** (warm browns and amber). Light: **Light** (white and blue), **Paper** (warm cream and terracotta) or **Mist** (cool grey-blue and teal); in these the room's stage stays dark, so streams and the controls over them read as usual. Applies immediately. |
| Appearance | Show FPS and latency on streams | on | The badges on each stream. |
| Sharing | Maximum quality | 1080p @ 60 fps | The most you send when sharing. Applies immediately. |
| Sharing | Optimize for | Automatic | *Smooth motion* keeps 60 fps. *Sharp text* keeps the resolution. *Automatic* (Windows) uses smooth motion while a fullscreen game or video is in front of what you share, and sharp text on the desktop; on macOS it means smooth motion. The Stats panel shows which one is in use. |
| Sharing | Upload limit when sharing | 100 Mbps | Your total upload, shared fairly between everyone watching you. Lower it on Wi-Fi or VPN. |
| Sharing | Share system audio by default | on | Pre-selects the audio switch. |
| Sharing | Only the shared app's sound by default | on | Windows only. Pre-selects **Only this app's sound** when you share a window. |
| Sharing | Leave out Discord by default | on | Windows and macOS. Pre-selects the Discord switch. |
| Sharing | Pause sharing while minimized | off | Resumes when you restore the window. |
| Sharing | Allow drawing on my screen | on | People watching can point at your stream and draw marks on it ([drawing on a stream](#drawing-on-a-stream)). |
| General | Chat notifications | on | When the window is in the background. |
| General | Rejoin last room on startup | off | Joins your last room automatically when the app starts. |
| General | Encrypt connections (TLS) | on | Encrypts chat and signaling. Video is always encrypted. |
| General | Always use TCP transport | off | For networks that block UDP. Adds some latency. |
| General | Hosting port | 47800 | The first port tried when you host. |
| Advanced | Video codec | Automatic | Automatic prefers H.264 when your graphics card encodes it, then H.265 when both graphics cards handle it; the line under it says what it usually sends on your computer. You can force H.264, H.265, VP9 or AV1 if both sides support it. **Codec support** below it shows which codecs your graphics card or processor handles. |
| Advanced | Adaptive quality | on | Lowers resolution/frame rate per viewer when their network struggles. |
| Advanced | Lowest latency (wired networks) | off | Shows the streams you watch as soon as each frame arrives: about 20 ms less delay on a wired network, but they can stutter on Wi-Fi or a VPN. Applies after restarting ScreenShare (**Restart needed**). |
| About | Check for updates automatically | on | See [updates](#updates). |

**About** shows the app version and your system, the update status with **Check now**, and **Troubleshooting**: **Copy diagnostics** copies what a bug report needs (versions, system, graphics and codecs, network addresses, your settings and the end of the log, never PINs or tokens), **Save to file…** saves it to a file and **Open logs** opens the folder with the logs. See [collecting information for a bug report](troubleshooting.md#collecting-information-for-a-bug-report).

## Language

The app speaks **English** and **Portuguese (Brazil)**. In **Settings → Appearance → Language**:

- **Same as the computer** (the default) follows Windows or macOS: Portuguese on a computer set to Portuguese (any country), English otherwise.
- **English** or **Português (Brasil)** keeps that language whatever the computer's is.

It changes at once, without a restart. Everyone sees the room in their own language: the room's lines in the chat ("Bob joined", "The host muted the chat") are in English for you and in Portuguese for someone using the app in Portuguese. In a room hosted by an app before 2.4.0 they arrive in English. A new room's default name follows the language of whoever creates it ("Giu's room").

## Updates

The app looks for a new version on the [releases page](https://github.com/nsfxu/lan-screenshare/releases) shortly after it starts and every few hours.

- **Windows**: a new version downloads quietly in the background. When it's ready, a green **Restart to update** button appears in the title bar (and in **Settings → About**). Click it when it suits you: the app closes, installs the update and opens again. If you're in a room it asks first, because restarting leaves the room (or ends it, if you host). Nothing installs by itself when you close the app.
- **macOS**: the title bar shows **Update to …**, which opens the download page. Apple only lets signed apps replace themselves, and ScreenShare isn't signed yet.

**Settings → About** shows where things are and has **Check now**. Turn off **Check for updates automatically** if you don't want the app to contact GitHub; you can still check by hand. Versions before 2.2.0 don't update themselves: download 2.2.0 once, and later versions come by themselves.

## Mouse and keyboard

| Where | Action | Result |
|---|---|---|
| A tile | Click | Focus it / back to the grid |
| A stream | Double-click | Full screen |
| A tile | Right-click | Its menu (volume, quality, …) |
| A focused stream | Esc | Leave full screen, then back to the grid |
| Full screen | Move the mouse | Show the strip and controls again |
| Picture crop | Drag / wheel / slider | Move / zoom |
| Picture crop | Arrow keys, Shift + arrows, + and − | Move a little, move more, zoom |
| Any dialog | Esc | Close the top dialog |

## Privacy

- Everything stays on your network. There are no accounts, no cloud and no tracking. The one thing the app does on the internet is check GitHub for updates, which sends nothing about you beyond what any download does, and can be turned off.
- The PIN exists only in the host's memory and is never saved.
- The app has no recording and no chat export. While you watch a stream, your ScreenShare window is hidden from screenshots and screen recorders on your computer.
- Chat, previews and profile pictures disappear when the room ends.

## Where your files are

| What | Windows | macOS |
|---|---|---|
| Settings (`settings.json`) and host identity (`host-identity.json`) | `%APPDATA%\ScreenShare\` | `~/Library/Application Support/ScreenShare/` |
| Logs (`screenshare.log`) | `%APPDATA%\ScreenShare\logs\` | `~/Library/Logs/ScreenShare/` |

**Settings → About → Open logs** opens the log folder. Logs rotate at 5 MB (the previous one is kept as `screenshare.old.log`). Deleting `host-identity.json` gives your computer a new certificate the next time you host; people who connected before may need to rediscover your room.

Something not working? See [troubleshooting](troubleshooting.md).
