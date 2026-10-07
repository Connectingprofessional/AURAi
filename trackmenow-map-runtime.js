/* TrackMeNow — immersive map runtime
 * Functional parity layer inspired by modern live-intelligence map behavior.
 * No third-party branding, account gates, private feeds, or copied application code.
 */
(function(){
'use strict';
const API=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?location.origin:'https://wispy-bush-9aee.recreationeeraj.workers.dev';
let m=null, ready=false, locateWatch=null, moveTimer=null, cameraPopup=null;
const $=s=>document.querySelector(s);
function map(){return window.map||window.maplibre||null}
function esc(v){return String(v==null?'':v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function api(path,opt){return fetch(API+path,Object.assign({cache:'no-store'},opt||{})).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'HTTP '+r.status);return j})}
function addUi(){
 if($('#tm-map-runtime'))return;
 const root=document.createElement('div');root.id='tm-map-runtime';
 root.innerHTML='<div class="tmr-tools">'+
 '<button data-a="locate" title="Use my current GPS location">◎</button>'+
 '<button data-a="north" title="Reset north">N</button>'+
 '<button data-a="pitch" title="Toggle 3D pitch">3D</button>'+
 '<button data-a="full" title="Fullscreen map">⛶</button></div>'+
 '<div class="tmr-readout"><span id="tmr-coord">MAP READY</span><span id="tmr-zoom">Z 0.0</span><span id="tmr-bearing">B 0°</span></div>';
 document.body.append(root);
 root.addEventListener('click',e=>{const a=e.target.closest('[data-a]')?.dataset.a;if(!a)return;
  if(a==='locate')locate(); if(a==='north'&&m)m.easeTo({bearing:0,duration:450}); if(a==='pitch'&&m)m.easeTo({pitch:m.getPitch()>10?0:48,duration:550}); if(a==='full')toggleFull();
 });
}
function toggleFull(){const target=$('#map');if(!document.fullscreenElement)target?.requestFullscreen?.();else document.exitFullscreen?.()}
function updateReadout(){
 if(!m)return;const c=m.getCenter(),z=m.getZoom();
 const q=$('#tmr-coord');if(q)q.textContent=c.lat.toFixed(4)+'°, '+c.lng.toFixed(4)+'°';
 const zz=$('#tmr-zoom');if(zz)zz.textContent='Z '+z.toFixed(1);
 const bb=$('#tmr-bearing');if(bb)bb.textContent='B '+Math.round(m.getBearing())+'°';
}
function locate(){
 if(!navigator.geolocation){setRuntime('GPS unavailable in this browser',false);return}
 setRuntime('REQUESTING LIVE GPS…',true);
 navigator.geolocation.getCurrentPosition(p=>{
   if(!m)return;
   m.flyTo({center:[p.coords.longitude,p.coords.latitude],zoom:Math.max(14,m.getZoom()),pitch:Math.max(25,m.getPitch()),duration:900});
   setRuntime('GPS · '+p.coords.latitude.toFixed(6)+', '+p.coords.longitude.toFixed(6)+' · ±'+Math.round(p.coords.accuracy||0)+'m',true);
 },e=>setRuntime('GPS · '+(e.message||'permission denied'),false),{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}
function setRuntime(msg,ok){const q=$('#tmr-coord');if(q){q.textContent=msg;q.style.color=ok===false?'#ff8d98':''}}
function reverse(lat,lon){
 return fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat='+encodeURIComponent(lat)+'&lon='+encodeURIComponent(lon)+'&zoom=18&addressdetails=1',{headers:{Accept:'application/json'}}).then(r=>r.ok?r.json():null).catch(()=>null);
}
async function mapClick(e){
 const lat=e.lngLat.lat,lon=e.lngLat.lng;
 setRuntime(lat.toFixed(5)+'°, '+lon.toFixed(5)+'° · resolving…',true);
 const data=await reverse(lat,lon);
 const name=data?.display_name||'No place name returned';
 new maplibregl.Popup({closeButton:true,maxWidth:'330px'})
  .setLngLat([lon,lat])
  .setHTML('<div class="tmr-popup"><b>LOCATION</b><div>'+esc(name)+'</div><small>'+lat.toFixed(6)+', '+lon.toFixed(6)+'</small><button id="tmr-copy">COPY COORDINATES</button></div>')
  .addTo(m);
 setTimeout(()=>{const b=$('#tmr-copy');if(b)b.onclick=()=>navigator.clipboard?.writeText(lat.toFixed(6)+', '+lon.toFixed(6));},0);
}
function installCameraDetail(){
 if(!m||!m.getLayer('tm-cameras')||m.__tmCameraDetail)return;
 m.__tmCameraDetail=true;
 m.on('click','tm-cameras',async e=>{
  const f=e.features?.[0];if(!f)return;const p=f.properties||{};
  if(cameraPopup)cameraPopup.remove();
  const src=p.imageUrl||p.streamUrl||p.sourceUrl||'';
  cameraPopup=new maplibregl.Popup({closeButton:true,maxWidth:'380px'}).setLngLat(e.lngLat)
   .setHTML('<div class="tmr-camera"><b>'+esc(p.title||'PUBLIC CAMERA')+'</b><div>'+esc(p.provider||p.source||'Public source')+'</div>'+
    (p.location?'<div>'+esc(p.location)+'</div>':'')+
    (src?'<button id="tmr-camera-open">OPEN SOURCE</button>':'')+
    '<small>Observed '+esc(p.observedAt?new Date(p.observedAt).toLocaleString():'source timestamp unavailable')+'</small></div>').addTo(m);
  setTimeout(()=>{const b=$('#tmr-camera-open');if(b)b.onclick=()=>window.open(src,'_blank','noopener,noreferrer')},0);
 });
}
function syncHash(){
 if(!m)return;
 const c=m.getCenter();
 history.replaceState(null,'','#map='+c.lat.toFixed(5)+','+c.lng.toFixed(5)+','+m.getZoom().toFixed(2)+','+m.getBearing().toFixed(1)+','+m.getPitch().toFixed(1));
}
function restoreHash(){
 const h=location.hash.match(/^#map=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)$/);
 if(h&&m)m.jumpTo({center:[+h[2],+h[1]],zoom:+h[3],bearing:+h[4],pitch:+h[5]});
}
function refreshViewportFeeds(){
 if(window.TrackMeNowEngine?.refreshViewport)window.TrackMeNowEngine.refreshViewport();
}
function readyMap(){
 m=map();if(!m||ready)return false;
 if(!m.isStyleLoaded?.())return false;
 ready=true;addUi();restoreHash();updateReadout();
 m.on('move',()=>{updateReadout();clearTimeout(moveTimer);moveTimer=setTimeout(syncHash,350)});
 m.on('click',mapClick);
 m.on('load',()=>{installCameraDetail();refreshViewportFeeds()});
 m.on('idle',()=>installCameraDetail());
 setInterval(()=>{if(document.visibilityState==='visible')refreshViewportFeeds()},120000);
 document.addEventListener('keydown',e=>{
  if(e.target.matches('input,textarea'))return;
  if(e.key.toLowerCase()==='l')locate();
  if(e.key.toLowerCase()==='n')m.easeTo({bearing:0,duration:300});
  if(e.key==='3')m.easeTo({pitch:m.getPitch()>10?0:48,duration:400});
 });
 return true;
}
function injectCss(){
 if($('#tm-map-runtime-css'))return;
 const s=document.createElement('style');s.id='tm-map-runtime-css';s.textContent=
 '#tm-map-runtime{position:fixed;right:12px;top:60px;z-index:5500;pointer-events:none;font:9px ui-monospace,SFMono-Regular,Consolas,monospace}'+
 '.tmr-tools{display:flex;gap:4px;justify-content:flex-end;pointer-events:auto}'+
 '.tmr-tools button{width:31px;height:29px;border:1px solid rgba(180,220,240,.18);border-radius:6px;background:rgba(4,9,14,.78);color:#d8edf4;font:800 9px ui-monospace;cursor:pointer;backdrop-filter:blur(10px)}'+
 '.tmr-tools button:hover{background:rgba(69,168,255,.2)}'+
 '.tmr-readout{margin-top:5px;display:flex;gap:8px;justify-content:flex-end;color:#8fa7b2;text-shadow:0 1px 4px #000}'+
 '.tmr-popup,.tmr-camera{font:11px system-ui;color:#dceaf0}.tmr-popup b,.tmr-camera b{display:block;margin-bottom:6px}.tmr-popup small,.tmr-camera small{display:block;margin-top:7px;color:#78909c}.tmr-popup button,.tmr-camera button{margin-top:9px;border:1px solid #5aa7cf;background:#0b1822;color:#dff6ff;border-radius:4px;padding:5px 8px;font-size:10px}';
 document.head.append(s);
}
function boot(){
 injectCss();
 const timer=setInterval(()=>{if(readyMap())clearInterval(timer)},250);
 setTimeout(()=>clearInterval(timer),20000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();