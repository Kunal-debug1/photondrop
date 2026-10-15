import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { VERSION, randomTransferId, encodePacket, encodeManifest, toQrText, fromQrText } from './protocol.js';
import { Receiver } from './receiver.js';
import './style.css';
import './sw-register.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const state = { mode: 'home', file: null, transferId: null, timer: null, stream: null, scanTimer: null, scanCanvas: null, paused: false, started: 0, receivedAt: 0, frame: 0, received: new Receiver(), done: null, url: null, fps: 5, chunkSize: 900, maxBytes: 32 * 1024 * 1024 };
const fmt = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
function shell(content) { app.innerHTML = `<header class="top"><a class="brand" href="#" id="home"><span class="brand-icon">◈</span> PhotonDrop</a><span class="local-badge"><i></i> LOCAL & PRIVATE</span></header><main>${content}</main><footer>NO CLOUD · NO ACCOUNTS · NO RADIO</footer>`; $('#home')?.addEventListener('click', e => { e.preventDefault(); goHome(); }); }
function landing() {
 state.mode = 'home';
 shell(`<section class="hero"><div class="eyebrow">OFFLINE OPTICAL FILE TRANSFER</div><h1>Move files through<br><span>light.</span></h1><p>Private, direct, and entirely offline. Turn any screen into a bridge between your devices.</p><div class="role-grid"><button class="role-card" id="sender"><span class="role-icon">↑</span><strong>Send a file</strong><small>Choose a file and transmit it as animated QR frames.</small><span class="arrow">↗</span></button><button class="role-card" id="receiver"><span class="role-icon">⌗</span><strong>Receive a file</strong><small>Scan frames with your camera and rebuild the original.</small><span class="arrow">↗</span></button></div><button class="benchmark-link" id="benchmark">Run local QR decoder benchmark</button><div id="bench-result" class="muted"></div><div class="local-note"><span>◎</span><span><b>Your data stays on your devices.</b><br>Files are never uploaded. SHA-256 checks integrity, not identity or confidentiality.</span></div></section><section class="protocol-note"><span>01 / OPEN ON BOTH DEVICES</span><span>02 / SCAN EACH FRAME</span><span>03 / VERIFY & SAVE</span></section>`);
 $('#sender').onclick = senderPage; $('#receiver').onclick = receiverPage; $('#benchmark').onclick = runBenchmark;
}
function goHome() { cleanup(); state.received.reset(); state.done = null; state.file = null; landing(); }
function senderPage() {
 state.mode = 'sender';
 shell(`<section class="workspace"><button class="back" id="back">← Back</button><div class="eyebrow">SENDER MODE</div><h1>Send a file</h1><p class="sub">Select a file to prepare your optical transfer.</p><label class="drop" id="drop" tabindex="0" role="button"><input type="file" id="file"><span class="upload-icon">↑</span><b>Choose a file</b><small>or drop it here · any file type · up to 32 MB</small></label><div id="file-info"></div><div id="tx-panel"></div></section>`);
 $('#back').onclick = goHome; $('#file').onchange = e => e.target.files[0] && prepareFile(e.target.files[0]);
 const drop = $('#drop'); drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#file').click();}}); for (const ev of ['dragenter','dragover']) drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('hover')}); for (const ev of ['dragleave','drop']) drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('hover')}); drop.addEventListener('drop',e=>e.dataTransfer.files[0]&&prepareFile(e.dataTransfer.files[0]));
}
async function digest(file) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join(''); }
async function prepareFile(file) {
 cleanup(); if (file.size > state.maxBytes) { $('#file-info').innerHTML = `<p class="error">This file exceeds the 32 MB transfer limit.</p>`; return; }
 state.file = file; state.transferId = randomTransferId(); state.started = 0; state.frame = 0;
 $('#file-info').innerHTML = `<div class="file-row"><span class="file-symbol">▧</span><div><b>${escapeHtml(file.name)}</b><small>${fmt(file.size)} · Preparing secure checksum…</small></div><button id="remove" class="icon-button" aria-label="Remove file">×</button></div><div class="progress"><i style="width:0%"></i></div><p class="muted" id="tx-status">Computing SHA-256 locally…</p>`;
 $('#remove').onclick = senderPage;
 try {
  state.hash = await digest(file); state.chunkSize=Math.max(state.chunkSize,Math.ceil(file.size/50000)); const total = Math.ceil(file.size / state.chunkSize); state.manifest = { protocol: VERSION, name: file.name.slice(0,255), type: file.type || 'application/octet-stream', size:file.size, chunks:total, sha256:state.hash };
  state.manifestPacket = encodePacket({transferId:state.transferId,type:0,payload:encodeManifest(state.manifest)});
  $('#tx-status').textContent = `${total.toLocaleString()} data frames · ${state.chunkSize} B chunks · manifest repeats every cycle · 5 fps target`;
  $('#tx-panel').innerHTML = `<div class="qr-stage"><div class="qr-shell"><canvas id="qr" width="360" height="360" aria-label="Animated transfer QR code"></canvas></div><span class="frame-pill" id="frame-pill">READY</span></div><div class="progress-label"><span id="tx-progress">Ready to transmit</span><span id="tx-speed">—</span></div><div class="progress"><i id="tx-bar"></i></div><div class="controls"><button class="primary" id="start">Start transmission</button><button id="pause" disabled>Pause</button><button class="danger" id="cancel">Cancel</button></div><div class="settings"><label>Frame rate <select id="fps"><option value="3">3 fps · stable</option><option value="5" selected>5 fps · balanced</option><option value="8">8 fps · fast</option></select></label><label>QR density <select id="chunk-size"><option value="600">Low · 600 B</option><option value="900" selected>Balanced · 900 B</option><option value="1200">Fast · 1200 B</option></select></label></div><p class="tip">Keep this screen bright and visible. The receiver must scan every unique frame; missing frames repeat on the next cycle. No acknowledgements are possible without a return channel.</p>`;
  $('#fps').onchange=e=>state.fps=+e.target.value; $('#chunk-size').value=String(state.chunkSize<=600?600:state.chunkSize<=900?900:1200); $('#chunk-size').onchange=e=>{state.chunkSize=Math.max(+e.target.value,Math.ceil(file.size/50000));state.manifest.chunks=Math.ceil(file.size/state.chunkSize);state.manifestPacket=encodePacket({transferId:state.transferId,type:0,payload:encodeManifest(state.manifest)});$('#tx-status').textContent=`${state.manifest.chunks.toLocaleString()} data frames · ${state.chunkSize} B chunks · manifest repeats every cycle · ${state.fps} fps target`;};
  $('#start').onclick=startTx; $('#pause').onclick=togglePause; $('#cancel').onclick=goHome;
  await drawQr(toQrText(state.manifestPacket));
 } catch(e) { $('#tx-status').textContent=`Could not prepare file: ${e.message}`; }
}
function escapeHtml(s) { return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function drawQr(text) { const c=$('#qr'); if(c) await QRCode.toCanvas(c,text,{errorCorrectionLevel:'L',margin:2,width:360,color:{dark:'#071014',light:'#ffffff'}}); }
async function runBenchmark(){
 const button=$('#benchmark'),result=$('#bench-result');button.disabled=true;result.textContent='Synthetic local encode/decode test; this does not measure camera or screen loss…';
 try{const samples=20,source=toQrText(encodePacket({transferId:'1122334455667788',type:1,index:0,total:1,payload:crypto.getRandomValues(new Uint8Array(600))}));let successes=0;const start=performance.now(),canvas=document.createElement('canvas');
  for(let i=0;i<samples;i++){await QRCode.toCanvas(canvas,source,{errorCorrectionLevel:'L',margin:2,width:360});const ctx=canvas.getContext('2d',{willReadFrequently:true}),image=ctx.getImageData(0,0,canvas.width,canvas.height);if(jsQR(image.data,image.width,image.height,{inversionAttempts:'dontInvert'})?.data===source)successes++;}
  const elapsed=(performance.now()-start)/1000,heap=performance.memory?.usedJSHeapSize,sequence=Array.from({length:100},(_,i)=>i),delivered=sequence.filter(i=>i%5!==0).concat(sequence.filter(i=>i%5!==1));const recovered=new Set(delivered);result.textContent=`Synthetic QR: ${successes}/${samples} decodes · ${(samples/elapsed).toFixed(1)} encode+decode cycles/s · ${elapsed.toFixed(2)} s · ${heap?`${fmt(heap)} JS heap snapshot`:'memory API unavailable'}. Simulated 20% dropped per cycle with differing losses: ${recovered.size}/100 unique frames recovered across two repeated cycles. Camera loss still requires device testing.`;
 }catch(e){result.textContent=`Benchmark failed: ${e.message}`;}finally{button.disabled=false;}
}
async function startTx() {
 if(state.timer) return; state.paused=false; state.started ||= performance.now(); $('#start').disabled=true; $('#pause').disabled=false;
 const count=Math.ceil(state.file.size/state.chunkSize); let index=0; let last=0;
 let busy=false;
 state.timer=setInterval(async()=>{
  if(state.paused || busy) return;
  const now=performance.now(); if(now-last<1000/state.fps*.85)return; last=now; busy=true;
  try { let text;
   if(state.frame % (count+1)===0) text=toQrText(state.manifestPacket);
   else { const packet=encodePacket({transferId:state.transferId,type:1,index,total:count,payload:new Uint8Array(await state.file.slice(index*state.chunkSize,Math.min(state.file.size,(index+1)*state.chunkSize)).arrayBuffer())}); text=toQrText(packet); index=(index+1)%count; }
   state.frame++; await drawQr(text); const unique=Math.min(count,state.frame>0?Math.max(0,state.frame-1):0); $('#frame-pill').textContent=`FRAME ${state.frame}`; $('#tx-progress').textContent=`Cycle progress · ${count?Math.min(100,Math.round(index/count*100)):100}%`; $('#tx-bar').style.width=`${count?index/count*100:100}%`; $('#tx-speed').textContent=`${(state.frame/Math.max(.001,(now-state.started)/1000)).toFixed(1)} frames/s`;
  } catch(e) { $('#tx-status').textContent=`Transmission stopped: ${e.message}`; clearInterval(state.timer);state.timer=null; } finally {busy=false;}
 },40);
}
function togglePause() { state.paused=!state.paused; $('#pause').textContent=state.paused?'Resume':'Pause'; $('#frame-pill').textContent=state.paused?'PAUSED':`FRAME ${state.frame}`; }

async function receiverPage() {
 state.mode='receiver'; state.received=new Receiver({maxFileBytes:state.maxBytes});
 shell(`<section class="workspace"><button class="back" id="back">← Back</button><div class="eyebrow">RECEIVER MODE</div><h1>Receive a file</h1><p class="sub">Allow camera access to scan PhotonDrop frames. Your camera stays on this device.</p><div id="camera-error" role="status"></div><div class="camera-shell"><video id="video" playsinline muted></video><div class="scan-reticle"><i></i></div><div class="camera-hint" id="camera-hint">Camera preview appears here</div></div><div class="controls"><button class="primary" id="camera-start">Enable camera</button><button id="camera-stop" disabled>Stop camera</button><button class="danger" id="reset">Reset transfer</button></div><label class="settings camera-select">Camera <select id="camera-list" disabled><option>Use default camera</option></select></label><div class="receive-state" id="receive-state"><div class="receive-row"><span>Transfer</span><b>Waiting for first frame</b></div><div class="receive-row"><span>Unique chunks</span><b id="chunk-count">0 / —</b></div><div class="progress"><i id="rx-bar"></i></div><p class="muted" id="rx-status">Point the rear camera at the sender screen.</p><div id="completion"></div></div><details class="manual"><summary>Camera troubleshooting</summary><p>Camera access requires HTTPS (or localhost). Allow permission in your browser, use the rear camera, and keep both screens bright and steady. If access fails, check that another app is not using the camera.</p></details></section>`);
 $('#back').onclick=goHome; $('#camera-start').onclick=startCamera; $('#camera-stop').onclick=stopCamera; $('#reset').onclick=()=>{state.received.reset();state.done=null;state.receivedAt=0;$('#completion').innerHTML='';$('#chunk-count').textContent='0 / —';$('#rx-bar').style.width='0%';$('#rx-status').textContent='Transfer reset. Waiting for frames.'}; $('#camera-list').onchange=()=>{if(state.stream){stopCamera();startCamera();}};
 try { const list=await navigator.mediaDevices.enumerateDevices(); const cams=list.filter(x=>x.kind==='videoinput'); $('#camera-list').innerHTML=cams.map((c,i)=>`<option value="${escapeHtml(c.deviceId)}">${escapeHtml(c.label||`Camera ${i+1}`)}</option>`).join('')||'<option value="">Default camera</option>'; $('#camera-list').disabled=false; } catch {}
}
async function startCamera() {
 if(!navigator.mediaDevices?.getUserMedia){$('#camera-error').innerHTML='<p class="error">Camera API unavailable. Open this app over HTTPS or localhost in a supported browser.</p>';return;}
 try { state.stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:$('#camera-list').value?{exact:$('#camera-list').value}:undefined,facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false}); const v=$('#video');v.srcObject=state.stream;await v.play();$('#camera-start').disabled=true;$('#camera-stop').disabled=false;$('#camera-hint').hidden=true;scanLoop();
  const cams=(await navigator.mediaDevices.enumerateDevices()).filter(x=>x.kind==='videoinput'); $('#camera-list').innerHTML=cams.map((c,i)=>`<option value="${escapeHtml(c.deviceId)}">${escapeHtml(c.label||`Camera ${i+1}`)}</option>`).join('');
 } catch(e) { $('#camera-error').innerHTML=`<p class="error">Camera could not start: ${escapeHtml(e.message)}. Check browser permission and HTTPS, then retry.</p>`; }
}
function scanLoop() {
 const v=$('#video'); if(!v || v.paused || v.readyState<2){state.scanTimer=setTimeout(scanLoop,300);return;}
 const c=state.scanCanvas ||= document.createElement('canvas');c.width=Math.min(960,v.videoWidth);c.height=Math.round(c.width*v.videoHeight/v.videoWidth);const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(v,0,0,c.width,c.height);const image=x.getImageData(0,0,c.width,c.height);const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});
 if(code){try{const frame=fromQrText(code.data),before=state.received.chunks.size,status=state.received.accept(frame);if(frame.type===1&&state.received.chunks.size>before&&!state.receivedAt)state.receivedAt=performance.now();$('#chunk-count').textContent=`${status.received.toLocaleString()} / ${status.total.toLocaleString()||'—'}`;$('#rx-bar').style.width=`${status.percent}%`;const elapsed=state.receivedAt?(performance.now()-state.receivedAt)/1000:0,rate=elapsed?status.received/elapsed:0,byteRate=elapsed?state.received.bytes/elapsed:0,eta=rate&&status.total>status.received?Math.ceil((status.total-status.received)/rate):null;$('#rx-status').textContent=status.ready?'All unique chunks received; checking SHA-256…':status.total&&rate?`${rate.toFixed(1)} unique chunks/s · ${fmt(byteRate)}/s avg payload · estimated ${eta}s remaining`:(frame.type===0?'Transfer metadata received. Scanning chunks…':'Valid frame decoded.');if(status.ready&&!state.done)completeReceive();}catch(e){$('#rx-status').textContent=e.message;}}
 state.scanTimer=setTimeout(scanLoop,160);
}
async function completeReceive(){try{state.done=await state.received.finish();stopCamera();const {blob,sha256,manifest}=state.done;const url=URL.createObjectURL(blob);state.url=url;const seconds=state.receivedAt?Math.max(.001,(performance.now()-state.receivedAt)/1000):0,duration=Math.round(seconds),throughput=blob.size/seconds;$('#completion').innerHTML=`<div class="complete"><span>✓</span><div><b>Integrity verified</b><small>${escapeHtml(manifest.name)} · ${fmt(blob.size)} · ${duration}s · ${fmt(throughput)}/s average · SHA-256 ${sha256.slice(0,16)}…</small></div></div><a class="primary download" href="${url}" download="${escapeHtml(manifest.name)}">Save recovered file</a><p class="muted">SHA-256 confirms data integrity. It does not prove who sent the file or encrypt its contents.</p>`;$('#rx-status').textContent='Every chunk received and SHA-256 matched.';}catch(e){$('#rx-status').textContent=e.message;}}
function stopCamera(){if(state.scanTimer){clearTimeout(state.scanTimer);state.scanTimer=null;}state.stream?.getTracks().forEach(t=>t.stop());state.stream=null;const v=$('#video');if(v)v.srcObject=null;if($('#camera-start')){$('#camera-start').disabled=false;$('#camera-stop').disabled=true;}}
function cleanup(){if(state.timer){clearInterval(state.timer);state.timer=null;}stopCamera();if(state.url){URL.revokeObjectURL(state.url);state.url=null;}}
window.addEventListener('pagehide',cleanup); document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='sender'&&state.timer){state.paused=true; if($('#pause'))$('#pause').textContent='Resume';}else if(document.hidden&&state.mode==='receiver'&&state.stream){stopCamera();if($('#rx-status'))$('#rx-status').textContent='Camera stopped while app is in background. Resume scanning when visible.';}});
landing();
