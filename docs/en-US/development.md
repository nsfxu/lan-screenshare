# Development guide

How to set up the project, run it, debug it and build installers.

> **Language:** English · [Português (Brasil)](../pt-BR/development.md)

## Contents

- [Requirements](#requirements)
- [First run](#first-run)
- [Scripts](#scripts)
- [Running several people on one computer](#running-several-people-on-one-computer)
- [How the build works](#how-the-build-works)
- [Debugging](#debugging)
- [Building installers](#building-installers)
- [Versions and the changelog](#versions-and-the-changelog)
- [Releasing](#releasing)
- [Tech stack](#tech-stack)

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20.19+ or 22.12+ | Required by Vite 7 / electron-vite 5. |
| npm | comes with Node | The repo uses `package-lock.json`. |
| Git | any recent | |
| Windows | 10 or 11 | Nothing else. The audio helper is compiled with the C# compiler that ships with Windows (.NET Framework 4). |
| macOS | 13+ recommended | Needed to build the `.dmg`. System audio needs macOS 13+. |
| Linux | optional | The app runs for development (screen capture works on X11), but Linux is not a supported target. |

## First run

```bash
git clone https://github.com/nsfxu/lan-screenshare.git
cd lan-screenshare
npm install
npm run dev
```

`npm run dev` starts electron-vite with hot reload for the renderer: UI changes show up immediately. After changing `src/main` or `src/preload`, stop it and run `npm run dev` again, or start it with `npx electron-vite dev --watch` to rebuild and restart automatically.

Before sending a change, run:

```bash
npm run typecheck
npm test
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development mode with hot reload (builds the Windows audio helper first). |
| `npm run build` | Production build of main, preload and renderer into `out/` (builds the helper first). |
| `npm start` | Runs the production build (`electron-vite preview`). |
| `npm test` | Runs all unit and integration tests once (vitest). |
| `npm run test:watch` | Tests in watch mode. |
| `npm run test:e2e` | Builds, then runs the end-to-end tests: two real app instances in a room (see [testing](testing.md#end-to-end-tests)). |
| `npm run typecheck` | TypeScript checks for the Node side (`tsconfig.node.json`, includes `tests/`) and the web side (`tsconfig.web.json`). |
| `npm run build:native` | Builds the Windows helpers into `native/bin/` (`win-audio-capture.exe`, `win-cursor-watch.exe`); no-op on other systems or when up to date. |
| `npm run dist:win` | Build + Windows installer (NSIS, x64 and arm64) into `release/<version>/`. |
| `npm run dist:mac` | Build + macOS disk images (Intel and Apple Silicon) into `release/<version>/`. Must run on a Mac. |
| `npm run dist` | Build + installer for the current platform. |
| `npm run release -- <major\|minor\|patch>` | Prepares a release: version, changelog section and notes draft (see [releasing](#releasing)). Add `--dry-run` to preview. |

## Running several people on one computer

Each instance needs its own settings and identity. Use `--profile=<name>` with a production build:

```bash
npm run build
npx electron . --profile=alice
npx electron . --profile=bob
```

`--profile=alice` stores everything in a separate user data folder (`ScreenShare-alice`). One instance creates a room; the other finds it in the list (mDNS on the same machine), or you can use **Join by IP** with `127.0.0.1:47800`.

To keep them off the screen you're using, add `--display=<n>` (the screen, numbered like the source picker: "Screen 3") and `--tile=<i>/<count>` (side-by-side slots on it). A window placed this way opens without taking focus:

```bash
npx electron . --profile=alice --display=3 --tile=1/2
npx electron . --profile=bob --display=3 --tile=2/2
```

On Linux, `--no-sandbox` is needed when running as root, for example inside a container.

## How the build works

```mermaid
flowchart LR
  subgraph Sources
    M["src/main/*.ts"]
    P["src/preload/index.ts"]
    R["src/renderer (React + TS)"]
    S["src/shared, src/utils"]
    C["native/*/Program.cs"]
  end
  EV["electron-vite<br/>(Vite + esbuild/rollup)"]
  CSC["scripts/build-native.cjs<br/>csc.exe from .NET Framework 4"]
  OUT["out/main, out/preload, out/renderer"]
  EXE["native/bin/*.exe"]
  EB["electron-builder"]
  REL["release/version/<br/>.exe installer or .dmg"]
  M --> EV
  P --> EV
  R --> EV
  S --> EV
  EV --> OUT
  C --> CSC --> EXE
  OUT --> EB
  EXE -->|"extraResources (Windows)"| EB
  EB --> REL
```

- `electron.vite.config.ts` defines three builds: main, preload and renderer (React plugin).
- Each helper is rebuilt only when its `Program.cs` is newer than its `.exe`. If another instance of the app is running a helper, its locked `.exe` is renamed aside (Windows allows that) and deleted by a later build. `native/bin/` is git-ignored.
- `electron-builder.json` packages `out/**` into an `asar`, adds the helpers as extra resources on Windows, and sets the macOS entitlements and usage descriptions (Screen Recording, Local Network, Bonjour service `_lanshare._tcp`).

### Working on the audio helper without Windows

The helper uses Windows APIs, so it only runs on Windows. You can still check that it **compiles** as C# 5 (the language level of the compiler that ships with Windows) with Mono:

```bash
mcs -langversion:5 -warn:4 -target:exe -out:/tmp/win-audio-capture.exe native/win-audio-capture/Program.cs
mcs -langversion:5 -warn:4 -target:exe -out:/tmp/win-cursor-watch.exe native/win-cursor-watch/Program.cs
```

Keep to C# 5: no string interpolation (`$"..."`), no `?.`, no `nameof`, no expression-bodied members, no `out var`.

## Debugging

- **DevTools**: press **Alt** to show the menu, then *View → Toggle Developer Tools*, or press **Ctrl+Shift+I** (**Cmd+Option+I** on macOS).
- **Logs**: the main process writes to `screenshare.log` (see [where your files are](user-guide.md#where-your-files-are)). In development it also prints to the terminal. Renderer code logs through `window.api.system.log(...)`, which shows up in the same file with a `[renderer]` prefix. Useful prefixes:
  - `[publisher]`: capture, audio, connections to watchers, quality changes;
  - `[watch <id>]`: one watched stream (transport, fallback, quality choice);
  - `[win-audio]`: the Windows audio helper (which process is left out, errors).
- **Settings → Open logs** opens the folder.
- **Stats**: the **Stats** button (streamer) and the badges on each tile (watcher) show fps, bitrate, codec, encoder, RTT and what limits quality.
- **`chrome://webrtc-internals`** isn't reachable from the app window, but WebRTC stats are visible in DevTools through `RTCPeerConnection.getStats()`.

## Building installers

**Windows** (on Windows):

```bash
npm run dist:win
```

This produces `release/<version>/ScreenShare-Setup-<version>-<arch>.exe`: an NSIS installer that lets the user pick the folder and creates a desktop shortcut.

**macOS** (on a Mac):

```bash
npm run dist:mac
```

This produces two disk images: `ScreenShare-<version>-arm64.dmg` for Apple Silicon and `ScreenShare-<version>-x64.dmg` for Intel Macs. Distributing it to other Macs needs an Apple Developer ID certificate for signing and notarisation; see electron-builder's documentation. The macOS build hasn't been tested yet.

## Versions and the changelog

ScreenShare follows [Semantic Versioning](https://semver.org/), where "breaking" means *can't share a room*:

| Bump | When | Example |
|---|---|---|
| **Major** | `PROTOCOL_VERSION` changed (older apps can't join the new rooms, so everyone must update), or a big redesign that keeps the protocol (2.0.0: the new layout). The notes say which. | 1.4.2 → 2.0.0 |
| **Minor** | New features that still work with other apps of the same major version | 1.0.0 → 1.1.0 |
| **Patch** | Fixes only | 1.1.0 → 1.1.1 |

[`CHANGELOG.md`](../../CHANGELOG.md) (English, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format) lists every user-visible change. **Each pull request adds its line under `## [Unreleased]`**, in the right group (`### Added`, `### Changed`, `### Fixed`, `### Removed`), written for the people using the app: *"Viewers no longer see your cursor over fullscreen games that hide it"*, not *"Add GameCursorGuard"*. Internal changes (refactors, tests, docs) don't need a line.

Don't edit `version` in `package.json` by hand; `npm run release` does it.

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`) on GitHub's own Windows and macOS machines, so you don't need both systems.

```mermaid
flowchart LR
  S["Actions → Release → Run workflow<br/>version v1.2.0<br/>(or push the tag)"] --> C["Typecheck + tests<br/>version = package.json?"]
  C --> W["Windows installers<br/>windows-latest"]
  C --> M["macOS .dmg<br/>macos-latest (may fail)"]
  W --> R["GitHub Release v1.2.0<br/>notes = docs/releases/v1.2.0.md"]
  M --> R
```

1. Prepare it with `npm run release -- minor` (or `major`, `patch`, or an exact version like `1.2.0`) on an up-to-date branch from `main`, with no uncommitted changes. It:
   - refuses if `[Unreleased]` in `CHANGELOG.md` is empty, or if `PROTOCOL_VERSION` changed since the last release and the bump isn't major;
   - moves the Unreleased entries into a dated `## [1.2.0]` section and updates the comparison links;
   - sets the version in `package.json` and `package-lock.json` (installer names use it);
   - drafts `docs/releases/v1.2.0.md`: download table, whether everyone must update, and the changelog entries. Replace its `TODO`s (a short intro and the Portuguese summary) and polish it for users.

   Commit (`Release v1.2.0`) and merge into `main` through a pull request.
2. Start the release in one of two ways:
   - On GitHub: **Actions → Release → Run workflow**, branch `main`, version `v1.2.0`. The workflow creates the tag itself.
   - Or push a tag from your computer: `git tag v1.2.0 && git push origin v1.2.0`. An annotated tag's message is used as the notes when there is no notes file.
3. The workflow checks that the version matches `package.json`, that `CHANGELOG.md` has its section and that the notes have no `TODO` left, runs the checks, builds the installers, and publishes the release with them attached, together with `latest.yml`: installed Windows apps read it to find the new version (the `publish` entry in `electron-builder.json` points them at this repository). The release fails without it. The macOS job may fail without blocking a Windows-only release.
4. When the protocol changed, the notes say that everyone in a room needs the new version (the drafted notes already do).

Running the workflow without a version is a dry run: it builds, lists what would be published, and keeps the installers as run artifacts.

Each system gets one installer per processor type: `-x64` (most Windows PCs, Intel Macs) and `-arm64` (Windows on ARM, Apple Silicon Macs).

To keep the installers small, they only include Chromium's English and Portuguese language files (`electronLanguages` in `electron-builder.json`). On a computer set to another language, Chromium's own text and the chat's time format fall back to US English. Add the language there if the app gets translated.

The installers are not code-signed yet: Windows shows a SmartScreen warning (*More info → Run anyway*) and macOS blocks the first launch (right-click the app → *Open*).

## Tech stack

| Area | Choice |
|---|---|
| Desktop shell | Electron 44 (Chromium + Node.js) |
| Build | electron-vite 5, Vite 7, TypeScript 5.9 (strict) |
| UI | React 19, plain CSS (`src/renderer/styles.css`) |
| Media | WebRTC, WebCodecs, MediaStreamTrackProcessor/Generator |
| Networking | `ws` (WebSocket server), Node `http`/`https` |
| Discovery | `bonjour-service` (pure-JS mDNS) |
| TLS identity | `selfsigned` (EC P-256 certificates) |
| Tests | vitest |
| Packaging | electron-builder (NSIS, DMG) |
| Windows audio helper | C# 5, .NET Framework 4, WASAPI via COM interop |

Next: [architecture](architecture.md) · [contributing](contributing.md) · [testing](testing.md)
