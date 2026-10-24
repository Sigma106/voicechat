// openline — shared public audio room.
// Two discovery transports provide fallback if public signaling relays are blocked.
// TURN helps WebRTC cross restrictive NATs but the public relay has no uptime SLA.
const APP_ID = 'io.github.sigma106.voicechat.public.v1';
const ROOM_ID = 'everyone';
// Pin multiple public MQTT brokers so devices on different networks try the same ones.
const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];
const SIGNALS = [
  {name: 'mqtt', url: 'https://esm.sh/@trystero-p2p/mqtt@0.26.0?bundle', relayConfig: {urls: MQTT_BROKERS}},
  {name: 'nostr', url: 'https://esm.sh/trystero@0.26.0?bundle', relayConfig: {redundancy: 6}}
];
const OWN_TURN_SERVERS = []; // Optional. See README.md for dedicated TURN setup.
const $ = id => document.getElementById(id);
const ui = {
  landing: $('landing'), call: $('call'), start: $('start'), startLabel: $('start-label'),
  error: $('error'), heading: $('heading'), description: $('description'),
  micStatus: $('mic-status'), micLevel: $('mic-level'),
  connectionStatus: $('connection-status'), people: $('people'),
  mute: $('mute'), muteSymbol: $('mute-symbol'), muteLabel: $('mute-label'),
  invite: $('invite'), inviteLabel: $('invite-label'), leave: $('leave'),
  notice: $('notice'), enableSound: $('enable-sound'), retry: $('retry'),
  audioContainer: $('audio-container'), diagnostics: $('diagnostics')
};
let session = null, busy = false, muted = false;
const stopMic = stream => stream?.getTracks().forEach(track => track.stop());
function setBusy(value) {
  busy = value;
  ui.start.disabled = value;
  ui.startLabel.textContent = value ? 'CONNECTING…' : 'START VOICE CHAT';
}
function explain(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError')
    return 'Microphone blocked. Allow access in your browser settings and try again.';
  if (error?.name === 'NotFoundError')
    return 'No microphone detected. Connect one and retry.';
  if (error?.name === 'NotReadableError')
    return 'Your microphone is busy or unavailable.';
  if (error?.message === 'insecure')
    return 'Use the HTTPS GitHub Pages URL to access your microphone.';
  if (error?.message?.startsWith('TURN setup:'))
    return error.message + '. The site owner should check turn-config.js.';
  return 'Could not start voice chat. Check your internet connection and retry.';
}

// Metered gives each credential a scoped API key specifically intended for
// client-side use. Never embed a Metered account Secret Key in this repository.
async function turnServers() {
  const setup = window.OPENLINE_TURN_CONFIG || {};
  const domain = String(setup.domain || '').trim()
    .replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const scopedKey = String(setup.credentialApiKey || '').trim();
  if (!domain || !scopedKey) return [];

  if (!/^[a-z0-9][a-z0-9-]*\.metered\.live$/i.test(domain)) {
    throw new Error('TURN setup: domain must look like myapp.metered.live');
  }
  let response;
  try {
    response = await fetch(
      'https://' + domain + '/api/v1/turn/credentials?apiKey=' + encodeURIComponent(scopedKey),
      {cache:'no-store'}
    );
  } catch (error) {
    throw new Error('TURN setup: failed to reach the Metered credential service');
  }
  if (!response.ok) {
    throw new Error('TURN setup: the credential service returned HTTP ' + response.status);
  }
  const ice = await response.json();
  if (!Array.isArray(ice)) {
    throw new Error('TURN setup: invalid ICE server response');
  }
  const relays = ice.filter(item => {
    const urls = Array.isArray(item?.urls) ? item.urls : [item?.urls];
    return urls.some(url => typeof url === 'string' && /^turns?:/i.test(url));
  });
  if (!relays.length || relays.some(item => !item.username || !item.credential)) {
    throw new Error('TURN setup: no usable TURN credentials returned');
  }
  return relays;
}

// If the browser can't gather a "relay" ICE candidate, the TURN fallback is
// unavailable on this network. This is a diagnostic, not a proof of end-to-end audio.
async function checkTurn(servers) {
  const pc = new RTCPeerConnection({iceServers: servers, iceTransportPolicy: 'relay'});
  try {
    return await new Promise(resolve => {
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), 10000);
      pc.onicecandidate = e => {
        if (e.candidate?.type === 'relay' || / typ relay /.test(e.candidate?.candidate || ''))
          finish(true);
        else if (!e.candidate && pc.iceGatheringState === 'complete')
          finish(false);
      };
      pc.createDataChannel('turn-check');
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => finish(false));
    });
  } finally {
    pc.close();
  }
}

// A successful WebSocket open proves reachability, not MQTT subscription.
function testWebSocket(url) {
  return new Promise(resolve => {
    let socket, finished = false;
    const timer = setTimeout(() => complete(false), 6000);
    const complete = ok => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket?.close(); } catch {}
      resolve(ok);
    };
    try {
      socket = new WebSocket(url);
      socket.onopen = () => complete(true);
      socket.onerror = () => complete(false);
    } catch { complete(false); }
  });
}
function peerKey(name, id) { return name + ':' + id; }
function identityOf(s, key) { return s.routes.get(key)?.identity || key; }
function uniqueRemoteIds(s) { return new Set([...s.routes.keys()].map(key => identityOf(s, key))); }
function activeRemoteAudioIds(s) {
  return new Set([...s.audios.keys()].map(key => identityOf(s, key)));
}
function chooseAudioRoutes(s) {
  const chosen = new Set();
  // Only play one stream per remote browser if Nostr and MQTT both discover it.
  for (const [key, audio] of s.audios) {
    const id = identityOf(s, key);
    audio.muted = chosen.has(id);
    chosen.add(id);
  }
}
function updateRoom(s) {
  if (session !== s) return;
  chooseAudioRoutes(s);
  const others = uniqueRemoteIds(s).size;
  const playing = activeRemoteAudioIds(s).size;
  const count = others + 1;
  ui.people.textContent = String(count).padStart(2, '0') + ' ON THE LINE';
  if (others === 0) {
    ui.heading.textContent = 'Waiting for voices.';
    ui.description.textContent = 'Send this link to someone. They’ll join the same room.';
    ui.connectionStatus.textContent = 'Looking for other people';
  } else if (playing === 0) {
    ui.heading.textContent = 'Connecting audio.';
    ui.description.textContent = 'Another person has joined. Establishing the audio link…';
    ui.connectionStatus.textContent = 'Peer found / waiting for audio';
  } else {
    ui.heading.textContent = 'You’re on the line.';
    ui.description.textContent = 'Go ahead and talk. Everyone here shares this room.';
    ui.connectionStatus.textContent = playing < others ? 'Audio ready / connecting others' : 'Audio link ready';
    if (playing >= others) {
      ui.retry.hidden = true;
      if (ui.enableSound.hidden) ui.notice.textContent = '';
    }
  }
}
function removeAudio(s, key) {
  const audio = s.audios.get(key);
  if (!audio) return;
  audio.pause();
  audio.srcObject = null;
  audio.remove();
  s.audios.delete(key);
  chooseAudioRoutes(s);
}
async function enableAudio(s, audio) {
  try {
    await audio.play();
    if (session === s && [...s.audios.values()].every(a => !a.paused))
      ui.enableSound.hidden = true;
  } catch (error) {
    if (session !== s) return;
    ui.enableSound.hidden = false;
    ui.notice.textContent = 'Your browser blocked speaker playback. Tap Enable speaker audio.';
  }
}
function remoteAudio(s, key, stream) {
  if (session !== s || !stream?.getAudioTracks().length) return;
  removeAudio(s, key);
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.playsInline = true;
  audio.srcObject = stream;
  audio.volume = 1;
  ui.audioContainer.appendChild(audio);
  s.audios.set(key, audio);
  chooseAudioRoutes(s);
  audio.addEventListener('loadedmetadata', () => { if (session === s) void enableAudio(s, audio); }, {once:true});
  void enableAudio(s, audio);
  updateRoom(s);
}
function connectionIssue(s, message) {
  if (session !== s || activeRemoteAudioIds(s).size) return;
  ui.notice.textContent = message;
  ui.retry.hidden = false;
}
function waitForAudio(s, key) {
  setTimeout(() => {
    if (session !== s || !s.routes.has(key) || s.audios.has(key)) return;
    const reason = !s.turnConfigured
      ? 'No TURN relay has been configured yet. Calls between different networks may fail.'
      : s.turnAvailable === false
        ? 'The configured TURN relay cannot be reached from this network.'
        : 'Peer discovered, but no audio arrived. Check microphones on both devices, then retry.';
    connectionIssue(s, reason);
  }, 16000);
}
function microphoneMeter(s) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(s.stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let frame;
    const tick = () => {
      if (session !== s) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) {
        const p = (value - 128) / 128;
        sum += p * p;
      }
      const level = Math.sqrt(sum / samples.length);
      ui.micLevel.style.width = (muted ? 0 : Math.min(100, level * 650)) + '%';
      ui.micStatus.textContent = muted ? 'MIC MUTED' : level > 0.024 ? 'SOUND DETECTED' : 'MIC READY';
      frame = requestAnimationFrame(tick);
    };
    void context.resume().catch(() => {});
    tick();
    s.stopMeter = () => {
      cancelAnimationFrame(frame);
      ui.micLevel.style.width = '0%';
      void context.close().catch(() => {});
    };
  } catch (error) { console.warn('Microphone monitor:', error); }
}
function attachStrategy(s, config, module) {
  const name = config.name;
  let room;
  room = module.joinRoom(
    {appId: APP_ID, turnConfig: s.servers, relayConfig: config.relayConfig},
    ROOM_ID,
    {onJoinError: details => {
      console.warn('Connection failure via ' + name, details);
      if (session !== s) return;
      s.connectionFailures.set(name, (s.connectionFailures.get(name) || 0) + 1);
      if (!activeRemoteAudioIds(s).size) {
        ui.notice.textContent = 'WebRTC failed to connect on ' + name.toUpperCase() + '. Another network or dedicated TURN relay may be needed.';
        ui.retry.hidden = false;
        ui.diagnostics.hidden = false;
      }
    }}
  );
  s.rooms.set(name, room);
  const identity = room.makeAction('openline-identity');
  identity.onMessage = (payload, meta) => {
    if (session !== s || typeof payload?.id !== 'string') return;
    const key = peerKey(name, meta.peerId);
    const record = s.routes.get(key);
    if (!record) return;
    record.identity = payload.id;
    updateRoom(s);
  };
  room.onPeerStream = (stream, id) => remoteAudio(s, peerKey(name, id), stream);
  room.onPeerJoin = id => {
    if (session !== s) return;
    const key = peerKey(name, id);
    s.routes.set(key, {identity: null});
    updateRoom(s);
    try {
      const sending = identity.send({id: s.clientId}, {target: id});
      if (sending?.catch) sending.catch(console.warn);
    } catch (error) { console.warn('Identity action failed:', error); }
    try {
      const sending = room.addStream(s.stream, {target: id});
      if (sending?.catch) sending.catch(console.warn);
    } catch (error) { console.warn('Audio stream send failed:', error); }
    waitForAudio(s, key);
  };
  room.onPeerLeave = id => {
    if (session !== s) return;
    const key = peerKey(name, id);
    s.routes.delete(key);
    removeAudio(s, key);
    updateRoom(s);
  };
  // Register stream now too, so peers that connect during startup receive it.
  room.addStream(s.stream);
}
async function start() {
  if (busy || session) return;
  setBusy(true);
  ui.error.hidden = true;
  ui.notice.textContent = '';
  ui.retry.hidden = true;
  ui.diagnostics.hidden = true;
  let stream = null;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error('insecure');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {echoCancellation:true, noiseSuppression:true, autoGainControl:true}, video:false
    });
    const servers = await turnServers();
    const imports = await Promise.allSettled(SIGNALS.map(async config => ({
      config, module: await import(config.url)
    })));
    const available = imports.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!available.length) throw Error('Both connection libraries failed to load.');
    const s = {
      stream, servers, rooms: new Map(), routes: new Map(), audios: new Map(),
      clientId: crypto.randomUUID(), turnAvailable: null,
      turnConfigured: servers.length > 0, brokerResult: null,
      connectionFailures: new Map(), stopMeter: null
    };
    session = s;
    for (const item of available) {
      try { attachStrategy(s, item.config, item.module); }
      catch (error) { console.warn('Signaling strategy unavailable:', item.config.name, error); }
    }
    if (!s.rooms.size) throw Error('No available signaling transport.');
    muted = false;
    ui.mute.setAttribute('aria-pressed', 'false');
    ui.muteLabel.textContent = 'MUTE MIC';
    ui.muteSymbol.textContent = '◖))';
    ui.inviteLabel.textContent = 'COPY LINK';
    ui.enableSound.hidden = true;
    ui.landing.hidden = true;
    ui.call.hidden = false;
    updateRoom(s);
    microphoneMeter(s);
    if (servers.length) {
      void checkTurn(servers).then(result => {
        if (session !== s) return;
        s.turnAvailable = result;
        if (!result && !activeRemoteAudioIds(s).size) {
          ui.notice.textContent = 'TURN credentials loaded, but your network could not establish a relay connection.';
          ui.diagnostics.hidden = false;
        }
      }).catch(error => console.warn('TURN diagnostic:', error));
    } else {
      s.turnAvailable = false;
      ui.notice.textContent = 'A TURN relay has not been configured by the site owner. Calls on separate Wi-Fi networks may not connect.';
      ui.diagnostics.hidden = false;
    }
    // 01 means nobody has completed a WebRTC connection. Check the public
    // broker path before assuming the other browser is simply absent.
    setTimeout(async () => {
      if (session !== s || uniqueRemoteIds(s).size) return;
      ui.connectionStatus.textContent = 'No other person connected yet';
      ui.retry.hidden = false;
      ui.diagnostics.hidden = false;
      ui.notice.textContent = 'Checking public relay access…';
      try {
        const access = await Promise.all(MQTT_BROKERS.map(testWebSocket));
        if (session !== s || uniqueRemoteIds(s).size) return;
        s.brokerResult = access.filter(Boolean).length;
        if (!s.brokerResult)
          ui.notice.textContent = 'Your browser cannot reach the public MQTT relays. Try disabling VPN or browser filters, or using mobile data.';
        else if (!s.turnConfigured)
          ui.notice.textContent = 'No TURN relay has been configured. Different networks may be unable to establish WebRTC, even when brokers respond.';
        else if (s.turnAvailable === false)
          ui.notice.textContent = 'Your configured TURN relay is unreachable. Check the credentials and your network.';
        else if (s.connectionFailures.size)
          ui.notice.textContent = 'Signaling responded but WebRTC negotiation failed. Copy the connection report.';
        else
          ui.notice.textContent = 'No peer connected. Both devices must use the same link and refresh. Copy diagnostics if it continues.';
      } catch (error) {
        console.warn('Relay check failed', error);
        if (session === s) ui.notice.textContent = 'Could not complete the connection test. Copy diagnostics for more details.';
      }
    }, 15000);
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (session === s) {
        ui.micStatus.textContent = 'MIC DISCONNECTED';
        ui.notice.textContent = 'Your microphone disconnected. Leave and start again.';
      }
    });
  } catch (error) {
    console.error('Voice start failed:', error);
    if (session) {
      const s = session;
      session = null;
      for (const room of s.rooms.values()) try { await room.leave(); } catch {}
      s.stopMeter?.();
    }
    stopMic(stream);
    ui.error.textContent = explain(error);
    ui.error.hidden = false;
  } finally { setBusy(false); }
}
async function leave() {
  const s = session;
  if (!s) return;
  session = null;
  ui.call.hidden = true;
  ui.landing.hidden = false;
  ui.enableSound.hidden = true;
  ui.retry.hidden = true;
  ui.diagnostics.hidden = true;
  ui.notice.textContent = '';
  ui.error.hidden = true;
  s.stopMeter?.();
  for (const key of [...s.audios.keys()]) removeAudio(s, key);
  stopMic(s.stream);
  await Promise.allSettled([...s.rooms.values()].map(room => room.leave()));
}
ui.start.addEventListener('click', () => void start());
ui.leave.addEventListener('click', () => void leave());
ui.retry.addEventListener('click', async () => {
  if (busy) return;
  await leave();
  await start();
});
ui.mute.addEventListener('click', () => {
  if (!session) return;
  muted = !muted;
  session.stream.getAudioTracks().forEach(track => track.enabled = !muted);
  ui.mute.setAttribute('aria-pressed', String(muted));
  ui.muteLabel.textContent = muted ? 'UNMUTE MIC' : 'MUTE MIC';
  ui.muteSymbol.textContent = muted ? '×' : '◖))';
  if (muted) ui.notice.textContent = 'Your microphone is muted. Press UNMUTE MIC to let the other person hear you.';
  else if (ui.notice.textContent.startsWith('Your microphone is muted')) ui.notice.textContent = '';
});
ui.diagnostics.addEventListener('click', async () => {
  const s = session;
  if (!s) return;
  const data = [
    'openline connection diagnostics / v4',
    'Routes loaded: ' + [...s.rooms.keys()].join(','),
    'MQTT brokers reachable: ' + (s.brokerResult === null ? 'unknown' : s.brokerResult + '/' + MQTT_BROKERS.length),
    'TURN relay candidate: ' + (!s.turnConfigured ? 'not configured' : s.turnAvailable === null ? 'checking' : s.turnAvailable ? 'yes' : 'no'),
    'WebRTC connection errors: ' + [...s.connectionFailures.entries()].map(([n, x]) => n + ':' + x).join(','),
    'Peer count: ' + uniqueRemoteIds(s).size,
    'Remote audio count: ' + activeRemoteAudioIds(s).size,
    'Microphone muted: ' + muted,
    'Browser: ' + navigator.userAgent
  ].join('\n');
  try {
    await navigator.clipboard.writeText(data);
    ui.notice.textContent = 'Diagnostic report copied. Paste it into our chat.';
  } catch { ui.notice.textContent = data.replaceAll('\n', ' | '); }
});
ui.invite.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); ui.inviteLabel.textContent = 'LINK COPIED'; }
  catch { ui.notice.textContent = 'Share this link: ' + location.href; }
});
ui.enableSound.addEventListener('click', async () => {
  const s = session;
  if (!s) return;
  const results = await Promise.allSettled([...s.audios.values()].map(audio => audio.play()));
  if (session !== s) return;
  if (results.every(result => result.status === 'fulfilled')) {
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
  for (const room of s.rooms.values()) void room.leave();
});
