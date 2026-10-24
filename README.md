# openline

An anonymous, single-room voice chat hosted on GitHub Pages. The first page has one main action: **START VOICE CHAT**. Anyone who opens the same URL and starts joins the same public room.

## Website

https://sigma106.github.io/voicechat/

If GitHub Pages is not enabled, open https://github.com/Sigma106/voicechat/settings/pages and set **Deploy from a branch → main → /(root)**.

## How to test the cross-network fix

1. On **both phones or computers**, close any old tabs and open the website again. Use a hard refresh if it looks like the older purple design.
2. Press **START VOICE CHAT**, allow microphone access, and keep the browser tab open.
3. One person can use home Wi-Fi and the other a different Wi-Fi or mobile data connection.
4. One should see **02 ON THE LINE** when the other connects, and **Audio link ready** when remote audio arrives.
5. Talk while watching the microphone meter (**SOUND DETECTED**) on each device. If sound isn't playing, tap **Enable speaker audio**. Use headphones to avoid feedback.
6. If the connection fails, use **Retry connection** on both devices.

## How it works

The room uses [Trystero](https://trystero.dev/) v0.26.0 for encrypted peer-to-peer WebRTC. Discovery uses public Nostr signaling relays, and the site now also attempts a TURN relay for networks where direct WebRTC can't connect.

The included TURN fallback is Metered's publicly documented [Open Relay](https://www.metered.ca/tools/openrelay/) shared-auth testing server. Its public credential is time-limited by the browser; it is **not** an individual account and is not guaranteed to remain available or handle production traffic. No private API secrets are used.

### For a reliable dedicated TURN relay

If the same two devices still cannot hear each other (or if you're planning to use this outside of personal testing), register for a [TURN service](https://www.metered.ca/tools/openrelay/) and obtain a TURN-only username/password or short-lived scoped credentials.

Then edit `app.js`, replacing `const PRIVATE_TURN_SERVERS = [];` near the top with something like:

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
