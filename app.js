// openline: one shared room, on a static GitHub Pages site.
// TURN fallback uses the publicly documented Open Relay shared-auth endpoint.
// For reliable production use, replace the public preset with TURN credentials
// issued to your own account (read README.md).
const APP_ID = 'io.github.sigma106.voicechat.public.v1';
const ROOM_ID = 'everyone';
const PRIVATE_TURN_SERVERS = []; // Optional: your own RTCIceServer objects.

const $ = id => document.getElementById(id);
const ui = {
  landing: $('landing'), call: $('call'), start: $('start'), startLabel: $('start-label'),
  error: $('error'), heading: $('heading'), description: $('description'),
  micStatus: $('mic-status'), micLevel: $('mic-level'),
  connectionStatus: $('connection-status'), people: $('people'),
  mute: $('mute'), muteSymbol: $('mute-symbol'), muteLabel: $('mute-label'),
  invite: $('invite'), inviteLabel: $('invite-label'), leave: $('leave'),
  notice: $('notice'), enableSound: $('enable-sound'), retry: $('retry'),
  audioContainer: $('audio-container')
};
let session = null;
let busy = false;
let muted = false;

function stopMic(stream) {
  if (stream) stream.getTracks().forEach(track => track.stop());
}

function setBusy(value) {
  busy = value;
  ui.start.disabled = value;
  ui.startLabel.textContent = value ? 'CONNECTING…' : 'START VOICE CHAT';
}

function errorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError')
    return 'Microphone blocked. Allow access in your browser and try again.';
  if (error?.name === 'NotFoundError')
    return 'No microphone found. Connect one and try again.';
  if (error?.name === 'NotReadableError')
    return 'Your microphone is unavailable. Close apps that are using it and retry.';
  if (error?.message === 'insecure')
    return 'Open the HTTPS website instead of a local file to use your microphone.';
  return 'Could not join the room. Check your connection, then try again.';
}

// Open Relay documents this shared authentication secret for public testing.
// It is NOT a private account credential; providers can rate-limit/disable it.
// Tokens are time-bound HMAC-SHA1 as required by coturn's TURN REST mechanism.
async function turnConfig() {
  if (PRIVATE_TURN_SERVERS.length) return PRIVATE_TURN_SERVERS;
  const cryptoApi = window.crypto;
  if (!cryptoApi?.subtle) return [];
  const username = Math.floor(Date.now() / 1000 + 24 * 60 * 60) + ':openline';
  const bytes = new TextEncoder();
  const key = await cryptoApi.subtle.importKey(
    'raw', bytes.encode('openrelayprojectsecret'),
    {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']
  );
  const signed = new Uint8Array(await cryptoApi.subtle.sign('HMAC', key, bytes.encode(username)));
  const credential = btoa(String.fromCharCode(...signed));
  return [{
    urls: [
      'turn:staticauth.openrelay.metered.ca:80?transport=udp',
      'turn:staticauth.openrelay.metered.ca:443?transport=tcp',
      'turns:staticauth.openrelay.metered.ca:443?transport=tcp'
    ],
    username, credential
  }];
}

function roomState(s) {
  if (session !== s) return;
  const others = s.peers.size;
  const audioCount = s.audios.size;
  const total = others + 1;
  ui.people.textContent = String(total).padStart(2, '0') + ' ON THE LINE';

  if (!others) {
    ui.heading.textContent = 'Waiting for voices.';
    ui.description.textContent = "Send this link to someone. They'll join the same room.";
    ui.connectionStatus.textContent = 'Waiting for someone else';
  } else if (!audioCount) {
    ui.heading.textContent = 'Making a connection.';
    ui.description.textContent = 'Someone joined. Connecting their microphone audio…';
    ui.connectionStatus.textContent = 'Connecting audio…';
  } else {
    ui.heading.textContent = 'You’re on the line.';
    ui.description.textContent = 'Go ahead and talk. Everyone here shares this room.';
    ui.connectionStatus.textContent = audioCount < others ? 'Audio linked · connecting others' : 'Audio link ready';
    ui.notice.textContent = '';
    ui.retry.hidden = true;
  }
}

function disposeAudio(s, peerId) {
  const audio = s.audios.get(peerId);
  if (!audio) return;
  audio.pause();
  audio.srcObject = null;
  audio.remove();
  s.audios.delete(peerId);
}

async function unlockAudio(s, audio) {
  try {
    await audio.play();
    if (session !== s) return;
    ui.enableSound.hidden = true;
    ui.notice.textContent = '';
  } catch (error) {
    if (session !== s) return;
    ui.enableSound.hidden = false;
    ui.notice.textContent = 'Tap Enable speaker audio so you can hear other people.';
  }
}

function playRemoteAudio(s, stream, peerId) {
  if (session !== s || !stream?.getAudioTracks().length) return;
  disposeAudio(s, peerId);
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.playsInline = true;
  audio.muted = false;
  audio.srcObject = stream;
  ui.audioContainer.appendChild(audio);
  s.audios.set(peerId, audio);
  audio.addEventListener('loadedmetadata', () => { if (session === s) void unlockAudio(s, audio); }, {once: true});
  void unlockAudio(s, audio);
  roomState(s);
}

function monitorMicrophone(s) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  try {
    const context = new Context();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(s.stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      if (session !== s) return;
      analyser.getByteTimeDomainData(samples);
      let power = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        power += centered * centered;
      }
      const loudness = Math.sqrt(power / samples.length);
      ui.micLevel.style.width = (muted ? 0 : Math.min(100, loudness * 650)) + '%';
      ui.micStatus.textContent = muted ? 'MUTED' : loudness > 0.024 ? 'SOUND DETECTED' : 'MIC READY';
      frame = requestAnimationFrame(tick);
    };
    void context.resume().catch(() => {});
    tick();
    s.stopMeter = () => {
      cancelAnimationFrame(frame);
      ui.micLevel.style.width = '0%';
      void context.close().catch(() => {});
    };
  } catch (error) {
    console.warn('Microphone meter unavailable:', error);
  }
}

function delayedAudioWarning(s, peerId) {
  setTimeout(() => {
    if (session !== s || !s.peers.has(peerId) || s.audios.has(peerId)) return;
    ui.notice.textContent = 'Someone is here, but no audio arrived. Check both microphones, then retry the connection.';
    ui.retry.hidden = false;
  }, 14000);
}

function handleJoinError(s, details) {
  if (session !== s) return;
  console.warn('WebRTC peer connection failed:', details);
  ui.notice.textContent = 'Unable to connect to another person on this network. Try Retry connection. If it continues, a dedicated TURN relay may be needed.';
  ui.retry.hidden = false;
}

async function start() {
  if (busy || session) return;
  setBusy(true);
  ui.error.hidden = true;
  ui.notice.textContent = '';
  ui.retry.hidden = true;
  let stream = null;
  let room = null;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error('insecure');

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
      video: false
    });
    const [servers, module] = await Promise.all([
      turnConfig(), import('https://esm.sh/trystero@0.26.0?bundle')
    ]);
    room = module.joinRoom(
      {appId: APP_ID, turnConfig: servers},
      ROOM_ID,
      {onJoinError: details => { if (session) handleJoinError(session, details); }}
    );
    const s = {room, stream, peers: new Set(), audios: new Map(), stopMeter: null};
    session = s;

    room.onPeerStream = (remote, peerId) => playRemoteAudio(s, remote, peerId);
    room.onPeerJoin = peerId => {
      if (session !== s) return;
      s.peers.add(peerId);
      roomState(s);
      // Attach our tracks to every newly connected peer (even late joiners).
      try {
        const sent = room.addStream(stream, {target: peerId});
        if (sent?.catch) sent.catch(error => console.warn('Media send error:', error));
      } catch (error) {
        console.warn('Media send error:', error);
      }
      delayedAudioWarning(s, peerId);
    };
    room.onPeerLeave = peerId => {
      if (session !== s) return;
      s.peers.delete(peerId);
      disposeAudio(s, peerId);
      roomState(s);
    };
    room.addStream(stream);
    muted = false;
    ui.mute.setAttribute('aria-pressed', 'false');
    ui.muteLabel.textContent = 'MUTE MIC';
    ui.muteSymbol.textContent = '◖))';
    ui.inviteLabel.textContent = 'COPY LINK';
    ui.enableSound.hidden = true;
    ui.landing.hidden = true;
    ui.call.hidden = false;
    roomState(s);
    monitorMicrophone(s);
    const track = stream.getAudioTracks()[0];
    if (track) track.addEventListener('ended', () => {
      if (session === s) {
        ui.micStatus.textContent = 'MIC DISCONNECTED';
        ui.notice.textContent = 'The microphone stopped. Leave the room and start again.';
      }
    });
  } catch (error) {
    console.error('Voice chat startup failed:', error);
    if (session?.room === room) session = null;
    if (room) try { await room.leave(); } catch {}
    stopMic(stream);
    ui.error.textContent = errorMessage(error);
    ui.error.hidden = false;
  } finally {
    setBusy(false);
  }
}

async function leave() {
  const s = session;
  if (!s) return;
  session = null;
  ui.call.hidden = true;
  ui.landing.hidden = false;
  ui.enableSound.hidden = true;
  ui.retry.hidden = true;
  ui.notice.textContent = '';
  ui.error.hidden = true;
  s.room.onPeerJoin = null;
  s.room.onPeerLeave = null;
  s.room.onPeerStream = null;
  s.stopMeter?.();
  for (const peerId of [...s.audios.keys()]) disposeAudio(s, peerId);
  stopMic(s.stream);
  try { await s.room.leave(); } catch (error) { console.warn('Leave failed:', error); }
}

ui.start.addEventListener('click', () => { void start(); });
ui.leave.addEventListener('click', () => { void leave(); });
ui.retry.addEventListener('click', async () => {
  if (busy) return;
  await leave();
  await start();
});
ui.mute.addEventListener('click', () => {
  if (!session) return;
  muted = !muted;
  session.stream.getAudioTracks().forEach(track => { track.enabled = !muted; });
  ui.mute.setAttribute('aria-pressed', String(muted));
  ui.muteLabel.textContent = muted ? 'UNMUTE MIC' : 'MUTE MIC';
  ui.muteSymbol.textContent = muted ? '×' : '◖))';
});
ui.invite.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    ui.inviteLabel.textContent = 'LINK COPIED';
    ui.notice.textContent = '';
  } catch {
    ui.notice.textContent = 'Share this link: ' + location.href;
  }
});
ui.enableSound.addEventListener('click', async () => {
  const s = session;
  if (!s) return;
  const result = await Promise.allSettled([...s.audios.values()].map(audio => audio.play()));
  if (session !== s) return;
  if (result.every(item => item.status === 'fulfilled')) {
    ui.enableSound.hidden = true;
    ui.notice.textContent = '';
  }
});
window.addEventListener('pagehide', () => {
  const s = session;
  if (!s) return;
  session = null;
  s.stopMeter?.();
  stopMic(s.stream);
  void s.room.leave();
});
