# AGENTS.md

Guidance for AI coding agents working on this repository. People are welcome to read it too. The full docs are in [`docs/`](docs/README.md), in English (`docs/en-US/`) and Brazilian Portuguese (`docs/pt-BR/`).

## What this project is

ScreenShare is an Electron + React + TypeScript desktop app for screen sharing on a LAN or VPN. The host's app runs a small room server (auth, chat, presence, WebRTC signaling relay); video goes directly from each streamer to each watcher over WebRTC, with a WebCodecs-over-WebSocket fallback. No internet services are used, by design, apart from checking the project's GitHub releases for updates (which can be turned off).

Read [`docs/en-US/architecture.md`](docs/en-US/architecture.md) before changing anything non-trivial.

## Commands

```bash
npm install
npm run dev          # run the app with hot reload
npm run typecheck    # must pass
npm test             # must pass (vitest, real servers on random ports)
npm run test:e2e     # must pass: two real app instances in a room (Playwright; Linux: under xvfb-run)
npm run build        # production build into out/
```

## Where things are

| Need | Look at |
|---|---|
| Wire protocol (all messages) | `src/shared/types.ts`, [`docs/en-US/protocol.md`](docs/en-US/protocol.md) |
| Limits, timings, protocol version | `src/shared/constants.ts` |
| Room server (auth, relay, moderation) | `src/main/server.ts` |
| Hosting, discovery, TLS identity | `src/main/roomManager.ts`, `src/utils/` |
| Updates (GitHub releases) | `src/main/updater.ts`, `publish` in `electron-builder.json`, `latest.yml` in `.github/workflows/release.yml` |
| IPC surface (`window.api`) | `src/shared/ipc.ts`, `src/preload/index.ts`, `registerIpc()` in `src/main/index.ts` |
| Sharing (capture, per-watcher connections, quality) | `src/renderer/lib/publisher.ts` |
| Watching | `src/renderer/lib/subscription.ts`, `src/renderer/lib/watches.ts` |
| TCP fallback | `src/renderer/lib/tcpStream.ts` |
| Quality maths (pure, tested) | `src/shared/quality.ts` |
| UI | `src/renderer/App.tsx` (three columns), `src/renderer/components/` (`RoomsSidebar`, `RoomMembers`, `RoomView`, `RoomStage`, `RoomInfo`, `ChatPanel`), `src/renderer/styles.css`, layout helpers in `src/renderer/lib/layout.ts` |
| Windows helpers (C#) | `native/win-audio-capture/Program.cs` (system audio), `native/win-cursor-watch/Program.cs` (games hiding the cursor) |
| Tests | `tests/` (`TestClient` in `tests/helpers.ts`) |

## Rules

1. **Stay LAN-only.** No accounts, cloud, telemetry, STUN/TURN or internet dependencies. The one exception is the update check (`src/main/updater.ts`): it only reads this project's GitHub releases, and Settings → About turns it off. Don't add other internet calls.
2. **The server enforces the rules.** Validate every new message field on the server (type, range, size, and whether this sender may send it). Relay signaling only inside an existing streamer↔watcher pair. Never loosen validation to make a client work.
3. **Protocol changes**: update `ClientMessage`/`ServerMessage`, handle them on both sides, add a server test, and bump `PROTOCOL_VERSION` if old and new apps can't interoperate. See [changing the protocol](docs/en-US/protocol.md#changing-the-protocol).
4. **Pure logic goes in `src/shared/`** (no DOM, no Node APIs) with unit tests. `tsconfig.node.json` type-checks `tests/` without DOM types, so tests there must not import DOM-using modules. Tests of renderer logic go in `tests/renderer/`, which is type-checked with the web config; stub `window.api` with `vi.stubGlobal`.
5. **The renderer is sandboxed.** It never imports Node modules; add IPC through `src/shared/ipc.ts` + preload + a handler that coerces its arguments.
6. **The Windows helpers must remain C# 5** (they are compiled with the `csc.exe` that ships with Windows). No `$"..."`, `?.`, `nameof`, expression-bodied members or `out var`. Check with `mcs -langversion:5` on non-Windows machines.
7. **Match the code style**: TypeScript strict, 2 spaces, single quotes, no semicolons, ~120 columns, comments that explain *why*.
8. **Docs are bilingual.** When behaviour changes, update the matching page in both `docs/en-US/` and `docs/pt-BR/` (same file names). Keep the root READMEs short.
9. **Keep changes scoped** to the task: don't bump the protocol, change defaults, or reformat unrelated files unless asked.
10. **Never write secrets** (PINs, host tokens, resume tokens) to disk or logs.
11. **User-visible changes get a line in `CHANGELOG.md`** under `## [Unreleased]`, written for users, in the same change. Never edit the version in `package.json` by hand: releases are prepared with `npm run release` (see [versions](docs/en-US/development.md#versions-and-the-changelog)).

## Verifying your work

- Always run `npm run typecheck` and `npm test`, and `npm run test:e2e` for anything that touches the app (CI runs all three on every push). New user flows get an end-to-end test (`e2e/`, see [testing](docs/en-US/testing.md#end-to-end-tests)).
- For UI or media changes, drive the real app headlessly with Playwright's Electron support under Xvfb, and look at the result (screenshots, `.stat-badge` values, computed styles). A tested example script and tips (fake capture source, two instances with `--profile`, Xvfb flags) are in [`docs/en-US/testing.md`](docs/en-US/testing.md#driving-the-real-app).
- Running Electron as root (containers) needs `--no-sandbox`.
- You can't run Windows-only features (the audio helper, Discord exclusion) or macOS permissions on Linux. Say clearly what you verified and what still needs a real machine.

## Gotchas

- `out/`, `release/` and `native/bin/` are build outputs and are git-ignored.
- `npm install` runs Electron's post-install download; with `--ignore-scripts`, run `node node_modules/electron/install.js` before launching Electron.
- The host's own renderer connects to its server over `wss://127.0.0.1` with a host token; it is also a normal participant.
- Your own stream is intentionally not rendered until the user clicks **Show**.
- Per-stream volume and watch quality live in the renderer's `localStorage`, keyed by the streamer's name.

## Commits

Imperative subject (*Add…*, *Fix…*), blank line, then what changed and why, then how it was verified. One logical change per commit.
