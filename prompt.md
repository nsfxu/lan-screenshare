# LAN Desktop Screen Sharing Platform - Build Prompt

## Project Overview
Create a cross-platform desktop application for real-time screen sharing and chat between 2-10 users over LAN/VPN. The app features a home screen with a list of available rooms (auto-discovered on the network), public or private access control (via PIN), and high-quality streaming at 1080p+ @ 60fps.

---

## Core Features

### 1. Home Screen & Room Discovery
- **Room List View:**
  - Display all available rooms on the LAN/VPN
  - Show room name, host name, current viewer count, status (public/private)
  - Auto-refresh when rooms appear/disappear on network
  - Search/filter rooms by name
  
- **Room Discovery:**
  - Use mDNS (Bonjour/Avahi) for LAN discovery
  - Support manual IP entry for VPN/remote networks
  - Automatic reconnection to last joined room (optional)

- **Room Creation:**
  - One-click "Create Room" button
  - Set room name and privacy (Public/Private with PIN)
  - Auto-generate room code/PIN (4-6 digits for private rooms)
  - Option to share PIN via clipboard

### 2. Room Interface (When Joined)
- **Split Layout:**
  - Left: Large screen sharing area (1080p+ @ 60fps)
  - Right: Chat panel + Viewer list
  
- **Screen Sharing Area:**
  - High-quality video stream
  - Zoom/pan controls (mouse wheel, click-drag)
  - FPS counter and latency indicator
  - Full-screen toggle

- **Chat Panel:**
  - Real-time text chat with timestamps
  - User avatars/names
  - Message history (in-memory or session-based)
  - Input field at bottom
  - Emoji support (optional)

- **Viewer List:**
  - Show all connected users
  - For room host: kick/remove user buttons
  - Connection status indicators

### 3. Screen Capture & Streaming
- **Capture Methods:**
  - **Windows:** DXGI (DirectX) for GPU-accelerated capture
  - **macOS:** ScreenCaptureKit (native, high-performance)
  
- **Quality Settings:**
  - Primary: 1080p @ 60fps (10-15 Mbps target)
  - Fallback: 720p @ 60fps (6-10 Mbps)
  - Low bandwidth: 720p @ 30fps (3-5 Mbps)
  - Adaptive bitrate based on network quality
  
- **Codec:**
  - H.264 with hardware acceleration (preferred)
  - H.265 if supported
  - Automatic selection based on hardware capabilities
  
- **Frame Rate Management:**
  - 60 FPS primary target
  - Adaptive FPS scaling on network degradation
  - <100ms latency target

### 4. Network Protocol
- **Architecture:** Server-relay model (one central node per room)
  - Host runs relay server (lightweight)
  - Viewers connect to relay
  - Easier than P2P for multi-user + firewall traversal
  
- **Transport:**
  - WebRTC DataChannels for screen stream (UDP-based)
  - Fallback to TCP for restricted networks
  - Chat: WebSocket or direct TCP (low bandwidth)
  
- **Bandwidth Management:**
  - Per-viewer bitrate limiting
  - Network condition detection (packet loss, latency)
  - Automatic quality adjustment

### 5. Authentication & Security
- **Public Rooms:**
  - No auth required, anyone on network can join
  - Clearly marked as "Public"
  
- **Private Rooms:**
  - Require 4-6 digit PIN on connection
  - PIN is temporary (session-only, not stored)
  - Host can change/reset PIN mid-session
  - Max 3 failed PIN attempts (optional lockout)
  
- **Encryption:**
  - TLS/SSL for all connections (optional but recommended)
  - In-transit encryption only (no persistent storage)

### 6. Host Controls
- **While Sharing:**
  - Pause/Resume sharing
  - End sharing (disconnect all viewers)
  - Kick individual viewers
  - View real-time stats: bandwidth, latency, FPS, CPU usage
  - Change privacy setting mid-session
  - Minimize/close app (pause auto-resumes or closes room)

- **Chat Moderation:**
  - Delete individual messages (optional)
  - Mute/unmute chat (optional, prevent new messages but show history)

### 7. Viewer Permissions
- **What Viewers Can Do:**
  - View the shared screen
  - Send and receive chat messages
  - Zoom/pan the screen
  - See connected user count
  
- **What Viewers Cannot Do (by default):**
  - Control host's mouse/keyboard
  - Record the stream
  - Save chat history

---

## Technical Architecture

### Stack Recommendation (Electron + Node.js)
- **Frontend:** Electron (cross-platform native desktop)
- **Streaming:** FFmpeg/libav for encoding + WebRTC
- **Discovery:** mDNS client (bonjour npm package)
- **Chat:** WebSocket or native TCP
- **UI Framework:** React or Vue.js
- **Packaging:** Electron-builder (for Mac & Windows)

### File Structure
```
project/
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron main process
│   │   ├── roomManager.ts        # Room creation/discovery
│   │   ├── screenCapture.ts      # DXGI/ScreenCaptureKit
│   │   └── server.ts             # WebRTC relay server
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── HomeScreen.tsx    # Room list & discovery
│   │   │   ├── RoomView.tsx      # Main sharing interface
│   │   │   ├── ChatPanel.tsx     # Chat UI
│   │   │   └── ScreenViewer.tsx  # Remote screen display
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── shared/
│   │   ├── types.ts              # Shared TypeScript types
│   │   └── constants.ts
│   └── utils/
│       ├── mdns.ts               # Room discovery
│       ├── crypto.ts             # PIN validation
│       └── network.ts            # Connection helpers
├── tests/
├── package.json
└── electron-builder.json
```

---

## Implementation Phases

### Phase 1: Core Streaming (Week 1-2)
- [ ] Electron app scaffold
- [ ] Screen capture (Windows DXGI + macOS ScreenCaptureKit)
- [ ] H.264 encoding with hardware acceleration
- [ ] WebRTC peer connection (host → viewer)
- [ ] Basic viewer UI (receive & display stream)

### Phase 2: Room Management (Week 2-3)
- [ ] mDNS discovery on startup
- [ ] Home screen with room list
- [ ] Room creation (public/private with PIN)
- [ ] PIN validation on join
- [ ] Broadcast room availability on network

### Phase 3: Chat & Multi-User (Week 3-4)
- [ ] Text chat system
- [ ] Multiple viewers per host
- [ ] Viewer list with user names
- [ ] Host kick/remove controls
- [ ] Bandwidth & latency monitoring UI

### Phase 4: Polish & Optimization (Week 4-5)
- [ ] Adaptive bitrate/quality scaling
- [ ] Settings panel (quality, network, notifications)
- [ ] Error handling & reconnection logic
- [ ] Packaging for Mac & Windows
- [ ] Testing on various network conditions

---

## Success Criteria

1. ✅ Share screen at 1080p @ 60fps over LAN with <100ms latency
2. ✅ Support 5-10 simultaneous viewers
3. ✅ Work on Windows and macOS (native installers)
4. ✅ Auto-discover rooms on LAN via mDNS
5. ✅ Public/Private room access control with PIN
6. ✅ Real-time chat between all users
7. ✅ Graceful quality degradation on poor networks
8. ✅ <15% CPU usage per viewer connection
9. ✅ Easy one-click sharing (no complex setup)
10. ✅ No external service dependencies (pure LAN/VPN)

---

## Non-Functional Requirements

- **Latency:** <150ms end-to-end for viewer feedback
- **CPU Usage:** <20% per active stream (host)
- **Memory:** <400MB baseline, +50MB per viewer
- **Network:** Minimum 10Mbps recommended; degrades to 480p @ 30fps on lower bandwidth
- **Uptime:** App should auto-reconnect on network drops
- **Scalability:** Test with 2-10 users per room

---

## Deployment

- **Installation:** Native installers for Windows (.exe) and macOS (.dmg)
- **Updates:** Built-in auto-update (optional)
- **Logging:** Local log files for debugging (~/AppData/Roaming/ScreenShare or ~/Library/ScreenShare)

---

## Use Cases

1. **Remote Pair Programming:** Developer A shares their IDE with teammates for code review
2. **Internal Presentations:** Share slides/demos with team over office LAN
3. **Home Lab Management:** Share server screen with other network admins
4. **Educational:** Teachers sharing screen with students on same network
5. **Technical Support:** Support staff sharing troubleshooting screen with client (same LAN/VPN)

---

## Future Enhancements (Out of Scope v1)

- Remote mouse/keyboard control (with host permission)
- Multi-monitor support
- Screen recording
- Custom themes/branding
- Performance metrics dashboard
- Integration with Slack/Discord for room invites
- Audio stream (separate from screen)
- Linux support
