# Security

What ScreenShare protects against, how, and where the limits are. If you change anything that touches authentication, the server, IPC or Electron settings, read this page first.

> **Language:** English · [Português (Brasil)](../pt-BR/security.md)

## Threat model

ScreenShare runs on a local network or VPN that people mostly trust, such as an office, a home or a team VPN. It still assumes that:

- someone on the network may try to **join a private room** without the PIN, or guess it;
- someone may try to **pretend to be the host** or another participant;
- someone may **listen** on the network;
- a participant may send **malformed or oversized data**, or try to use the server to reach people they shouldn't;
- a viewer may try to **record** what they watch.

It does **not** try to protect against a malicious host (the host runs the server and sees all signaling and chat), or against someone with control of a participant's computer.

## Controls at a glance

| Risk | Control | Where |
|---|---|---|
| Joining a private room without the PIN | 4–6 digit PIN from a CSPRNG, compared in constant time | `src/utils/crypto.ts`, `RoomServer.handleHello` |
| Guessing the PIN | 3 wrong PINs lock that address out for 5 minutes | `PinGuard` |
| PIN leaking later | Kept in memory only, never written to disk. The host can regenerate it or set a new one mid-session; people already inside stay connected | `RoomManager`, `RoomServer.update` |
| Impersonating the host | The host's own client proves itself with a random per-room token (constant-time compare) | `hostToken` in `hello` |
| Listening on the network | WebSocket over TLS (default on); WebRTC media is always DTLS-SRTP | `RoomManager.loadCertificate`, WebRTC |
| Fake room / man in the middle | Self-signed certificate **pinned** by SHA-256 fingerprint (from mDNS or the first probe) | `setCertificateVerifyProc` in `src/main/index.ts`, `RoomManager.isTrustedCertificate` |
| Abusing the relay | Signaling is relayed only inside an existing streamer↔watcher pair, and only for that streamer's connection. Only people who share can send media or previews | `RoomServer.handleMessage` (`signal`), `relayMedia` |
| Host-only actions from others | Kick, stop stream, delete message, mute chat and end room are checked on the server | `RoomServer.handleMessage` |
| Rejoining after a kick | The kicked client id is banned for the rest of that room session | `banned` set |
| Oversized or malformed input | Names sanitized and capped; chat length and rate limits; images must match strict data-URL patterns and size caps; view sizes and fps range-checked; 16 MB max message; 10 s to say hello | `server.ts`, `shared/images.ts` |
| Joining a VPN room without an invite | The invite holds a random secret (24 bytes), compared in constant time; 3 wrong secrets lock that address for 5 minutes; enrolment runs over TLS pinned to the fingerprint in the invite, so the secret only reaches the host that made it | `VpnHost.enrollNow`, `postJson` |
| Misusing the administrator step | Only the bundled helper runs with administrator rights, after its files are checked against build-time checksums; its inputs are validated strictly and it carries no secret | `native/ssvpn/`, `src/main/vpn/helper.ts`, `elevate.ts` |
| Leaking a VPN key | WireGuard keys are made in memory and sent to the VPN helper over its control socket (hex, never in argv, a file or the log); the host's key and the secret exist only while the room is open | `src/utils/wireguard.ts`, `SystemTunnel` |
| A guest taking another's address or key | One address per client id, a key can't be reused by another client, the host's own key is refused; the host's tunnel only accepts a guest's packets from the address it was given (`AllowedIPs` = `/32`) | `VpnHost` |
| Recording what you watch | While you watch any stream, the window is hidden from screen capture and screenshots (`setContentProtection`). The app has no recording or chat export | `RoomView.tsx`, `setViewerProtection` IPC |

## Certificate pinning

Each host generates one self-signed EC P-256 certificate and keeps it for two years in `host-identity.json`, so its fingerprint stays the same across rooms. No certificate authority is involved; trust comes from the fingerprint.

```mermaid
sequenceDiagram
  participant H as Host
  participant V as Viewer main process
  participant C as Viewer Chromium (WebSocket)
  H-->>V: mDNS TXT fp = SHA-256 of the certificate
  V->>V: remember fp for this host address
  V->>H: GET /info over TLS
  V->>V: presented certificate must match the advertised fp
  Note over V: Join by IP: no advert, so the fp seen on the first probe is remembered
  C->>H: wss:// connection
  C->>V: certificate check (setCertificateVerifyProc)
  V-->>C: accept only if the fingerprint is trusted for that host
```

Any certificate that is not trusted for that exact host name is rejected, even if the system would otherwise accept it.

**Trade-off:** with **Join by IP**, the first probe is *trust on first use*. Someone who can intercept that very first connection could present their own certificate. Rooms found over mDNS don't have this gap because the fingerprint arrives in the advert.

## Electron hardening

Set in `src/main/index.ts`:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. The renderer only sees the typed `window.api` from the preload script.
- `window.open` is denied and navigation away from the app page is blocked.
- Permissions: only `media`, `display-capture`, `notifications`, `fullscreen` and `clipboard-sanitized-write` are granted.
- IPC handlers coerce their arguments (`String(...)`, `Number(...)`, booleans) and never run arbitrary code.
- The Windows audio helper receives only fixed arguments (the Discord process names and a numeric PID).

## Known limitations

Be honest about these in reviews and issues:

- **Client ids are self-reported.** The kick ban is by client id, so a determined user can rejoin by changing their id (for example with a new `--profile`). The PIN still applies to private rooms. Changing the PIN after a kick locks them out.
- **The PIN lockout is per IP address.** Several machines behind one address share a counter, and an attacker with many addresses gets 3 tries per address.
- **The host is trusted.** It relays signaling and chat, so it could read or alter them. Media on the WebRTC path flows directly between streamer and watcher and is encrypted, but the host relays the signaling that sets up that encryption, so a malicious host could interfere with it. On the TCP fallback, media passes through the host, readable by it (the TLS WebSocket only protects it on the network).
- **A VPN invite is a bearer secret.** Anyone who has it can join the VPN until the room ends, so send it only to the people you invite. The room's PIN still applies to private rooms. The invite is shown to the host and copied by hand; it is never saved.
- **In a VPN room the host sees and relays everything between guests.** Packets between two guests pass through the host's computer; WebRTC media is still DTLS-SRTP encrypted end to end, but the host can see who talks to whom, and could drop or delay traffic.
- **Forwarding is not walled off on macOS.** To relay between guests the host turns on IP forwarding while the room is open (and puts it back). On Linux an `iptables` rule limits it to VPN-to-VPN traffic; on macOS nothing does, so a guest could send packets (one-way: no NAT, so no replies) towards the host's other networks. Don't open a VPN room on a computer on a network you don't want guests near without a firewall in between.
- **The control socket belongs to your user.** After the administrator step, any program running as you can reconfigure that tunnel's peers, as it can anything else you own. The administrator step itself can't be driven that way: it runs once, from a fixed script.
- **The VPN helper runs with administrator rights.** It is a small program we build (WireGuard's Go code plus a few system commands) that the app starts after the system's permission prompt. The app checks its files against checksums made at build time right before asking, and the installer puts them where only administrators can write (hence the all-users install on Windows), so another program running as you can't swap it for something else. A development build (run from source) skips the check, since you just built the helper yourself. Its inputs are validated strictly (an IPv4 address, numbers, absolute paths, an owner id or SID), and it publishes its status with a rename, never writing through a path you could have turned into a link.
- **Windows is unverified.** The Windows side (Wintun, `netsh`, the named pipe limited to your SID) was written and compiled, but hasn't run on a real machine.
- **TLS can be turned off** in Settings (for debugging). Then chat, signaling and TCP media are unencrypted on the network.
- **Content protection is best effort.** It stops screenshots and screen recorders on the viewer's machine, not a phone camera.
- **Profile pictures and previews are images from other people.** They are only rendered as `<img>` data URLs of JPEG/WebP/PNG type, never as HTML or SVG.

## Checklist for changes

- Validate every new message field on the **server**: type, range, size, and whether this sender may send it.
- Never relay data between participants who don't already have a reason to talk (the streamer↔watcher rule).
- Never store the PIN or tokens on disk. Compare secrets with `pinsEqual` (constant time).
- New IPC: coerce arguments in the handler, and add the method to `ScreenShareApi` in `src/shared/ipc.ts` rather than exposing `ipcRenderer`.
- New images from the network: validate with a strict pattern and a size cap, as in `src/shared/images.ts`.
- Add a test for the rejection path, not only the happy path.

## Reporting a problem

Open an issue describing the problem and how to reproduce it. If it could let someone into a private room or run code on another machine, please avoid posting a working exploit publicly; describe the impact and contact the maintainers first.
