# openline

A one-button voice chat hosted on GitHub Pages. Everyone who presses **START VOICE CHAT** joins one public voice room.

**Website:** https://sigma106.github.io/voicechat/

## Important: cross-network calling requires TURN setup

The original public shared TURN server did **not** return a relay candidate in actual testing between two separate networks. The site now supports an account-specific TURN credential using [Metered](https://www.metered.ca/tools/openrelay/). Until the configuration below is filled in, the site can still try direct calls but **cannot reliably connect between different networks**.

### Finish setup in Metered

1. Create an account at https://dashboard.metered.ca/ and select a TURN plan (Metered documents a free usage allowance; check current terms).
2. Under **TURN Server & SFU → Credentials**, create a credential. If you just created it, allow time for it to propagate across the relay network.
3. In **Developers**, locate your Metered domain, such as `yourapp.metered.live`.
4. On that TURN credential, select **Get credential → Show API Key**. Copy **only the credential-scoped API key**. **Do not copy the Developers / account Secret Key.**
5. Open [turn-config.js](./turn-config.js) in this GitHub repo and edit the two blank values:

```js
window.OPENLINE_TURN_CONFIG = {
  domain: 'yourapp.metered.live',
  credentialApiKey: 'YOUR_TURN_CREDENTIAL_SCOPED_API_KEY'
};
```

6. Commit the file. Wait for GitHub Pages to deploy. Refresh the site on both devices.
7. Join with **START VOICE CHAT**, keep microphones unmuted, and test over two networks. If it still fails, use **Copy connection report** and check whether **TURN relay candidate: yes**.

The site fetches the TURN ICE server array at runtime from the [Metered credential API](https://www.metered.ca/docs/turn-rest-api/get-credential/) and passes it to Trystero. The credential-scoped API key is documented by Metered as frontend-safe; it is **public to visitors**, grants access to that credential's relay quota, and should be monitored. For a popular public site, issue restricted or expiring credentials from a backend instead. Never publish an account Secret Key, account-wide Project API key, password, or service-role key.

### What the diagnostics mean

- **01 ON THE LINE:** No peer-to-peer connection has completed. Could be signaling, NAT traversal, failed relay or a visitor who never joined.
- **MQTT brokers reachable: 1/3:** At least one MQTT WebSocket server accepted a connection. This alone does **not** prove signaling between visitors.
- **TURN relay candidate: not configured:** Fill out `turn-config.js`.
- **TURN relay candidate: no:** A configured TURN service failed the browser relay test; check host, credentials, network, and any provider usage limit.
- **TURN relay candidate: yes:** TURN can allocate a relay on this browser; this does **not** guarantee that both browsers will find each other or negotiate audio.
- **Peer count: 0:** No completed WebRTC peers. Test with both devices open and awake.
- **Remote audio count: 0:** No remote audio stream has arrived.
- **MIC MUTED:** Press **UNMUTE MIC** before talking.

The app currently tries MQTT and Nostr public signaling servers. These can fail independently of TURN; for dependable production service, use a managed signaling service in addition to dedicated TURN.

## GitHub Pages

Open https://github.com/Sigma106/voicechat/settings/pages and choose **Deploy from a branch → main → /(root)**.

## Privacy, security, limitations

All visitors join the same unauthenticated **public** room and can hear and speak; there is no moderation, user verification or recording. GitHub Pages only hosts static files; it is not a voice server. Calls use WebRTC media encryption. A small group of participants is the intended use case. The site loads Trystero from a third-party JavaScript CDN. Microphone permission and HTTPS are required.

The only setup keys suitable for `turn-config.js` are **Metered's credential-scoped TURN API key and the app domain**. Never place your Metered account Secret Key there.
