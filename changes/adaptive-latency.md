### Changed

- **Half the delay by default.** Streams you watch are now shown as soon as each frame arrives: about 25 ms from screen to screen on a wired network instead of 50. A stream that stutters, on Wi-Fi or a VPN, gets a short wait of its own to play evenly, and drops it again once things are calm. **Settings → Advanced → Latency** replaces **Lowest latency**: **Automatic** (the new default), **Lowest** (never waits; it's what Lowest latency did, and stays chosen if you had it on) or **Smooth** (always waits a little, as before).
