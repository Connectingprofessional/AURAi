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
function addUi(){ return; }
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
 ready=true;restoreHash();
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
function injectCss(){ return; }
function boot(){ const timer=setInterval(()=>{if(readyMap())clearInterval(timer)},250); setTimeout(()=>clearInterval(timer),20000); }
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();