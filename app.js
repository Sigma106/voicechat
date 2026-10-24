// Shared public peer-to-peer voice room: everyone using this link joins together.
const APP_ID='io.github.sigma106.voicechat.public.v1';
const ROOM_ID='everyone';
const $=id=>document.getElementById(id);
const el={landing:$('landing'),start:$('start'),startLabel:$('start-label'),error:$('error'),call:$('call'),heading:$('heading'),description:$('description'),people:$('people'),mute:$('mute'),muteLabel:$('mute-label'),invite:$('invite'),inviteLabel:$('invite-label'),leave:$('leave'),enableSound:$('enable-sound'),notice:$('notice'),audioContainer:$('audio-container')};
let session=null,busy=false,muted=false;
function stopMic(stream){stream?.getTracks().forEach(t=>t.stop())}
function setBusy(value){busy=value;el.start.disabled=value;el.startLabel.textContent=value?'Connecting…':'Start voice chat'}
function explain(e){
if(e?.name==='NotAllowedError')return 'Microphone permission was denied. Allow microphone access and try again.';
if(e?.name==='NotFoundError')return 'No microphone was found. Connect a microphone and try again.';
if(e?.name==='NotReadableError')return 'Your microphone is unavailable or in use by another app.';
if(e?.message==='insecure')return 'Please use the HTTPS GitHub Pages link for microphone access.';
return 'Could not connect. Check your internet connection and try again.';
}
function showPeople(s){
if(session!==s)return;
const n=s.peers.size,count=n+1;
el.people.textContent=count+' '+(count===1?'person':'people')+' in the room (including you)';
el.heading.textContent=n===0?'Waiting for others…':n===1?'Someone joined!':n+' people joined!';
el.description.textContent=n===0?"You're connected. Share this site with someone so they can join you.":'You can talk now. Everyone who joins this page enters the same voice room.';
}
function removeAudio(s,id){
const a=s.audios.get(id);if(!a)return;
a.pause();a.srcObject=null;a.remove();s.audios.delete(id);
}
function receiveAudio(s,stream,id){
if(session!==s)return;
removeAudio(s,id);
const a=document.createElement('audio');a.autoplay=true;a.playsInline=true;a.srcObject=stream;
el.audioContainer.appendChild(a);s.audios.set(id,a);
a.play().catch(()=>{if(session===s)el.enableSound.hidden=false});
}
async function start(){
if(busy||session)return;
setBusy(true);el.error.hidden=true;
let stream=null,room=null;
try{
if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw new Error('insecure');
stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
const {joinRoom}=await import('https://esm.sh/trystero@0.26.0?bundle');
room=joinRoom({appId:APP_ID},ROOM_ID);
const s={room,stream,peers:new Set(),audios:new Map()};
session=s;
room.onPeerJoin=id=>{
if(session!==s)return;
s.peers.add(id);showPeople(s);
try{Promise.resolve(room.addStream(stream,{target:id})).catch(console.error)}catch(err){console.error(err)}
};
room.onPeerLeave=id=>{if(session!==s)return;s.peers.delete(id);removeAudio(s,id);showPeople(s)};
room.onPeerStream=(remote,id)=>receiveAudio(s,remote,id);
await room.addStream(stream);
muted=false;el.mute.setAttribute('aria-pressed','false');el.muteLabel.textContent='Mute';
el.notice.textContent='';el.enableSound.hidden=true;el.inviteLabel.textContent='Copy link';
el.landing.hidden=true;el.call.hidden=false;showPeople(s);
}catch(e){
console.error('Voice connection failed:',e);
if(session?.room===room)session=null;
if(room)try{await room.leave()}catch(err){console.warn(err)}
stopMic(stream);el.error.textContent=explain(e);el.error.hidden=false;
}finally{setBusy(false)}
}
async function leave(){
const s=session;if(!s)return;
session=null;el.call.hidden=true;el.landing.hidden=false;el.error.hidden=true;
el.enableSound.hidden=true;el.notice.textContent='';
s.room.onPeerJoin=null;s.room.onPeerLeave=null;s.room.onPeerStream=null;
for(const id of s.audios.keys())removeAudio(s,id);
stopMic(s.stream);
try{await s.room.leave()}catch(e){console.warn(e)}
}
el.start.addEventListener('click',start);
el.leave.addEventListener('click',leave);
el.mute.addEventListener('click',()=>{
if(!session)return;
muted=!muted;session.stream.getAudioTracks().forEach(t=>t.enabled=!muted);
el.mute.setAttribute('aria-pressed',String(muted));
el.muteLabel.textContent=muted?'Unmute':'Mute';
el.notice.textContent=muted?'Your microphone is muted.':'';
});
el.invite.addEventListener('click',async()=>{
try{await navigator.clipboard.writeText(location.href);el.inviteLabel.textContent='Copied!';el.notice.textContent='Send this link to your friends so they can join.'}
catch{el.notice.textContent='Share this link: '+location.href}
});
el.enableSound.addEventListener('click',async()=>{
if(!session)return;
const results=await Promise.allSettled([...session.audios.values()].map(a=>a.play()));
if(results.every(r=>r.status==='fulfilled')){el.enableSound.hidden=true;el.notice.textContent=''}
else el.notice.textContent='Check your browser sound settings and try again.';
});
window.addEventListener('pagehide',()=>{
if(!session)return;
const s=session;session=null;stopMic(s.stream);void s.room.leave();
});
