# Playing over ZeroTier

How to use ScreenShare with friends who aren't on your network, with [ZeroTier](https://www.zerotier.com/). ZeroTier puts everyone's computers on one private virtual network, so ScreenShare works as if you were all in the same house: **rooms show up in the list by themselves**, and video goes straight from whoever shares to whoever watches.

It's free for a small group. Setting it up takes about five minutes the first time, and about a minute for each friend.

> **Language:** English · [Português (Brasil)](../pt-BR/zerotier.md)

## Contents

- [What you need](#what-you-need)
- [1. Create the network (one person, once)](#1-create-the-network-one-person-once)
- [2. Everyone joins](#2-everyone-joins)
- [3. Approve your friends](#3-approve-your-friends)
- [4. Use ScreenShare](#4-use-screenshare)
- [If something doesn't work](#if-something-doesnt-work)
- [Privacy](#privacy)

```mermaid
flowchart LR
  A["You create a network<br/>on my.zerotier.com"] --> B["Friends install ZeroTier<br/>and paste the network ID"]
  B --> C["You approve them<br/>(Members → Auth)"]
  C --> D["Open ScreenShare:<br/>the room is in the list"]
```

## What you need

- **ScreenShare** on every computer (see [the user guide](user-guide.md)).
- **ZeroTier One**, the ZeroTier app, on every computer: download it from [zerotier.com/download](https://www.zerotier.com/download/). It runs on Windows and macOS.
- **One ZeroTier account**, for the person who creates the network. Friends who only join don't need one.

## 1. Create the network (one person, once)

1. Sign in at [my.zerotier.com](https://my.zerotier.com/) and click **Create A Network**.
2. The new network appears with its **Network ID**: 16 letters and digits, such as `8056c2e21c000001`. ZeroTier makes it up; you don't choose it. This is what your friends will paste.
3. Open the network and check its settings:
   - **Name**: anything, for example "ScreenShare".
   - **Access Control**: keep it **Private**. Anyone with the ID can then *ask* to join, but only the people you approve get in.
   - **IPv4 Auto-Assign**: leave it on. It gives everyone an address on the network (for example `10.147.17.x`).
4. Install ZeroTier One on your own computer and join your network as in the next step.

## 2. Everyone joins

On each computer, including the host's:

1. Install **ZeroTier One** and start it.
2. Open its menu:
   - **Windows**: click the ZeroTier icon next to the clock (it may be hidden behind the **^** arrow) → **Join New Network…**
   - **macOS**: click the ZeroTier icon in the menu bar → **Join New Network…**
3. Paste the network ID and click **Join**.
4. **Windows asks whether this PC should be discoverable by other devices on the network: answer Yes.** Windows then treats the ZeroTier network as private. If you say No, the Windows firewall can block ScreenShare.
5. macOS may ask you to allow ZeroTier in *System Settings → Privacy & Security*; allow it.

The network shows as *Requesting configuration* or *Access denied* until it's approved.

## 3. Approve your friends

On [my.zerotier.com](https://my.zerotier.com/), open your network and scroll down to **Members**. Each computer that asked to join is listed there: tick **Auth** next to it. Give each one a short name (who it is), so you can tell them apart later.

A few seconds later, the network shows as **OK** in ZeroTier on their computer, with an address.

## 4. Use ScreenShare

Nothing to change in ScreenShare: it sees the ZeroTier network like your home network.

- **Host**: click **Create room** as usual.
- **Everyone else**: the room appears under **Rooms on your network** within a few seconds. Click it to join.

If a room doesn't show up, use **Join by IP** with the host's ZeroTier address. The host sees it next to its name under **Members** on my.zerotier.com, or in the room details (**ⓘ** next to the room's name): hover over the address to see all of them, the ZeroTier one is in the range set in step 1.

## If something doesn't work

| Problem | What to do |
|---|---|
| The network says *Requesting configuration* or *Access denied* | The owner hasn't ticked **Auth** for this computer yet. |
| The room doesn't show up | Check that ZeroTier shows the network as **OK** on both computers. Then try **Join by IP** with the host's ZeroTier address. On Windows, make sure the ZeroTier network is *Private* (*Settings → Network & Internet → Ethernet → the ZeroTier network → Network profile type*). |
| Joining works but the video doesn't start | Usually the Windows firewall on the person sharing: allow ScreenShare on private networks (*Windows Security → Firewall → Allow an app*). After 8 seconds ScreenShare switches to its TCP connection by itself. |
| The video is choppy or lags a lot | ZeroTier may be passing your traffic through its own servers instead of connecting you directly. Run `zerotier-cli peers` in a terminal (on Windows, as administrator): your friends should say **DIRECT**. If they say **RELAY**, turning on UPnP in one of the routers, usually the host's, often fixes it. Also check the stream's stats badges and [the quality is low](troubleshooting.md#the-quality-is-low). |
| Everything was working and stops | One of the computers may have left the network, or ZeroTier isn't running. Open ZeroTier and check the network is **OK**. |

For problems that aren't about ZeroTier, see [troubleshooting](troubleshooting.md).

## Privacy

- With **Access Control: Private**, only the computers you approve are on the network. The network ID isn't a password, but share it only with your group, so strangers don't ask to join. Untick **Auth** (or delete the member) to remove someone.
- ZeroTier encrypts everything between the computers, and ScreenShare's video and chat are encrypted on top of that.
- ZeroTier's servers help the computers find each other, and pass traffic along when they can't connect directly. ScreenShare itself still uses no outside service: it only talks to the people in your room.
