const map=L.map('map',{zoomControl:true,preferCanvas:true}).setView([20,0],3);
const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'}).addTo(map);
const labels=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'}).addTo(map);
const streets=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'});
const terrain=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{y}/{x}.png',{maxZoom:17,attribution:'© OpenTopoMap contributors'});
L.control.layers({Map:streets,Satellite:satellite,Terrain:terrain},{'Satellite labels':labels},{collapsed:true,position:'bottomright'}).addTo(map);
const status=document.getElementById('status'),search=document.getElementById('search');
const selected=new Set(['flights']); const layerGroups=new Map(); let marker,accuracy,trail,sessionId,watchId; const trailPoints=[];
const icons={flight:'✈',transit:'●',camera:'📷'};
function clearLayer(name){const g=layerGroups.get(name);if(g){g.clearLayers();map.removeLayer(g);layerGroups.delete(name)}}
function drawFeatures(fc){
  for(const [name,g] of layerGroups) if(selected.has(name)) { g.clearLayers(); map.removeLayer(g); layerGroups.delete(name); }
  for(const f of fc.features||[]){
    const p=f.properties||{}, name=p.category==='flight'?'flights':p.category==='camera'?'cameras':(p.mode==='transit'?'transit':'other');
    if(name==='other') continue;
    const logical=name==='transit'?(selected.has('bus')||selected.has('rail')?'transit':null):name;
    if(!logical) continue;
    const coords=f.geometry?.coordinates; if(!coords) continue;
    let g=layerGroups.get(logical); if(!g) {g=L.layerGroup().addTo(map);layerGroups.set(logical,g)}
    const label=p.callsign||p.label||p.vehicle_id||p.name||p.source||logical;
    const html='<b>'+icons[p.category]+'</b> '+String(label).replace(/[<>]/g,'')+'<br><small>'+String(p.source||'public feed').replace(/[<>]/g,'')+'</small>';
    L.circleMarker([coords[1],coords[0]],{radius:p.category==='flight'?5:4,weight:1,fillOpacity:.85}).bindPopup(html).addTo(g);
  }
}
async function loadMovement(){
  const b=map.getBounds(), bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',');
  if(!selected.size)return;
  status.textContent='MAP · LOADING LIVE SOURCES…';
  try{
    const r=await fetch('/api/movement?bbox='+encodeURIComponent(bbox)+'&layers='+encodeURIComponent([...selected].join(',')));
    const data=await r.json(); drawFeatures(data);
    const live=(data.sources||[]).filter(s=>s.status==='live').length;
    status.textContent='MAP · '+live+' LIVE SOURCES · '+new Date().toLocaleTimeString();
  }catch(e){status.textContent='MAP · FEED ERROR'}
}
let moveTimer; map.on('moveend',()=>{clearTimeout(moveTimer);moveTimer=setTimeout(loadMovement,250)}); setInterval(loadMovement,30000);
document.querySelectorAll('.layer').forEach(btn=>btn.onclick=()=>{const l=btn.dataset.layer;if(selected.has(l)){selected.delete(l);btn.classList.remove('on')}else{selected.add(l);btn.classList.add('on')}loadMovement()});
async function createSession(){const r=await fetch('/api/sessions',{method:'POST'});if(!r.ok)throw Error('Unable to create tracking session');return(await r.json()).id}
async function sendPoint(p){if(sessionId)await fetch('/api/sessions/'+sessionId+'/location',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)})}
function renderPosition(pos){const c=[pos.coords.latitude,pos.coords.longitude];if(!marker)marker=L.marker(c).addTo(map);else marker.setLatLng(c);if(!accuracy)accuracy=L.circle(c,{radius:pos.coords.accuracy||0,weight:1}).addTo(map);else accuracy.setLatLng(c).setRadius(pos.coords.accuracy||0);trailPoints.push(c);if(!trail)trail=L.polyline(trailPoints,{weight:4}).addTo(map);else trail.setLatLngs(trailPoints);map.setView(c,Math.max(map.getZoom(),16),{animate:true});status.textContent='GPS · ±'+Math.round(pos.coords.accuracy||0)+' m · '+new Date().toLocaleTimeString()}
document.getElementById('gpsBtn').onclick=async()=>{const btn=document.getElementById('gpsBtn');if(watchId!=null){navigator.geolocation.clearWatch(watchId);watchId=null;if(sessionId)fetch('/api/sessions/'+sessionId+'/stop',{method:'POST'});btn.textContent='Locate Me';btn.classList.remove('stop');status.textContent='MAP · GPS OFF';return}if(!navigator.geolocation)return alert('Browser GPS is unavailable.');try{sessionId=await createSession()}catch(e){return alert(e.message)}watchId=navigator.geolocation.watchPosition(pos=>{renderPosition(pos);sendPoint({lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy,altitude:pos.coords.altitude,heading:pos.coords.heading,speed:pos.coords.speed,timestamp:new Date(pos.timestamp).toISOString()})},err=>status.textContent='GPS · '+err.message,{enableHighAccuracy:true,maximumAge:3000,timeout:15000});btn.textContent='Stop GPS';btn.classList.add('stop')};
async function searchPlace(){const q=search.value.trim();if(!q)return;const coord=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);if(coord){const c=[+coord[1],+coord[2]];map.setView(c,16);L.marker(c).addTo(map).bindPopup('Search result').openPopup();return}const r=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q='+encodeURIComponent(q));const d=await r.json();if(!d[0])return alert('No place result found.');const c=[+d[0].lat,+d[0].lon];map.setView(c,15);L.marker(c).addTo(map).bindPopup(d[0].display_name).openPopup();loadMovement()}
document.getElementById('searchBtn').onclick=searchPlace;search.addEventListener('keydown',e=>{if(e.key==='Enter')searchPlace()});
loadMovement();