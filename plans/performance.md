# Performance plan

A plan for the performance work on ScreenShare, written for an AI agent (or a person) picking it up without other context. Read [`AGENTS.md`](../AGENTS.md) and [`docs/en-US/architecture.md`](../docs/en-US/architecture.md) and [`docs/en-US/media-pipeline.md`](../docs/en-US/media-pipeline.md) first.

**The split of work.** Most of this needs real Windows gaming PCs, real graphics cards and real networks, which a cloud machine doesn't have (Linux, no GPU: no hardware encoders, and timings mean little). So:

- **You (the agent)** build the measuring tools, the switches and the fixes, and verify them as far as a Linux machine allows (unit tests, end-to-end tests under Xvfb, software encoders).
- **The owner** runs the measurements on their PCs with one command per test, and sends back the results folder.
- **You** read the results, write them into the docs, and finish or drop the feature.

Every task below says which part is whose, what to build, how to verify it, and when it's done.

---

## Ground rules

- **One task, one branch, one pull request**, in the order below. Don't start a task that depends on measurements that haven't come back.
- **No protocol change.** `PROTOCOL_VERSION` stays 4: every task here is designed to work with existing 2.x apps in the same room. If you find you need a protocol change, stop and say so in the PR instead.
- **No new internet access** (AGENTS.md rule 1).
- **Experiments ship off by default**, behind a command-line switch or a setting, and only become the default when the owner's measurements say so.
- **Measuring code changes nothing unless its switch is given.**
- **Pure logic goes in `src/shared/`** with unit tests (AGENTS.md rule 4).
- **Every pull request** passes `npm run typecheck`, `npm test` and `npm run test:e2e` (under `xvfb-run` on Linux). User-visible changes get a `CHANGELOG.md` line under `[Unreleased]` and docs in **both** `docs/en-US/` and `docs/pt-BR/`. Developer-only tools get a section in `docs/*/testing.md`.
- **Commits** follow AGENTS.md: imperative subject, what and why, how it was verified.

## What the code already does

So you don't build it twice:

| Fact | Where |
|---|---|
| Each watcher has its own `RTCPeerConnection`, so the streamer runs one encoder (one hardware encoder session) per watcher. | `src/renderer/lib/publisher.ts` |
| The streamer collects per-watcher stats every second: fps, resolution, bitrate, RTT, encode time, `encoderImplementation`, `qualityLimitationReason`. | `Publisher.collectStats` and the per-watcher sampling in `publisher.ts` |
| The watcher collects fps, resolution, a latency **estimate** (capture + encode + RTT/2 + jitter buffer + decode) and jitter buffer delay. | `src/renderer/lib/subscription.ts` (stats sampling, around "Glass-to-glass estimate") |
| **Watchers already ask for the smallest jitter buffer** (`receiver.jitterBufferTarget = 0` in `handleOffer`). | `subscription.ts` |
| The TCP fallback already encodes with `latencyMode: 'realtime'` and decodes with `optimizeForLatency: true`; one WebCodecs encoder serves all TCP watchers of a streamer. | `src/renderer/lib/tcpStream.ts` |
| **Hidden watchers on WebRTC already get no video**: their encoding is set to `active: false` (`isHiddenView` in `Publisher.rebalance`). TCP watchers still get the `HIDDEN_VIEW` picture (90 px, 1 fps). | `publisher.ts`, `src/shared/quality.ts` |
| A streamer whose watchers got a mix of hardware and software encoders is told so (`encoders` in `StruggleDetector`). | `src/shared/struggle.ts` |
| The server relays `view-size` (height 90–8640 px or null, fps 1–240) to the streamer as `watcher-view`. | `src/main/server.ts`, `case 'view-size'` |
| **The server relays `signal` data untouched** between a streamer and its watchers: a new `data.kind` needs no server change. Check how `subscription.ts` and `publisher.ts` treat unknown kinds before relying on it. | `server.ts`, `case 'signal'` |
| **Quality presets are local to the streamer**: `StreamInfo` carries no preset id. | `src/shared/types.ts`, `src/shared/quality.ts` |
| Chromium features are switched on at start-up. | `enabledFeatures` in `src/main/index.ts` |
| Electron 44.4.5. | `package.json` |
| Test-only command-line switches already exist (`--profile`, `--display`, `--tile`), and the end-to-end fixtures show how to drive several app instances with Playwright and a fake canvas capture. | `src/main/index.ts`, `src/main/windowPlacement.ts`, `e2e/fixtures.ts` |

---

## Task 0: the measuring tool (do this first)

Everything else depends on it.

**Goal.** One command the owner runs on Windows that starts a streamer and N viewers, lets them run, and writes a results folder with raw samples and a readable summary.

**Build:**

1. **`--perf-log=<file>` switch.** When present, the renderer sends one sample per second over a new IPC channel, and the main process appends it as a JSON line to the file. Nothing is collected without the switch.
   - Streamer side, per watcher: id, transport, `encoderImplementation`, whether it's hardware, fps, width × height, bitrate, encode time, `qualityLimitationReason`, RTT.
   - Streamer side, overall: the app's and the computer's CPU and memory (they're already in `SystemStats`).
   - Watcher side, per stream: transport, fps, width × height, the latency estimate, jitter buffer delay (as a per-second delta, not the cumulative value), and new: `freezeCount`, `totalFreezesDuration`, `framesDropped` and `decoderImplementation` from `inbound-rtp`.
2. **`--perf-view-height=<px>` switch.** Watchers report this height instead of measuring their tile, so a dozen small windows on one PC still ask for 1080p.
3. **`npm run perf` script** (`scripts/perf/run.cjs`, Node + Playwright `_electron`, reusing the ideas in `e2e/fixtures.ts`):
   - `--viewers=<n>`: start one streamer and n viewers, each with its own `--profile`; every viewer watches the streamer.
   - `--seconds=<s>` (default 60), after a 15 s warm-up.
   - `--source=screen|fake`: share the real first screen (default on Windows), or the animated canvas from the e2e tests.
   - `--quality=<preset id>`, `--view-height=<px>`.
   - `--join=<address:port>`: start only viewers, joining a room hosted on another computer (for two-PC and ZeroTier tests). `--host-only`: only the streamer.
   - Extra switches pass through to every instance (for Tasks 3 and 5).
   - Writes `perf-results/<date-time>/`: one JSONL per instance, `summary.md`, and `run.json` (the command, app version, OS, CPU and GPU names).
4. **The summary is computed by pure functions** in `src/shared/perfSummary.ts`, with unit tests: percentiles (p5, p50, p95), per-watcher grouping, freeze totals, and how many watchers got a hardware encoder. The table has one row per watcher: encoder, fps p50/p5, latency p50/p95, freezes; plus the streamer's CPU p50/p95.
5. `perf-results/` goes in `.gitignore`.

**Verify (cloud):** unit tests for `perfSummary.ts`. Run `npm run perf -- --viewers=2 --seconds=10 --source=fake` under Xvfb and put the resulting `summary.md` in the PR description. Software encoders are expected there.

**Docs:** a "Measuring performance" section in `docs/*/testing.md` (both languages), with the commands for each test below.

**Done when** the owner can run `npm run perf -- --viewers=4` on Windows and get a summary without editing anything.

---

## Task 1: how many viewers before hardware encoding runs out (owner measures)

**Why.** Each viewer costs the streamer one hardware encoder session. Consumer graphics cards cap the number of sessions at once (NVIDIA drivers have had a limit; Intel and AMD have their own), and past it a viewer silently gets a software encoder: slower, hotter, lower fps. 8 viewers at 1080p60 were measured working on an NVIDIA card. Nobody knows where it breaks.

**Agent:** prepare the exact commands in the PR description and in `docs/*/testing.md`. Note that viewers on the same PC also use the graphics card to decode, so the clean version puts viewers on a second PC with `--join`.

**Owner runs**, on each PC available (NVIDIA; Intel integrated or AMD if possible), 1080p60, real screen:
```
npm run perf -- --viewers=4 --view-height=1080 --seconds=90
npm run perf -- --viewers=6 --view-height=1080 --seconds=90
npm run perf -- --viewers=8 --view-height=1080 --seconds=90
npm run perf -- --viewers=9 --view-height=1080 --seconds=90
```
9 is the most there can be: a room holds `MAX_USERS` = 10 people (`src/shared/constants.ts`), the streamer included. Past 9 the question is moot for one streamer, unless the room limit changes.
and sends the `perf-results` folders back.

**Agent finishes:**
- Write the numbers into the "Measured results" of `docs/*/media-pipeline.md` (both languages): per GPU, the viewer count where software encoding starts, and the streamer's fps, CPU and latency at each step.
- Choose the trigger for Task 4 from them.

---

## Task 2: latency, measure and tune

**Why.** Watchers already ask for the smallest jitter buffer, which is right on a wired LAN. On Wi-Fi or ZeroTier a buffer that small may cause freezes. Nobody has measured either.

**Build:**

1. **Check that the setting works** in Electron 44: with `jitterBufferTarget = 0`, the jitter buffer delay from `getStats` (`jitterBufferDelay` / `jitterBufferEmittedCount`, and `jitterBufferTargetDelay` if reported) should be low. If it isn't honoured, try Chromium's `playoutDelayHint` and record what worked.
2. **`--perf-clock` mode for the fake source** (optional, but it makes the estimate trustworthy). The fake canvas draws the sender's `performance.timeOrigin + performance.now()`, and the viewer reads it back with `requestVideoFrameCallback` and compares it with its own clock. That only works with both on the same computer, which is how the script runs. It gives a real glass-to-glass number to check the estimate against, and that can be measured in the cloud too.
3. **A "Smoother playback" option, only if the measurements show freezes.** It goes in the stream's right-click menu ("adds a little delay"), sets `jitterBufferTarget` to around 100–150 ms (pick from the data), and is remembered per streamer in `localStorage`, like the volume (`src/renderer/lib/volume.ts`). The default stays at 0 unless the data says otherwise.

**Owner runs** two PCs (one hosts with `--host-only`, the other runs `--join=<address> --viewers=1`), 60 s each, on: wired LAN, Wi-Fi, and ZeroTier (check `zerotier-cli peers` says DIRECT). Then the same with the smoother option on, if it was built.

**Done when:**
- The results (latency p50/p95, freezes per minute, per network) are in `docs/*/media-pipeline.md`.
- Either "Smoother playback" ships with a CHANGELOG line and user-guide text, or the docs record that it wasn't needed.

---

## Task 3: faster capture path (experiment)

**Why.** Chromium has had features that keep captured frames on the GPU through to the encoder (zero-copy), which could lower CPU use and encode time.

**Build:**

1. **First find out what exists.** Look up Electron 44's Chromium version, then search that Chromium's source for the relevant feature names (zero-copy desktop capture, WGC capture using textures, and similar). Write down the exact names, their default state, and which platforms they affect. **Don't trust feature names from memory or old notes, including the ones in this plan.**
2. **`--capture-experiment` switch.** It adds those features to `enabledFeatures` in `src/main/index.ts`. It has to run before `app` is ready, as the other switches there do. With `npm run perf`, it's passed through to every instance.

**Owner runs:**
- **Measurements:** `npm run perf -- --viewers=2 --seconds=90` with and without `--capture-experiment`, sharing a **screen** and then a **game window** (the script needs a `--source=window:<title>` option for that; add it). Compare the streamer's CPU, encode time, fps and latency.
- **Stability checklist with the switch on**, each step watched from another PC: alt-tab in and out of a game; a game in exclusive fullscreen; resetting the graphics driver (Win+Ctrl+Shift+B); the screen going to sleep and waking; Change source mid-share; a 30-minute share.

**Done when:**
- If it clearly helps and passes the checklist: it becomes the default, with a setting to turn it off ("Settings → Advanced"), plus a CHANGELOG line and docs.
- Otherwise: the switch stays as a developer-only option, and the docs record what was measured.

---

## Task 4: what to do when hardware encoders run out (after Task 1)

**Why.** Past the limit found in Task 1, each extra viewer is encoded by the CPU, which can drag the streamer's game and every other viewer down.

**Design**, within protocol 4:
- **The trigger.** A watcher's connection reports a software encoder while the streamer's other watchers have hardware ones. This is the same signal as the `encoders` struggle kind, and Task 1 may refine it.
- **The fix.** Move that watcher to the **TCP path**. One WebCodecs encoder, hardware if available, serves every TCP watcher, so extra viewers cost no extra encoder sessions.
- **The mechanism.** The streamer sends `signal` data `{ kind: 'use-tcp' }` to the watcher; the server relays it untouched. A watcher that knows the kind switches with the existing TCP path (see `Subscription.retry`). An older watcher ignores unknown kinds, so the streamer then closes that `RTCPeerConnection`, and the existing fallback moves the watcher to TCP. **Verify both paths**, and verify that older apps really ignore the unknown kind.
- **Telling the streamer.** Reuse the struggle notice: "Your graphics card ran out of video encoders: N viewers get your stream through the slower TCP connection."
- **No flapping.** A moved watcher stays on TCP until they stop and start watching again.

**Verify:**
- Unit tests for the decision logic, in `src/shared/`.
- An end-to-end test with a faked `encoderImplementation`: `e2e/struggle.spec.ts` shows how to fake `getStats`. It checks that the watcher ends up on TCP (its stats badge says TCP) and that the notice appears.
- A server test is only needed if the server changes; the design avoids it.
- **The owner then reruns the Task 1 command above the limit**, and every viewer should keep a usable fps.

**Done when** it ships with a CHANGELOG line and media-pipeline docs (both languages).

---

## Task 5: 120/144 fps on wired networks (experiment)

**Why.** High-refresh games look smoother. Whether capture, hardware encoders and viewers keep up is unknown.

**Build:**
- **A preset `1080p120`**, available only with `--perf-high-fps` at first: capture constraints `frameRate: 120` and a matching `maxFramerate` and bitrate.
- **Review `src/shared/quality.ts` first**: the presets, the adaptive controller, `limitPreset`, `splitBudget` and the watch-quality fps caps may assume a 60 fps maximum. Add unit tests for a 120 fps preset.
- **What the server allows**: `view-size` fps up to 240, so no server change is needed.
- **Extra measurements to report:** the capture's real frame rate (track settings and frames sent per second), and the viewer's displayed frame rate (counted with `requestVideoFrameCallback`).

**Owner runs** `npm run perf -- --viewers=1 --quality=1080p120 --perf-high-fps` with a 120/144 Hz game on a wired LAN, viewer on a second PC with a high-refresh monitor.

**Done when:**
- If it holds 110+ fps end to end, the "1080p @ 120 fps" preset ships, marked "best on a wired network", with a CHANGELOG line and docs.
- Otherwise: the docs record why not.

---

## Task 6: no video for hidden viewers on the TCP path (anytime, no hardware needed)

**Why.** On WebRTC, a watcher who can't see a stream (minimized, or the stream is in a strip they put away) already gets no video. On the TCP path they still get the 90 px / 1 fps picture, and the host still relays it. This replaces the old roadmap item "Full video pause for hidden viewers (3.0.0)": the WebRTC half was done in 1.2.0, and the TCP half needs no protocol change.

**Build:**
- **Streamer**: when **every** TCP watcher is hidden, stop feeding the TCP encoder; when one becomes visible again, resume with a keyframe.
- **Server**: when only **some** TCP watchers are hidden, don't relay video to them. The server already sees each watcher's `view-size`. Audio keeps flowing, and a watcher who becomes visible again gets a keyframe (`requestKeyframe`). This is a server change, but not a protocol change: older apps in the room behave exactly as before.

**Verify:**
- A server test in `tests/streams.test.ts`: a hidden TCP watcher gets no video packets but keeps audio, and gets a keyframe when it becomes visible again.
- Unit tests for any new logic.
- Extend `e2e/hidden.spec.ts` with a TCP watcher (the `forceTcp` setting).

**Done when** it ships with a CHANGELOG line and an update to "Streams nobody can see get no video" in `docs/*/media-pipeline.md` (both languages).

---

## Order

```text
Task 0 (tool) ──► Task 1 (encoder limit, owner) ──► Task 4 (fix)
            ├──► Task 2 (latency, owner)
            ├──► Task 3 (capture experiment, owner)
            └──► Task 5 (high fps, owner)
Task 6 (TCP pause): any time, independent
```

The owner can run Tasks 1, 2 and 3 in one session once Task 0 is merged. Release whatever is finished as a 2.x minor (`npm run release -- minor`); installed Windows apps update themselves.

## Sending results back

For each measurement, the owner runs the command given in the PR or in `docs/*/testing.md`, then attaches the `perf-results/<date-time>/` folder (or at least its `summary.md` and `run.json`) to the pull request. The agent reads it, updates the docs and makes the call the task describes.
