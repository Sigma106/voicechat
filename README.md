# openline

An anonymous, single-room voice chat hosted on GitHub Pages. The first page has one main action: **START VOICE CHAT**. Anyone who opens the same URL and starts joins the same public room.

## Website

https://sigma106.github.io/voicechat/

If GitHub Pages is not enabled, open https://github.com/Sigma106/voicechat/settings/pages and set **Deploy from a branch → main → /(root)**.

## October 24 — connection troubleshooting, version 4

If both browsers display **01 ON THE LINE**, the connection between browsers has not completed. This can mean signaling brokers cannot be reached, browsers cannot negotiate WebRTC, or one side is on an older version. It does **not** by itself prove TURN is broken.

Version 4 now pins the same three public MQTT broker addresses for all visitors and also runs the Nostr strategy in parallel. This reduces the risk of peers being on non-overlapping public signaling brokers.

**Both people must refresh the site** to load v4. In the active voice room, press **UNMUTE MIC** if you see **MIC MUTED** (as in the screenshot). Turn off any active VPN/proxy or filtering extensions temporarily for a test, then try on different networks. Public relay connectivity and TURN still are not guaranteed.

After 15 seconds without a peer, a message appears, along with **Copy connection report**. Paste the report into the chat to show which transport modules loaded, whether the public MQTT WebSocket endpoints are reachable, whether TURN yields a relay candidate, and whether WebRTC failed after an attempted handshake. The WebSocket test confirms server reachability, **not** successful MQTT subscription.

For consistently reliable cross-network use, arrange dedicated signaling infrastructure (Supabase/Firebase or another managed provider) and a dedicated TURN service. The static GitHub Pages host cannot safely keep private service credentials or guarantee availability of volunteer/public infrastructure.

## Cross-network troubleshooting (October 2026 update)

The site now opens **two independent signaling paths** (public MQTT and Nostr relays). If one relay network is down, the other may still discover peers. It also deduplicates audio from the same remote browser so you don't hear echoes and checks whether the configured TURN relay can supply a relay ICE candidate.

**Testing:** Both people must refresh the site to load version 3, join, allow microphones, and watch:

- **01 ON THE LINE** on both devices: browsers haven't discovered or connected to each other. Check the browser connection and click Retry.
- **02 ON THE LINE**, **Peer found / waiting for audio**: signaling and WebRTC peer negotiation succeeded but the other audio track hasn't arrived. Check microphone access on both sides, or click Retry.
- **Audio link ready**: a remote audio stream exists. If it's still silent, check whether the mic meter says **SOUND DETECTED** on the sender, check phone volume and output, and click **Enable speaker audio** if present.
- **TURN fallback unavailable**: this Wi-Fi/mobile network couldn't gather a relay candidate from the free shared relay. Set up a dedicated TURN service for more reliable cross-network calling. The free public relay cannot be guaranteed to work for every connection.

Neither seeing 02 nor seeing "Audio link ready" by itself proves sound is flowing; listen on both devices.

The fallback uses publicly operated infrastructure. A properly configured, dedicated TURN service (with limited-lived client credentials) is the recommended next step for reliable use, and may still not overcome all networks.

## How to test the cross-network fix

1. On **both phones or computers**, close any old tabs and open the website again. Use a hard refresh if it looks like the older purple design.
2. Press **START VOICE CHAT**, allow microphone access, and keep the browser tab open.
3. One person can use home Wi-Fi and the other a different Wi-Fi or mobile data connection.
4. One should see **02 ON THE LINE** when the other connects, and **Audio link ready** when remote audio arrives.
5. Talk while watching the microphone meter (**SOUND DETECTED**) on each device. If sound isn't playing, tap **Enable speaker audio**. Use headphones to avoid feedback.
6. If the connection fails, use **Retry connection** on both devices.

## How it works

The room uses [Trystero](https://trystero.dev/) v0.26.0 for encrypted peer-to-peer WebRTC. Discovery uses both public MQTT brokers and public Nostr relays, and the site also attempts a TURN relay for networks where direct WebRTC can't connect.

The included TURN fallback is Metered's publicly documented [Open Relay](https://www.metered.ca/tools/openrelay/) shared-auth testing server. Its public credential is time-limited by the browser; it is **not** an individual account and is not guaranteed to remain available or handle production traffic. No private API secrets are used.

### For a reliable dedicated TURN relay

If the same two devices still cannot hear each other (or if you're planning to use this outside of personal testing), register for a [TURN service](https://www.metered.ca/tools/openrelay/) and obtain a TURN-only username/password or short-lived scoped credentials.

Then edit `app.js`, replacing `const OWN_TURN_SERVERS = [];` near the top with something like:

```js
const PRIVATE_TURN_SERVERS = [
  {
    urls: [
      'turn:YOUR-TURN-SERVER:3478',
      'turns:YOUR-TURN-SERVER:5349?transport=tcp'
    ],
    username: 'YOUR_TURN_USERNAME',
    credential: 'YOUR_TURN_PASSWORD'
  }
];
```

Use **your provider's actual TURN URLs/ports**. Avoid putting an **account API secret** in this public repo; it would be exposed to anyone visiting the site. Production should issue temporary client TURN credentials from a trusted backend. GitHub Pages cannot keep secrets.

## Limitations

This is **one public room**, not a private call. Anyone with the link can join and speak. No account, moderation, recording, or user identification. Peer-to-peer calls are suitable for small groups; every extra participant increases simultaneous connections. Microphone access requires HTTPS. Mobile browser audio policies sometimes require tapping the speaker-enable button. Third-party relay availability and network rules can affect connectivity.

The site uses no hosted database or paid backend and requires no installation beyond enabling GitHub Pages.
