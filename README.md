# Voice Chat

A one-button anonymous voice chat hosted on GitHub Pages. Everyone who clicks **Start voice chat** joins the same public voice room.

## Publish

1. Open https://github.com/Sigma106/voicechat/settings/pages
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select **main** and **/(root)**, then click **Save**.
4. Once deployed, open https://sigma106.github.io/voicechat/

## Features

Minimal landing page, microphone permission after Start, a shared public WebRTC voice room, participant count, mute/unmute, copy-link invite, and leave controls.

## Technology and limitations

GitHub Pages serves this static site. [Trystero](https://trystero.dev/) v0.26.0 connects peers via encrypted WebRTC, using public Nostr relays for signaling. No custom backend is needed. The site loads the library from esm.sh.

**This room is public.** Anyone who has the URL can join, hear and speak. There is no moderation, authentication, or recording. This peer-to-peer design is intended for small groups, not large audiences. Some restricted networks can block voice traffic without a TURN relay. Microphones need HTTPS and browser permission.

To test: open the published site on two devices, press Start on both, permit microphone access, test sound, mute, and leave. Use headphones to prevent feedback.
