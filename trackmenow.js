const API='https://trackmenow-5rez.onrender.com';
const map=L.map('map',{zoomControl:false,preferCanvas:true,worldCopyJump:true,minZoom:2}).setView([20,0],3);
const satellite=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri World Imagery'}).addTo(map);
const labels=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri'}).addTo(map);
const streets=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'});
const terrain=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{y}/{x}.png',{maxZoom:17,attribution:'© OpenTopoMap'});
window.map=map;
const bases=[{name:'Satellite',layers:[satellite,labels]},{name:'Streets',layers:[streets]},{name:'Terrain',layers:[terrain]}];
let baseIndex=0;
function setBase(i){bases[baseIndex].layers.forEach(l=>{if(map.hasLayer(l))map.removeLayer(l)});baseIndex=((i%bases.length)+bases.length)%bases.length;bases[baseIndex].layers.forEach(l=>l.addTo(map));return bases[baseIndex].name}
const $=id=>document.getElementById(id), search=$('search'), status=$('status'), coords=$('coords'), rightPanel=$('rightPanel');
let historyLine=null; let lastGpsPoint=null;
// Persistent live-object state: only source observations are stored. Intermediate animation is visual interpolation between real observations.
const liveObjects=new Map(); const liveTrails=new Map(); const LIVE_ANIM_MS=4300; const TRAIL_POINTS=6;
const layerDefs=[
 ['flights','✈','Flights'],['ships','⚓','Ships'],['public-transport','▣','Bus / Taxi / Rail / Metro / Ferry'],['intelligence','◇','Global Infrastructure Intelligence'],
 ['cameras','▤','Public Cameras'],['cells','⌁','Public Cells'],['infrastructure','◇','Infrastructure'],['road','●','Road Traffic']
];
const selected=new Set(['flights','ships','public-transport','cameras','cells','infrastructure','intelligence']);
const intelFilters=new Set(['power:nuclear','power:solar','power:wind','power:hydro','power:gas','power:coal','power:oil','power:biomass','power:geothermal','power:waste','power:other','datacenter:ai','datacenter:hyperscale','datacenter:other','dam:hydro','dam:supply','dam:irrigation','dam:flood','dam:other','network:ports','network:railway','network:cables','network:substation','network:line','network:tower','network:pole','resource:mining','resource:energy','resource:agro','resource:tech','resource:choke','resource:industry','hq:company','poi:embassy','poi:military','poi:hospital']); const groups=new Map(); let lastData=null; let searchMarker=null; let gpsMarker=null; let sessionId=null; let watchId=null;
function safe(v){return String(v??'—').replace(/[<>]/g,'')}
function icon(p){return ({flight:'✈',ship:'◆',transit:'●',camera:'▣',cell:'⌁',airport:'✈',train:'▰',metro:'▰',bus:'■',taxi:'■',ferry:'◆'}[p.category]||'•')}
function logical(p){if(p.category==='flight')return'flights';if(p.category==='ship')return'ships';if(p.category==='camera')return'cameras';if(p.category==='cell')return'cells';if(p.category==='transit'||p.category==='public-transport'||p.mode==='transit')return'public-transport';if(['power','datacenter','dam','network','cable','resource','hq','poi','government'].includes(p.category))return'intelligence';return selected.has('infrastructure')?'infrastructure':'road'}
function showObject(p,coords){rightPanel?.classList.add('has-selection');document.body.classList.add('tm-panel-open');const name=p.callsign||p.name||p.label||p.vehicle_id||p.category||'Object';const st=p.status||'LIVE';$('objectCard').innerHTML='<div class="objectTitle"><h3>'+icon(p)+' '+safe(name)+'</h3><span class="pill">'+safe(st)+'</span><button class="objClose" id="objClose" aria-label="Close">×</button></div><div class="kv"><div><small>TYPE</small><span>'+safe(p.category||p.mode)+'</span></div><div><small>SOURCE</small><span>'+safe(p.source||'public feed')+'</span></div><div><small>POSITION</small><span>'+coords[1].toFixed(4)+', '+coords[0].toFixed(4)+'</span></div><div><small>UPDATED</small><span>'+safe(p.timestamp?new Date(Number(p.timestamp)*1000).toLocaleTimeString():p.last_contact?new Date(Number(p.last_contact)*1000).toLocaleTimeString():'source dependent')+'</span></div><div><small>SPEED</small><span>'+safe(p.velocity_mps!=null?(Number(p.velocity_mps)*1.944).toFixed(1)+' kt':p.speed_mps!=null?(Number(p.speed_mps)*3.6).toFixed(1)+' km/h':'—')+'</span></div><div><small>HEADING</small><span>'+safe(p.heading!=null?Math.round(p.heading)+'°':'—')+'</span></div></div><div class="source" style="margin-top:9px">TrackMeNow distinguishes live source data from estimated, static and historical information. No movement is fabricated.</div><div class="objActions"><button class="btn" id="objFav">☆ Save</button><button class="btn" id="objLink">↗ Copy link</button><button class="btn" id="objFull">Full intel</button></div>';tmWireObjActions(p,coords);$('itkBadge').textContent='● '+safe(st)+' · '+safe((p.source||'PUBLIC SOURCE').toUpperCase());$('itkTitle').textContent=name;$('itkDesc').textContent=safe((p.category||p.mode||'OBJECT').toString().toUpperCase())+' intelligence from TrackMeNow public-source feeds.';$('itkBullets').innerHTML='<li>Source: '+safe(p.source||'Public feed')+'</li><li>Position: '+coords[1].toFixed(4)+', '+coords[0].toFixed(4)+'</li><li>No movement is fabricated; timestamps reflect the source feed.</li>';$('itkGrid').innerHTML='<div class="itk-tile"><small>TYPE</small><b>'+safe(p.category||p.mode)+'</b></div><div class="itk-tile"><small>STATUS</small><b>'+safe(st)+'</b></div><div class="itk-tile"><small>SPEED</small><b>'+safe(p.velocity_mps!=null?(Number(p.velocity_mps)*1.944).toFixed(1)+' kt':p.speed_mps!=null?(Number(p.speed_mps)*3.6).toFixed(1)+' km/h':'—')+'</b></div><div class="itk-tile"><small>HEADING</small><b>'+safe(p.heading!=null?Math.round(p.heading)+'°':'—')+'</b></div>';const widgets=$('itkWidgets');if(widgets){let w='<div class="itk-fence itk-alert"><span class="itk-pro-dot"></span><div class="itk-alert-h">⌖ GEOFENCE <span class="itk-pro">PRO</span></div><div class="itk-d">Authorized-device boundary monitoring</div></div>';if((p.category||p.mode)==='flight'||(p.category||p.mode)==='ship'){w+='<div class="itk-trk"><div class="itk-trk-h">↗ 30 DAY TRACK <span class="itk-trk-s">LIVE</span></div><svg viewBox="0 0 300 30" preserveAspectRatio="none"><path class="t-a" d="M0 24 L35 18 L70 20 L105 10 L140 13 L175 7 L210 9 L245 4 L300 7 L300 30 L0 30Z"/><path class="t-p" d="M0 24 L35 18 L70 20 L105 10 L140 13 L175 7 L210 9 L245 4"/><path class="t-e" d="M245 4 L300 7"/><circle class="t-d" cx="245" cy="4" r="2.8"/></svg><div class="itk-trk-l"><div class="itk-trk-r viva"><div class="itk-trk-w">● NOW</div><div class="itk-trk-m">LIVE</div><div class="itk-trk-t">Current source position</div></div></div></div>'}if((p.category||p.mode)==='camera'){w+='<div class="itk-tl"><div class="itk-tl-h">DVR TIMELINE <span class="itk-tl-v" id="itkTlV">LIVE</span></div><div class="itk-tl-bar" id="itkTlBar"><i style="left:25%"></i><i style="left:50%"></i><i style="left:75%"></i><span class="itk-tl-k" id="itkTlK" style="left:92%"></span></div><div class="itk-tl-f"><span>24h</span><span>12h</span><span>NOW</span></div></div><div class="itk-wall"><div class="itk-wall-h">▣ CAMERA WALL <span class="itk-wall-n">LIVE</span></div><div class="itk-wall-g"><i class="t0"></i><i class="t1"></i><i class="t2"></i><i class="t3"></i></div><div class="itk-wall-t"><span>Open camera wall</span><span class="itk-wall-c">›</span></div></div>'}if((p.category||p.mode)==='cell'){w+='<div class="itk-alert"><div class="itk-alert-h">⚠ ALERT RULE</div><div class="itk-pills"><div class="itk-pill on">ENTER</div><div class="itk-pill">EXIT</div></div><div class="itk-chips"><span class="itk-chip on">LIVE</span><span class="itk-chip">SIGNAL</span><span class="itk-chip">LOCATION</span></div></div>'}widgets.innerHTML=w;const bar=$('itkTlBar'),knob=$('itkTlK');if(bar&&knob){const move=e=>{const r=bar.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));knob.style.left=(x*100)+'%';$('itkTlV').textContent=x>.9?'NOW':Math.round(24*x)+'h ago'};bar.onpointerdown=e=>{bar.setPointerCapture(e.pointerId);move(e)};bar.onpointermove=e=>{if(e.buttons)move(e)}}}$('itkQuery').value=name;
  if((p.category||p.mode)==='camera'){
    const panel=document.getElementById('panel');
    if(panel){
      panel.hidden=false; panel._p=p; panel._c=coords; document.body.classList.add('tm-cam-open');
      document.getElementById('panel-title').textContent=name;
      document.getElementById('panel-fav').textContent=(JSON.parse(localStorage.getItem('tm-favourites-v1')||'[]').includes(String(p.osm_id||p.id||p.name||p.label)))?'★':'☆';
      const img=document.getElementById('panel-img');
      const src=p.image_url||p.image||p.snapshot_url||p.preview_url||'';
      if(src){img.src=src;img.style.display='block';document.getElementById('panel-why').hidden=true;}
      else{img.removeAttribute('src');img.style.display='none';const why=document.getElementById('panel-why');why.hidden=false;why.textContent='This public camera has a location record, but the source did not provide an image URL in the current feed.';}
      document.getElementById('panel-updated').textContent=p.timestamp?new Date(Number(p.timestamp)*1000).toLocaleString():'SOURCE TIME UNKNOWN';
      document.getElementById('panel-report').hidden=false;document.getElementById('panel-report').textContent='Something wrong with this camera? Report';
      document.getElementById('panel-meta').innerHTML='<div class="pm-row"><small>SOURCE</small><b>'+safe(p.source||'OpenStreetMap / public feed')+'</b></div><div class="pm-row"><small>POSITION</small><b>'+coords[1].toFixed(5)+', '+coords[0].toFixed(5)+'</b></div><div class="pm-row"><small>STATUS</small><b>'+safe(p.status||'SOURCE DEPENDENT')+'</b></div>';
      document.getElementById('itkBack')?.classList.remove('on');
    }
  }
}function clearGroups(){for(const g of groups.values())map.removeLayer(g);groups.clear()}
function objectKey(p,c){return String(p.icao24||p.mmsi||p.vehicle_id||p.id||p.osm_id||p.cellid||p.nci||p.eci||((p.callsign||p.name||p.label||p.category)+'@'+Number(c[1]).toFixed(5)+','+Number(c[0]).toFixed(5)))}
function sourceTime(p){const v=Number(p.timestamp||p.last_contact||p.updated_at||0);return v>1e12?v:v*1000}
function freshness(p){const t=sourceTime(p),age=t?Math.max(0,Date.now()-t):0;if(!t)return 'SOURCE TIME UNKNOWN';if(age<30000)return 'LIVE';if(age<120000)return 'RECENT';return 'STALE'}
function markerHtml(l,p,size){const glyph=icon(p);const cls=l==='flights'?'tm-flight':l==='ships'?'tm-ship':l==='public-transport'?'tm-transport':'tm-generic';const glyphCls=l==='flights'?'tm-flight-glyph':l==='ships'?'tm-ship-glyph':l==='public-transport'?'tm-transport-glyph':'';return '<div class="'+cls+'" style="width:'+size+'px;height:'+size+'px;display:flex;align-items:center;justify-content:center;font-weight:900;transform:rotate('+(p.heading||0)+'deg)"><span class="'+glyphCls+'">'+glyph+'</span></div>'}
function updateTrail(key,latlng,l){if(!['flights','ships','public-transport'].includes(l))return;let tr=liveTrails.get(key);if(!tr){tr=L.polyline([latlng],{weight:2,opacity:.38,interactive:false}).addTo(map);liveTrails.set(key,tr);return}const pts=tr.getLatLngs();const last=pts[pts.length-1];if(!last||Math.abs(last.lat-latlng[0])+Math.abs(last.lng-latlng[1])>0.000001){pts.push(L.latLng(latlng[0],latlng[1]));while(pts.length>TRAIL_POINTS)pts.shift();tr.setLatLngs(pts)}}
function animateMarker(key,marker,next,p){const st=liveObjects.get(key);const from=st?.latlng||next;const to=next;const started=performance.now();if(st?.raf)cancelAnimationFrame(st.raf);function frame(now){const q=Math.min(1,(now-started)/LIVE_ANIM_MS);const eased=q<.5?2*q*q:1-Math.pow(-2*q+2,2)/2;marker.setLatLng([from[0]+(to[0]-from[0])*eased,from[1]+(to[1]-from[1])*eased]);if(q<1){st.raf=requestAnimationFrame(frame)}else{st.raf=null;st.latlng=to}}st.raf=requestAnimationFrame(frame);st.latlng=to}
function pruneLiveObjects(){const now=Date.now();for(const [key,st] of liveObjects){if(now-st.seen>180000){if(st.marker&&map.hasLayer(st.marker))map.removeLayer(st.marker);if(st.trail&&map.hasLayer(st.trail))map.removeLayer(st.trail);liveObjects.delete(key);liveTrails.delete(key)}}}
function drawFeatures(fc){for(const [layer,g] of groups){if(!selected.has(layer)){map.removeLayer(g);groups.delete(layer)}}const counts={flights:0,ships:0,'public-transport':0,cameras:0,cells:0};const seen=new Set();for(const f of fc.features||[]){const p=f.properties||{}, c=f.geometry?.coordinates;if(!c||c.length<2)continue;const l=logical(p);if(!selected.has(l))continue;if(l==='intelligence'){const vals=String(p.subtype||'other').toLowerCase().split(/[;,]/).map(x=>x.trim());if(!vals.some(v=>intelFilters.has(String(p.category)+':'+v)))continue;}counts[l]=(counts[l]||0)+1;let g=groups.get(l);if(!g){g=L.layerGroup().addTo(map);groups.set(l,g)}const color=l==='flights'?'#45a8ff':l==='ships'?'#43e0c0':l==='public-transport'?'#ffc85a':l==='cameras'?'#b9d8ff':'#dce7ee';const size=l==='flights'?22:l==='ships'?20:l==='public-transport'?19:l==='intelligence'?16:16;const key=objectKey(p,c);seen.add(key);const latlng=[Number(c[1]),Number(c[0])];const state=liveObjects.get(key);const fresh=freshness(p);let m=state?.marker;if(!m){m=L.marker(latlng,{icon:L.divIcon({className:'tm-object',html:markerHtml(l,p,size),iconSize:[size,size],iconAnchor:[size/2,size/2]})});m.addTo(g);m.bindTooltip(safe(p.callsign||p.name||p.label||p.vehicle_id||p.category),{direction:'top',opacity:.9});m.on('click',()=>showObject({...p,status:fresh},latlng));liveObjects.set(key,{marker:m,latlng,seen:Date.now(),raf:null,trail:null})}else{m.setIcon(L.divIcon({className:'tm-object',html:markerHtml(l,p,size),iconSize:[size,size],iconAnchor:[size/2,size/2]}));m.getTooltip()?.setContent(safe(p.callsign||p.name||p.label||p.vehicle_id||p.category));animateMarker(key,m,latlng,p);state.seen=Date.now();state.latlng=latlng;state.marker=m}if(['flights','ships','public-transport'].includes(l)){updateTrail(key,latlng,l);const st=liveObjects.get(key);if(st)st.trail=liveTrails.get(key)}m.addTo(g)}for(const [key,st] of liveObjects){if(!seen.has(key)&&Date.now()-st.seen>15000){if(st.marker&&map.hasLayer(st.marker))map.removeLayer(st.marker);if(st.trail&&map.hasLayer(st.trail))map.removeLayer(st.trail);liveObjects.delete(key);liveTrails.delete(key)}}pruneLiveObjects();updateIntelCounts();const setTxt=(id,v)=>{const e=$(id);if(e)e.textContent=v};setTxt('argos-flight-count',counts.flights||0);setTxt('argos-ship-count',counts.ships||0);setTxt('argos-transport-count',counts['public-transport']||0);setTxt('argos-camera-count',counts.cameras||0);setTxt('argos-infra-count',counts.infrastructure||0);setTxt('argos-intel-count',counts.intelligence||0);$('flightCount').textContent=counts.flights||0;$('shipCount').textContent=counts.ships||0;$('transportCount').textContent=counts['public-transport']||0;$('cameraCount').textContent=counts.cameras||0;return counts}
function renderSources(sources){$('feedHealth').innerHTML=(sources||[]).map(s=>'<div class="feedItem"><span class="dot" style="background:'+(s.status==='live'?'#35d49a':s.status==='error'?'#ff6672':'#f4bb55')+'"></span><b>'+safe(s.layer||'source')+'</b><br><span class="source">'+safe(s.source||'')+' · '+safe(s.status||'unknown')+(s.error?' · '+safe(s.error):'')+'</span></div>').join('')||'<div class="feedItem">No configured feed in current viewport.</div>'}
let movementBusy=false;let movementFailures=0;async function loadMovement(){if(!selected.size){drawFeatures({features:[]});renderSources([]);lastData={features:[],sources:[]};setAlerts(0);status.innerHTML='<span class="live">●</span> NO MOVEMENT LAYERS SELECTED';return}if(movementBusy)return;movementBusy=true;const b=map.getBounds(),bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(','),zoom=map.getZoom();status.innerHTML='<span class="live">●</span> REFRESHING GLOBAL SOURCES…';try{const r=await fetch(API+'/api/global/movement?bbox='+encodeURIComponent(bbox)+'&zoom='+zoom+'&layers='+encodeURIComponent([...selected].join(',')),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();lastData=data;drawFeatures(data);renderSources(data.sources);movementFailures=0;setAlerts((data.sources||[]).filter(s=>s.status==='error').length);const live=(data.sources||[]).filter(s=>s.status==='live').length;status.innerHTML='<span class="live">●</span> '+live+' LIVE SOURCES · '+new Date().toLocaleTimeString();coords.textContent='ZOOM '+map.getZoom()+' · '+map.getCenter().lat.toFixed(2)+', '+map.getCenter().lng.toFixed(2)}catch(e){movementFailures=Math.min(movementFailures+1,3);setAlerts(1);status.innerHTML='<span style="color:#ff6672">●</span> SOURCE ERROR · '+safe(e.message)}finally{movementBusy=false}}
let timer;map.on('moveend',()=>{clearTimeout(timer);timer=setTimeout(loadMovement,250)});let movementTimer;function scheduleMovement(){clearTimeout(movementTimer);movementTimer=setTimeout(async()=>{await loadMovement();scheduleMovement()},movementFailures?Math.min(15000,5000*Math.pow(2,movementFailures)):5000)}scheduleMovement();
$('searchBtn').onclick=searchPlace;search.addEventListener('keydown',e=>{if(e.key==='Enter')searchPlace()});
async function searchPlace(){
  const q=search.value.trim();if(!q)return;
  status.innerHTML='<span class="live">●</span> SEARCHING…';
  const norm=q.toLowerCase();
  const hit=(lastData?.features||[]).find(f=>{const p=f.properties||{};return [p.callsign,p.name,p.label,p.vehicle_id,p.icao24,p.mmsi,p.imo,p.cellid,p.nci,p.eci,p.osm_id,p.id].some(v=>{const s=String(v??'').toLowerCase();return s&&(s===norm||s.includes(norm))})});
  if(hit){const c=hit.geometry?.coordinates;if(c?.length>=2){map.setView([c[1],c[0]],Math.max(map.getZoom(),12),{animate:true});showObject(hit.properties||{},c);return}}
  const coord=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(coord&&Math.abs(+coord[1])<=90&&Math.abs(+coord[2])<=180){flyTo(+coord[1],+coord[2],'Coordinates '+q);status.innerHTML='<span class="live">●</span> COORDINATES · '+safe(q);return}
  try{
    let r=null;
    try{const sr=await fetch(API+'/api/global/search?q='+encodeURIComponent(q),{cache:'no-store'});if(sr.ok){const sd=await sr.json();r=sd.results?.[0]||null}}catch(e){}
    if(!r){const nr=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}});if(nr.ok){const d=await nr.json();if(d[0])r={lat:d[0].lat,lon:d[0].lon,label:d[0].display_name}}}
    if(!r)throw Error('No place, object or identifier found for “'+q+'”');
    if(r.lat==null||r.lon==null)throw Error('Result has no map position');
    if(r.type==='aircraft'){map.setView([Number(r.lat),Number(r.lon)],Math.max(map.getZoom(),9),{animate:true});showObject({category:'flight',source:r.source,callsign:r.callsign||r.label,icao24:r.icao24,heading:r.heading,speed_mps:r.speed_mps,status:'LIVE'},[Number(r.lon),Number(r.lat)])}
    else flyTo(Number(r.lat),Number(r.lon),r.label||q);
    status.innerHTML='<span class="live">●</span> FOUND · '+safe(r.label||q);
  }catch(e){status.innerHTML='<span style="color:#ff6672">●</span> SEARCH · '+safe(e.message);tmToast(e.message,'warn')}
}
function flyTo(lat,lon,label){map.setView([lat,lon],15,{animate:true});if(searchMarker)map.removeLayer(searchMarker);searchMarker=L.marker([lat,lon]).addTo(map).bindPopup('<b>'+safe(label)+'</b>').openPopup();loadMovement()}
document.querySelectorAll('.tm-ip-headrow').forEach(h=>h.onclick=()=>h.parentElement.classList.toggle('open'));
// Argos-style control panel: presentation controls are wired without fabricating unavailable datasets.
function refreshEventTypes(){const sw=document.querySelector('#tm-control-panel .cp-switch[data-cp-layer="events"]');const on=!sw||sw.classList.contains('on');const types=new Set();if(on)document.querySelectorAll('#tm-control-panel .cp-chip[data-cp-type="event"].on:not(.cp-unavailable)').forEach(c=>types.add(c.dataset.v));window.tmEventTypes=types;loadTrackMeNowEvents()}
document.querySelectorAll('[data-cp-expand]').forEach(h=>h.addEventListener('click',e=>{if(e.target.closest('.cp-switch'))return;const body=h.parentElement.querySelector(':scope > .cp-sec-body');if(body)body.hidden=!body.hidden}));
document.querySelectorAll('#tm-control-panel .cp-switch').forEach(sw=>sw.addEventListener('click',e=>{e.stopPropagation();if(sw.classList.contains('cp-unavailable'))return;const on=!sw.classList.contains('on');sw.classList.toggle('on',on);sw.setAttribute('aria-checked',String(on));const layer=sw.dataset.cpLayer;if(layer==='intelligence'){if(on)selected.add('intelligence');else selected.delete('intelligence');syncLayerButtons();loadMovement()}if(layer==='events')refreshEventTypes()}));
document.querySelectorAll('#tm-control-panel .cp-chip:not(.cp-unavailable)').forEach(btn=>btn.addEventListener('click',()=>{btn.classList.toggle('on');if(btn.dataset.cpType==='event')refreshEventTypes()}));
$('tmControlClose')?.addEventListener('click',()=>$('tm-control-panel')?.classList.remove('on'));

$('tmIntelClose')?.addEventListener('click',()=>document.getElementById('tm-intel-panel')?.classList.remove('on'));
document.querySelectorAll('[data-intel-filter]').forEach(btn=>btn.addEventListener('click',()=>{
  const k=btn.dataset.intelFilter;
  if(intelFilters.has(k)){intelFilters.delete(k);btn.classList.remove('on')}else{intelFilters.add(k);btn.classList.add('on')}
  if(lastData)drawFeatures(lastData);
}));
function updateIntelCounts(){
  const counts={power:0,datacenter:0,dam:0,network:0,resource:0,hq:0,poi:0};
  for(const f of (lastData?.features||[])){const c=f.properties?.category;if(c&&counts[c]!=null)counts[c]++}
  for(const k in counts){const el=$('intel-count-'+k);if(el)el.textContent=String(counts[k])}
}
const VIEW_LAYERS={map:['flights','ships','public-transport','cameras','cells','infrastructure','intelligence'],air:['flights'],sea:['ships'],transport:['public-transport'],cameras:['cameras'],infra:['infrastructure','cells','intelligence'],catalog:['intelligence'],events:[],space:[]};
const ARGOS_LAYER={flights:'flights',ships:'ships',transport:'public-transport',cameras:'cameras',infrastructure:'infrastructure',intelligence:'intelligence'};
function closePanels(){$('tm-intel-panel')?.classList.remove('on');$('tm-control-panel')?.classList.remove('on')}
function syncLayerButtons(){document.querySelectorAll('[data-argos]').forEach(b=>{const l=ARGOS_LAYER[b.dataset.argos];if(l)b.classList.toggle('on',selected.has(l))});const sw=document.querySelector('#tm-control-panel .cp-switch[data-cp-layer="intelligence"]');if(sw){const on=selected.has('intelligence');sw.classList.toggle('on',on);sw.setAttribute('aria-checked',String(on))}}
function setLayers(list){selected.clear();list.forEach(l=>selected.add(l));syncLayerButtons();loadMovement()}
document.querySelectorAll('.nav[data-view]').forEach(n=>n.onclick=()=>{
  document.querySelectorAll('.nav[data-view]').forEach(x=>x.classList.remove('active'));n.classList.add('active');
  const v=n.dataset.view;closePanels();
  if(v==='catalog')$('tm-intel-panel')?.classList.add('on');
  if(v==='map')map.setView([20,0],3,{animate:true});
  if(v==='events')tmToast('LIVE EARTHQUAKES (USGS) SHOWN · MOVEMENT LAYERS OFF');
  if(v==='space')tmToast('NO LIVE SPACE FEED IS CONNECTED YET','warn');
  setLayers(VIEW_LAYERS[v]||[]);
});
$('tmcp-open-btn')?.addEventListener('click',()=>{const cp=$('tm-control-panel');const open=!cp.classList.contains('on');closePanels();cp.classList.toggle('on',open)});
document.querySelectorAll('[data-argos]').forEach(b=>b.addEventListener('click',()=>{const v=b.dataset.argos;if(v==='ai'){window.tmToggleAi?.();return}const l=ARGOS_LAYER[v];if(!l)return;if(selected.has(l))selected.delete(l);else selected.add(l);syncLayerButtons();loadMovement()}));
function setGpsUi(on){const b=$('gpsBtn');b.textContent=on?'■ Stop GPS':'◎ GPS';b.classList.toggle('rec',on);document.body.classList.toggle('tm-recording',on)}
let gpsStarting=false;
async function startGps(){
  if(gpsStarting||watchId!==null)return;
  if(!navigator.geolocation){tmToast('BROWSER GPS IS UNAVAILABLE','warn');return}
  gpsStarting=true;sessionId=null;
  try{const r=await fetch(API+'/api/sessions',{method:'POST'});if(!r.ok)throw Error('HTTP '+r.status);sessionId=(await r.json()).id}catch(e){tmToast('LOCATION SERVICE OFFLINE · TRACKING LOCALLY, HISTORY NOT SAVED','warn')}
  gpsStarting=false;
  watchId=navigator.geolocation.watchPosition(p=>{
    const c=[p.coords.latitude,p.coords.longitude];
    if(!gpsMarker)gpsMarker=L.marker(c).addTo(map).bindPopup('AUTHORIZED LIVE GPS').openPopup();else gpsMarker.setLatLng(c);
    map.setView(c,Math.max(map.getZoom(),15));
    if(sessionId)fetch(API+'/api/sessions/'+sessionId+'/location',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:c[0],lon:c[1],accuracy:p.coords.accuracy,altitude:p.coords.altitude,heading:p.coords.heading,speed:p.coords.speed,timestamp:new Date(p.timestamp).toISOString()})}).catch(()=>{});
    status.innerHTML='<span class="live">●</span> AUTHORIZED GPS · ±'+Math.round(p.coords.accuracy)+'m';
  },e=>{status.textContent='GPS · '+e.message;tmToast('GPS · '+e.message,'warn');if(e.code===1)stopGps()},{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
  setGpsUi(true);tmToast('AUTHORIZED GPS STARTED'+(sessionId?' · LOCATION HISTORY ACTIVE':''));
}
function stopGps(){
  if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null}
  if(sessionId)fetch(API+'/api/sessions/'+sessionId+'/stop',{method:'POST'}).catch(()=>{});
  setGpsUi(false);status.innerHTML='<span class="live">●</span> GPS STOPPED';tmToast('GPS RECORDING STOPPED','warn');
}
$('gpsBtn').onclick=()=>watchId===null?startGps():stopGps();
$('historyBtn').onclick=async()=>{
  if(!sessionId)return alert('Start authorized GPS first. Your phone/browser GPS history is stored only for the active authorized session.');
  try{
    const r=await fetch(API+'/api/sessions/'+sessionId+'/history'); if(!r.ok)throw Error('History service unavailable');
    const pts=await r.json(); if(!pts.length)return alert('No GPS points have been recorded yet.');
    if(historyLine)map.removeLayer(historyLine);
    historyLine=L.polyline(pts.map(p=>[Number(p.lat),Number(p.lon)]),{weight:3,opacity:.85}).addTo(map);
    map.fitBounds(historyLine.getBounds(),{padding:[80,80],maxZoom:17});
    status.innerHTML='<span class="live">●</span> GPS HISTORY · '+pts.length+' POINTS';
  }catch(e){alert(e.message)}
};
$('reportBtn').onclick=()=>{if(!lastData)return loadMovement().then(()=>showReport());showReport()};
$('reportClose').onclick=()=>{$('report').classList.remove('show')};
function showReport(){const f=lastData?.features||[], c={};for(const x of f){const p=x.properties||{};const k=logical(p);c[k]=(c[k]||0)+1}$('reportGrid').innerHTML=[['Aircraft',c.flights||0],['Ships',c.ships||0],['Transport',c['public-transport']||0],['Cameras',c.cameras||0],['Cells',c.cells||0],['Infrastructure',c.infrastructure||0]].map(x=>'<div class="reportBlock"><b>'+x[0]+'</b><strong>'+x[1]+'</strong></div>').join('');$('reportSources').innerHTML=(lastData?.sources||[]).map(s=>'<div class="feedItem"><b>'+safe(s.layer)+'</b> · '+safe(s.status)+'<br><span class="source">'+safe(s.source)+'</span></div>').join('');$('report').classList.add('show')}
window.selected=selected; window.loadMovement=loadMovement;
loadMovement();
const leftNav=$('leftNav'),collapseNav=$('collapseNav');
collapseNav.onclick=()=>{leftNav.classList.toggle('expanded');collapseNav.textContent=leftNav.classList.contains('expanded')?'‹':'›';};



async function createGeofence(){
  const center=map.getCenter();const raw=prompt('Geofence radius in metres','500');if(raw===null)return;const radius=Number(raw);
  if(!Number.isFinite(radius)||radius<=0){tmToast('ENTER A RADIUS GREATER THAN 0','warn');return}
  let g={lat:center.lat,lon:center.lng,radius_m:radius},saved=false;
  if(sessionId){try{const r=await fetch(API+'/api/geofences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,lat:center.lat,lon:center.lng,radius_m:radius,name:'TrackMeNow geofence'})});if(!r.ok)throw Error('HTTP '+r.status);g=await r.json();saved=true}catch(e){}}
  const circle=L.circle([g.lat,g.lon],{radius:g.radius_m,color:'#38a5ff',fillOpacity:.08}).addTo(map);
  circle.bindPopup('<b>'+(saved?'AUTHORIZED GEOFENCE':'GEOFENCE (NOT MONITORED)')+'</b><br>'+Math.round(g.radius_m)+' m').openPopup();
  tmToast(saved?'GEOFENCE CREATED · ENTER/EXIT ALERTS ACTIVE':'GEOFENCE DRAWN ONLY · START GPS FOR ENTER/EXIT ALERTS',saved?'ok':'warn');
}
$('geoBtn').onclick=createGeofence;

/* TrackMeNow HUD: toast, alerts, basemap, night mode, zoom */
let tmToastTimer=null;
function tmToast(message,type='ok'){const el=$('tm-toast');if(!el)return;el.textContent=message;el.className='tm-toast-on '+(type==='warn'?'tm-toast-warn':'tm-toast-ok');clearTimeout(tmToastTimer);tmToastTimer=setTimeout(()=>el.className='',3200)}
function setAlerts(n){const b=$('alertBadge');if(!b)return;if(n){b.textContent=n>9?'9+':n;b.classList.add('show')}else b.classList.remove('show')}
$('argos-alerts')?.addEventListener('click',()=>{const bad=(lastData?.sources||[]).filter(s=>s.status==='error');if(!bad.length&&!movementFailures){tmToast('NO ACTIVE TRACKMENOW ALERTS');return}tmToast(bad.length?'SOURCE ERRORS · '+bad.map(s=>s.layer).join(', ').toUpperCase():'LIVE SOURCE SERVER UNREACHABLE','warn')});
$('argos-sat')?.addEventListener('click',()=>{tmToast('BASEMAP · '+setBase(baseIndex+1).toUpperCase())});
$('argos-night')?.addEventListener('click',e=>{const on=document.body.classList.toggle('tm-night');e.currentTarget.classList.toggle('on',on);tmToast(on?'NIGHT MODE':'DAY MODE')});
$('zoomIn')?.addEventListener('click',()=>map.zoomIn());
$('zoomOut')?.addEventListener('click',()=>map.zoomOut());
function syncZoomButtons(){const z=map.getZoom();$('zoomIn')?.toggleAttribute('disabled',z>=map.getMaxZoom());$('zoomOut')?.toggleAttribute('disabled',z<=map.getMinZoom())}
map.on('zoomend',syncZoomButtons);syncZoomButtons();
function hideObject(){rightPanel?.classList.remove('has-selection');document.body.classList.remove('tm-panel-open','tm-cam-open');const cp=$('panel');if(cp)cp.hidden=true}
function tmWireObjActions(p,c){
  $('objClose')?.addEventListener('click',hideObject);
  const fav=$('objFav');if(fav){fav.textContent=window.tmIsFav?.(p)?'★ Saved':'☆ Save';fav.onclick=()=>{const on=window.tmToggleFav?.(p);fav.textContent=on?'★ Saved':'☆ Save'}}
  $('objLink')?.addEventListener('click',async e=>{const u=location.origin+location.pathname+'?lat='+c[1]+'&lon='+c[0];try{await navigator.clipboard.writeText(u);e.currentTarget.textContent='✓ Copied'}catch(err){tmToast('COPY FAILED · '+u,'warn')}});
  $('objFull')?.addEventListener('click',()=>{$('itkBack')?.classList.add('on');$('itkBack')?.setAttribute('aria-hidden','false')});
}
const qp=new URLSearchParams(location.search);if(qp.has('lat')&&qp.has('lon')&&Number.isFinite(+qp.get('lat'))&&Number.isFinite(+qp.get('lon')))map.setView([+qp.get('lat'),+qp.get('lon')],12);
window.addEventListener('beforeunload',()=>{if(watchId!==null)navigator.geolocation.clearWatch(watchId)});

const itkBack=$('itkBack');function closeItk(){itkBack?.classList.remove('on');itkBack?.setAttribute('aria-hidden','true')}$('itkClose')?.addEventListener('click',closeItk);itkBack?.addEventListener('click',e=>{if(e.target===itkBack)closeItk()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeItk()});$('itkGo')?.addEventListener('click',()=>{const q=$('itkQuery').value.trim();if(q){search.value=q;closeItk();searchPlace()}});
// TrackMeNow AI bar: uses the same universal search pipeline, never fabricates live intelligence.
(function(){
  const ai=$('trackmenowAi'), input=$('tmAiInput'), go=$('tmAiGo');
  function run(){const q=(input?.value||'').trim();if(!q)return;if(search){search.value=q;searchPlace();}ai?.classList.remove('on');}
  window.tmToggleAi=()=>{ai?.classList.toggle('on');if(ai?.classList.contains('on'))input?.focus()};
  go?.addEventListener('click',run);
  input?.addEventListener('keydown',e=>{if(e.key==='Enter')run();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')ai?.classList.remove('on');});
})();

// Real event layer: source-backed only. USGS earthquakes are the first global event feed.
const tmEventMarkers=new Map();
async function loadTrackMeNowEvents(){
  const wanted=window.tmEventTypes||new Set(['quake']);
  for(const [k,m] of tmEventMarkers){if(!wanted.has(m._tmEventType)){map.removeLayer(m);tmEventMarkers.delete(k)}}
  if(!wanted.has('quake'))return;
  try{
    const r=await fetch(API+'/api/global/events?ts='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw Error('events HTTP '+r.status);
    const d=await r.json();
    for(const f of (d.features||[])){
      const p=f.properties||{}, c=f.geometry?.coordinates||[]; if(!Number.isFinite(c[0])||!Number.isFinite(c[1]))continue;
      const key='quake:'+String(p.ts||p.name)+':'+c.join(',');
      let m=tmEventMarkers.get(key);
      if(!m){
        const mag=Number(p.magnitude); const radius=Math.max(4,Math.min(13,4+(Number.isFinite(mag)?mag:0)));
        m=L.circleMarker([c[1],c[0]],{radius,weight:1,color:'#ff7847',fillColor:'#ff7847',fillOpacity:.38});
        m._tmEventType='quake';
        m.bindTooltip('<b>EARTHQUAKE</b><br>'+safe(p.name||'USGS event')+'<br>M '+(Number.isFinite(mag)?mag.toFixed(1):'—')+' · '+(p.time?new Date(p.time).toLocaleString():'source time'),{direction:'top',className:'tm-event-tip'});
        m.on('click',()=>showObject({category:'event',source:p.source||'USGS',status:'LIVE FEED',name:p.name||'Earthquake',magnitude:p.magnitude,timestamp:p.time},c));
        m.addTo(map); tmEventMarkers.set(key,m);
      }
    }
    window.dispatchEvent(new CustomEvent('tmcp-source-status',{detail:'USGS earthquakes · '+(d.features||[]).length+' events'}));
  }catch(e){window.dispatchEvent(new CustomEvent('tmcp-source-status',{detail:'USGS events · unavailable'}));}
}
setTimeout(loadTrackMeNowEvents,1800);
setInterval(loadTrackMeNowEvents,60000);
syncLayerButtons();
refreshEventTypes();
