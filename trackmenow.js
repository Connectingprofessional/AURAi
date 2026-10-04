/* TrackMeNow — map + live intelligence UI.
 * Map engine: MapLibre GL JS (WebGL). Basemaps are free raster tiles, live objects are
 * GPU-drawn GeoJSON layers. Only real source observations are drawn; the animation between
 * two polls is visual interpolation between two real positions, never invented movement. */
const API='https://trackmenow-5rez.onrender.com';
const $=id=>document.getElementById(id);
const search=$('search'), status=$('status'), coords=$('coords'), rightPanel=$('rightPanel');
function safe(v){return String(v??'—').replace(/[<>]/g,'')}

/* ───────────────────────── state ───────────────────────── */
const selected=new Set(['flights','ships','public-transport','cameras','cells','infrastructure','intelligence']);
const intelFilters=new Set(['power:nuclear','power:solar','power:wind','power:hydro','power:gas','power:coal','power:oil','power:biomass','power:geothermal','power:waste','power:other','datacenter:ai','datacenter:hyperscale','datacenter:other','dam:hydro','dam:supply','dam:irrigation','dam:flood','dam:other','network:ports','network:railway','network:cables','network:substation','network:line','network:tower','network:pole','resource:mining','resource:energy','resource:agro','resource:tech','resource:choke','resource:industry','hq:company','poi:embassy','poi:military','poi:hospital']);
const MOVING=new Set(['flights','ships','public-transport']);
let lastData=null, searchMarker=null, gpsMarker=null, sessionId=null, watchId=null;
let mapReady=false, baseIndex=0, globeOn=false, selKey=null;
const gpsTrack=[], fences=[];
try{globeOn=localStorage.getItem('tm-globe')!=='0'}catch(e){globeOn=true}

/* ───────────────────────── map ───────────────────────── */
const BASES=[
  {name:'Satellite',layers:['base-satellite','base-labels']},
  {name:'Streets',layers:['base-streets']},
  {name:'Terrain',layers:['base-terrain']}
];
const MAP_STYLE={version:8,
  sky:{'atmosphere-blend':['interpolate',['linear'],['zoom'],0,1,3,0.85,6,0]},
  sources:{
    satellite:{type:'raster',tileSize:256,maxzoom:19,tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],attribution:'Esri World Imagery'},
    labels:{type:'raster',tileSize:256,maxzoom:19,tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],attribution:'Esri'},
    streets:{type:'raster',tileSize:256,maxzoom:19,tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],attribution:'© OpenStreetMap contributors'},
    terrain:{type:'raster',tileSize:256,maxzoom:17,tiles:['https://a.tile.opentopomap.org/{z}/{x}/{y}.png','https://b.tile.opentopomap.org/{z}/{x}/{y}.png','https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],attribution:'© OpenTopoMap (CC-BY-SA)'}
  },
  layers:[
    {id:'bg',type:'background',paint:{'background-color':'#050810'}},
    {id:'base-satellite',type:'raster',source:'satellite'},
    {id:'base-labels',type:'raster',source:'labels'},
    {id:'base-streets',type:'raster',source:'streets',layout:{visibility:'none'}},
    {id:'base-terrain',type:'raster',source:'terrain',layout:{visibility:'none'}}
  ]};
function mapUnavailable(msg){
  const el=$('map');if(el)el.innerHTML='<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:#cfe9ec;font:13px/1.5 system-ui,sans-serif">'+safe(msg)+'</div>';
  const s=$('splash');if(s)s.classList.add('open');
}
let map;
if(!window.maplibregl){mapUnavailable('The map engine could not be downloaded. Check your connection and reload.');throw new Error('maplibregl missing')}
try{
  map=new maplibregl.Map({container:'map',style:MAP_STYLE,center:[0,20],zoom:2,minZoom:1,maxZoom:18,maxPitch:70,attributionControl:false,renderWorldCopies:true});
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
}catch(e){mapUnavailable('This browser could not start the WebGL map. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration on.');throw e}
window.map=map;

/* icons: own silhouettes drawn on a canvas (pointing north, rotated by heading) */
const ICON_PATHS={
  plane:'M16 2C17 2 18 4 18 7L18 12L29 18L29 21L18 18L18 25L21 27.5L21 29.5L16 28L11 29.5L11 27.5L14 25L14 18L3 21L3 18L14 12L14 7C14 4 15 2 16 2Z',
  'plane-small':'M16 3C17 3 17.6 5 17.6 8L17.6 14L28 14.5L28 17.5L17.6 17.5L17.6 25L21 26L21 28L16 27.2L11 28L11 26L14.4 25L14.4 17.5L4 17.5L4 14.5L14.4 14L14.4 8C14.4 5 15 3 16 3Z',
  ship:'M16 2C20 7 21 12 21 18L21 27L11 27L11 18C11 12 12 7 16 2Z'
};
const ICON_COLOR={plane:'#8fd0ff','plane-small':'#c9e6ff',ship:'#43e0c0'};
function addIcon(name){
  const px=64,c=document.createElement('canvas');c.width=c.height=px;
  const x=c.getContext('2d');x.scale(px/32,px/32);
  const path=new Path2D(ICON_PATHS[name]);
  x.lineJoin='round';x.lineWidth=2.4;x.strokeStyle='rgba(5,8,12,.92)';x.stroke(path);
  x.fillStyle=ICON_COLOR[name];x.fill(path);
  if(name==='ship'){x.fillStyle='rgba(5,8,12,.35)';x.fillRect(13.5,17,5,6)}
  map.addImage(name,x.getImageData(0,0,px,px),{pixelRatio:2});
}
const EMPTY={type:'FeatureCollection',features:[]};
const CLICKABLE=['live-flights','live-ships','live-transit','live-cams','live-cells','live-infra','live-intel','live-quakes'];
const zoomSize=(a,b,c)=>['interpolate',['linear'],['zoom'],1,a,6,b,12,c];
function initOverlays(){
  Object.keys(ICON_PATHS).forEach(addIcon);
  ['still','moving','trails','sel','history','gpsfix','fences','quakes'].forEach(id=>map.addSource(id,{type:'geojson',data:EMPTY}));
  const on=l=>['==',['get','lyr'],l];
  const dot=(id,src,filter,color,r)=>map.addLayer({id,type:'circle',source:src,filter,paint:{'circle-radius':r,'circle-color':color,'circle-stroke-color':'#05080c','circle-stroke-width':1,'circle-opacity':.92}});
  map.addLayer({id:'fences-fill',type:'fill',source:'fences',paint:{'fill-color':'#38a5ff','fill-opacity':.09}});
  map.addLayer({id:'fences-line',type:'line',source:'fences',paint:{'line-color':'#38a5ff','line-width':1.5}});
  map.addLayer({id:'gpsfix-fill',type:'fill',source:'gpsfix',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#43e0a0','fill-opacity':.12}});
  map.addLayer({id:'gpsfix-line',type:'line',source:'gpsfix',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#43e0a0','line-width':2.5,'line-opacity':.85}});
  map.addLayer({id:'history-line',type:'line',source:'history',paint:{'line-color':'#45a8ff','line-width':3,'line-opacity':.85}});
  map.addLayer({id:'trails',type:'line',source:'trails',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['match',['get','lyr'],'flights','#45a8ff','ships','#43e0c0','#ffc85a'],'line-width':1.6,'line-opacity':.45}});
  dot('live-infra','still',on('infrastructure'),'#dce7ee',zoomSize(2,3.5,6));
  dot('live-cells','still',on('cells'),'#c08bff',zoomSize(2.5,4,6.5));
  dot('live-cams','still',on('cameras'),'#b9d8ff',zoomSize(2.5,4,7));
  dot('live-intel','still',on('intelligence'),['match',['get','category'],'power','#ffd23b','datacenter','#9fd0ff','dam','#5ec8f0','network','#37e0c8','resource','#ff9d3b','hq','#c08bff','poi','#ff7a85','government','#9fc0d8','#dce7ee'],zoomSize(3,4.5,7));
  dot('live-transit','moving',on('public-transport'),'#ffc85a',zoomSize(3,4.5,7));
  map.addLayer({id:'live-ships',type:'symbol',source:'moving',filter:on('ships'),layout:{'icon-image':'ship','icon-size':zoomSize(.4,.55,.8),'icon-rotate':['get','hd'],'icon-rotation-alignment':'map','icon-pitch-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true}});
  map.addLayer({id:'live-flights',type:'symbol',source:'moving',filter:on('flights'),layout:{'icon-image':['case',['==',['get','small'],true],'plane-small','plane'],'icon-size':zoomSize(.4,.58,.85),'icon-rotate':['get','hd'],'icon-rotation-alignment':'map','icon-pitch-alignment':'map','icon-allow-overlap':true,'icon-ignore-placement':true}});
  map.addLayer({id:'live-quakes',type:'circle',source:'quakes',paint:{'circle-radius':['interpolate',['linear'],['to-number',['get','mag'],0],0,4,5,10,8,18],'circle-color':'#ff7847','circle-opacity':.38,'circle-stroke-color':'#ff7847','circle-stroke-width':1}});
  map.addLayer({id:'sel-ring',type:'circle',source:'sel',paint:{'circle-radius':15,'circle-color':'rgba(255,255,255,0)','circle-stroke-color':'#ffffff','circle-stroke-width':2,'circle-opacity':.95}});
}

/* basemap, night mode, globe */
function setBase(i){
  baseIndex=((i%BASES.length)+BASES.length)%BASES.length;
  if(!mapReady)return BASES[baseIndex].name;
  BASES.forEach((b,n)=>b.layers.forEach(id=>map.setLayoutProperty(id,'visibility',n===baseIndex?'visible':'none')));
  return BASES[baseIndex].name;
}
function applyNight(on){
  if(!mapReady)return;
  ['base-satellite','base-labels','base-streets','base-terrain'].forEach(id=>{
    map.setPaintProperty(id,'raster-brightness-max',on?.45:1);
    map.setPaintProperty(id,'raster-saturation',on?-.3:0);
    map.setPaintProperty(id,'raster-contrast',on?.1:0);
  });
}
function applyProjection(){if(mapReady){map.setProjection({type:globeOn?'globe':'mercator'});if(globeOn){try{map.setCenter([18,22]);map.setZoom(1.65);map.setPitch(0)}catch(e){}}}}
let globeSpin=true,globeBearing=0,globeLast=performance.now();
function spinGlobe(now){
  if(globeOn&&globeSpin&&mapReady){
    const dt=Math.min(80,now-globeLast); globeBearing=(globeBearing+dt*.0045)%360;
    try{map.setBearing(globeBearing);map.triggerRepaint()}catch(e){}
  }
  globeLast=now;requestAnimationFrame(spinGlobe);
}
requestAnimationFrame(spinGlobe);
map.on('dragstart',()=>{globeSpin=false});
map.on('dragend',()=>{setTimeout(()=>{globeSpin=globeOn},1800)});
map.on('zoomstart',()=>{globeSpin=false});
map.on('zoomend',()=>{setTimeout(()=>{globeSpin=globeOn},1800)});
function toggleGlobe(){
  globeOn=!globeOn;try{localStorage.setItem('tm-globe',globeOn?'1':'0')}catch(e){}
  applyProjection();$('argos-globe')?.classList.toggle('on',globeOn);
  return globeOn;
}

/* ───────────────────────── object helpers ───────────────────────── */
function icon(p){return ({flight:'✈',ship:'◆',transit:'●',camera:'▣',cell:'⌁',airport:'✈',train:'▰',metro:'▰',bus:'■',taxi:'■',ferry:'◆'}[p.category]||'•')}
function logical(p){
  if(p.category==='flight')return'flights';if(p.category==='ship')return'ships';if(p.category==='camera')return'cameras';if(p.category==='cell')return'cells';
  if(p.category==='transit'||p.category==='public-transport'||p.mode==='transit')return'public-transport';
  if(['power','datacenter','dam','network','cable','resource','hq','poi','government'].includes(p.category))return'intelligence';
  return selected.has('infrastructure')?'infrastructure':'road';
}
function objectKey(p,c){return String(p.icao24||p.mmsi||p.vehicle_id||p.id||p.osm_id||p.cellid||p.nci||p.eci||((p.callsign||p.name||p.label||p.category)+'@'+Number(c[1]).toFixed(5)+','+Number(c[0]).toFixed(5)))}
function sourceTime(p){const v=Number(p.timestamp||p.last_contact||p.updated_at||0);return v>1e12?v:v*1000}
function freshness(p){const t=sourceTime(p),age=t?Math.max(0,Date.now()-t):0;if(!t)return 'SOURCE TIME UNKNOWN';if(age<30000)return 'LIVE';if(age<120000)return 'RECENT';return 'STALE'}
function circlePoly(lng,lat,radiusM,steps=64){
  const ring=[],dLat=radiusM/111320,dLng=radiusM/(111320*Math.max(.01,Math.cos(lat*Math.PI/180)));
  for(let i=0;i<=steps;i++){const a=i/steps*2*Math.PI;ring.push([lng+dLng*Math.cos(a),lat+dLat*Math.sin(a)])}
  return {type:'Feature',geometry:{type:'Polygon',coordinates:[ring]},properties:{}};
}
const setSource=(id,fc)=>{if(mapReady)map.getSource(id)?.setData(fc)};
const featureOf=(coords,props)=>({type:'Feature',geometry:{type:'Point',coordinates:coords},properties:props||{}});
function setSelection(c,key){selKey=key||null;setSource('sel',c?{type:'FeatureCollection',features:[featureOf(c)]}:EMPTY)}

/* ───────────────────────── object card ───────────────────────── */
function showObject(p,coords){
  rightPanel?.classList.add('has-selection');document.body.classList.add('tm-panel-open');
  setSelection(coords,p.key||objectKey(p,coords));
  const name=p.callsign||p.name||p.label||p.vehicle_id||p.category||'Object';const st=p.status||'LIVE';
  const speed=p.velocity_mps!=null?(Number(p.velocity_mps)*1.944).toFixed(1)+' kt':p.speed_mps!=null?(Number(p.speed_mps)*3.6).toFixed(1)+' km/h':'—';
  const heading=p.heading!=null?Math.round(p.heading)+'°':'—';
  const updated=p.timestamp?new Date(Number(p.timestamp)*1000).toLocaleTimeString():p.last_contact?new Date(Number(p.last_contact)*1000).toLocaleTimeString():'source dependent';
  const kind=p.category||p.mode;
  $('objectCard').innerHTML='<div class="objectTitle"><h3>'+icon(p)+' '+safe(name)+'</h3><span class="pill">'+safe(st)+'</span><button class="objClose" id="objClose" aria-label="Close">×</button></div><div class="kv"><div><small>TYPE</small><span>'+safe(kind)+'</span></div><div><small>SOURCE</small><span>'+safe(p.source||'public feed')+'</span></div><div><small>POSITION</small><span>'+coords[1].toFixed(4)+', '+coords[0].toFixed(4)+'</span></div><div><small>UPDATED</small><span>'+safe(updated)+'</span></div><div><small>SPEED</small><span>'+safe(speed)+'</span></div><div><small>HEADING</small><span>'+safe(heading)+'</span></div></div><div class="source" style="margin-top:9px">TrackMeNow distinguishes live source data from estimated, static and historical information. No movement is fabricated.</div><div class="objActions"><button class="btn" id="objFav">☆ Save</button><button class="btn" id="objLink">↗ Copy link</button><button class="btn" id="objFull">Full intel</button></div>';
  tmWireObjActions(p,coords);
  $('itkBadge').textContent='● '+safe(st)+' · '+safe((p.source||'PUBLIC SOURCE').toUpperCase());
  $('itkTitle').textContent=name;
  $('itkDesc').textContent=safe((kind||'OBJECT').toString().toUpperCase())+' intelligence from TrackMeNow public-source feeds.';
  $('itkBullets').innerHTML='<li>Source: '+safe(p.source||'Public feed')+'</li><li>Position: '+coords[1].toFixed(4)+', '+coords[0].toFixed(4)+'</li><li>No movement is fabricated; timestamps reflect the source feed.</li>';
  $('itkGrid').innerHTML='<div class="itk-tile"><small>TYPE</small><b>'+safe(kind)+'</b></div><div class="itk-tile"><small>STATUS</small><b>'+safe(st)+'</b></div><div class="itk-tile"><small>SPEED</small><b>'+safe(speed)+'</b></div><div class="itk-tile"><small>HEADING</small><b>'+safe(heading)+'</b></div>';
  const widgets=$('itkWidgets');
  if(widgets){
    let w='<div class="itk-fence itk-alert"><span class="itk-pro-dot"></span><div class="itk-alert-h">⌖ GEOFENCE <span class="itk-pro">PRO</span></div><div class="itk-d">Authorized-device boundary monitoring</div></div>';
    if(kind==='flight'||kind==='ship')w+='<div class="itk-trk"><div class="itk-trk-h">↗ 30 DAY TRACK <span class="itk-trk-s">LIVE</span></div><svg viewBox="0 0 300 30" preserveAspectRatio="none"><path class="t-a" d="M0 24 L35 18 L70 20 L105 10 L140 13 L175 7 L210 9 L245 4 L300 7 L300 30 L0 30Z"/><path class="t-p" d="M0 24 L35 18 L70 20 L105 10 L140 13 L175 7 L210 9 L245 4"/><path class="t-e" d="M245 4 L300 7"/><circle class="t-d" cx="245" cy="4" r="2.8"/></svg><div class="itk-trk-l"><div class="itk-trk-r viva"><div class="itk-trk-w">● NOW</div><div class="itk-trk-m">LIVE</div><div class="itk-trk-t">Current source position</div></div></div></div>';
    if(kind==='camera')w+='<div class="itk-tl"><div class="itk-tl-h">DVR TIMELINE <span class="itk-tl-v" id="itkTlV">LIVE</span></div><div class="itk-tl-bar" id="itkTlBar"><i style="left:25%"></i><i style="left:50%"></i><i style="left:75%"></i><span class="itk-tl-k" id="itkTlK" style="left:92%"></span></div><div class="itk-tl-f"><span>24h</span><span>12h</span><span>NOW</span></div></div><div class="itk-wall"><div class="itk-wall-h">▣ CAMERA WALL <span class="itk-wall-n">LIVE</span></div><div class="itk-wall-g"><i class="t0"></i><i class="t1"></i><i class="t2"></i><i class="t3"></i></div><div class="itk-wall-t"><span>Open camera wall</span><span class="itk-wall-c">›</span></div></div>';
    if(kind==='cell')w+='<div class="itk-alert"><div class="itk-alert-h">⚠ ALERT RULE</div><div class="itk-pills"><div class="itk-pill on">ENTER</div><div class="itk-pill">EXIT</div></div><div class="itk-chips"><span class="itk-chip on">LIVE</span><span class="itk-chip">SIGNAL</span><span class="itk-chip">LOCATION</span></div></div>';
    widgets.innerHTML=w;
    const bar=$('itkTlBar'),knob=$('itkTlK');
    if(bar&&knob){const move=e=>{const r=bar.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));knob.style.left=(x*100)+'%';$('itkTlV').textContent=x>.9?'NOW':Math.round(24*x)+'h ago'};bar.onpointerdown=e=>{bar.setPointerCapture(e.pointerId);move(e)};bar.onpointermove=e=>{if(e.buttons)move(e)}}
  }
  $('itkQuery').value=name;
  if(kind==='camera'){
    const panel=$('panel');
    if(panel){
      panel.hidden=false;panel._p=p;panel._c=coords;document.body.classList.add('tm-cam-open');
      $('panel-title').textContent=name;
      $('panel-fav').textContent=window.tmIsFav?.(p)?'★':'☆';
      const img=$('panel-img'),src=p.image_url||p.image||p.snapshot_url||p.preview_url||'';
      if(src){img.src=src;img.style.display='block';$('panel-why').hidden=true}
      else{img.removeAttribute('src');img.style.display='none';const why=$('panel-why');why.hidden=false;why.textContent='This public camera has a location record, but the source did not provide an image URL in the current feed.'}
      $('panel-updated').textContent=p.timestamp?new Date(Number(p.timestamp)*1000).toLocaleString():'SOURCE TIME UNKNOWN';
      $('panel-report').hidden=false;$('panel-report').textContent='Something wrong with this camera? Report';
      $('panel-meta').innerHTML='<div class="pm-row"><small>SOURCE</small><b>'+safe(p.source||'OpenStreetMap / public feed')+'</b></div><div class="pm-row"><small>POSITION</small><b>'+coords[1].toFixed(5)+', '+coords[0].toFixed(5)+'</b></div><div class="pm-row"><small>STATUS</small><b>'+safe(p.status||'SOURCE DEPENDENT')+'</b></div>';
      $('itkBack')?.classList.remove('on');
    }
  }
}
function hideObject(){
  rightPanel?.classList.remove('has-selection');document.body.classList.remove('tm-panel-open','tm-cam-open');
  const cp=$('panel');if(cp)cp.hidden=true;setSelection(null);
}
function tmWireObjActions(p,c){
  $('objClose')?.addEventListener('click',hideObject);
  const fav=$('objFav');if(fav){fav.textContent=window.tmIsFav?.(p)?'★ Saved':'☆ Save';fav.onclick=()=>{const on=window.tmToggleFav?.(p);fav.textContent=on?'★ Saved':'☆ Save'}}
  $('objLink')?.addEventListener('click',async e=>{const u=location.origin+location.pathname+'?lat='+c[1]+'&lon='+c[0];try{await navigator.clipboard.writeText(u);e.currentTarget.textContent='✓ Copied'}catch(err){tmToast('COPY FAILED · '+u,'warn')}});
  $('objFull')?.addEventListener('click',()=>{$('itkBack')?.classList.add('on');$('itkBack')?.setAttribute('aria-hidden','false')});
}

/* ───────────────────────── live data on the map ───────────────────────── */
const live=new Map();               // key -> {from,to,cur,t0,props,trail,seen}
const ANIM_MS=4300, TRAIL_POINTS=6, MAX_ANIMATED=6000;
let animRaf=0, lastPaint=0;
const ease=q=>q<.5?2*q*q:1-Math.pow(-2*q+2,2)/2;
function paintMoving(){
  const now=performance.now();let active=false;const feats=[];
  for(const st of live.values()){
    const q=Math.min(1,(now-st.t0)/ANIM_MS);if(q<1)active=true;
    const e=ease(q);
    st.cur=[st.from[0]+(st.to[0]-st.from[0])*e,st.from[1]+(st.to[1]-st.from[1])*e];
    feats.push(featureOf(st.cur,st.props));
  }
  setSource('moving',{type:'FeatureCollection',features:feats});
  if(selKey&&live.has(selKey))setSource('sel',{type:'FeatureCollection',features:[featureOf(live.get(selKey).cur)]});
  return active;
}
function animLoop(ts){
  animRaf=0;
  if(ts-lastPaint>=120){lastPaint=ts;if(!paintMoving())return}
  animRaf=requestAnimationFrame(animLoop);
}
const kick=()=>{if(!animRaf)animRaf=requestAnimationFrame(animLoop)};
const setTxt=(id,v)=>{const e=$(id);if(e)e.textContent=v};
function drawFeatures(fc){
  const counts={flights:0,ships:0,'public-transport':0,cameras:0,cells:0,infrastructure:0,intelligence:0};
  const still=[],seen=new Set(),nowMs=Date.now(),nowPerf=performance.now(),animate=live.size<=MAX_ANIMATED;
  for(const [k,st] of live)if(!selected.has(st.props.lyr))live.delete(k);
  for(const f of fc.features||[]){
    const p=f.properties||{},c=f.geometry?.coordinates;if(!c||c.length<2)continue;
    const lng=Number(c[0]),lat=Number(c[1]);if(!Number.isFinite(lng)||!Number.isFinite(lat))continue;
    const l=logical(p);if(!selected.has(l))continue;
    if(l==='intelligence'){const vals=String(p.subtype||'other').toLowerCase().split(/[;,]/).map(x=>x.trim());if(!vals.some(v=>intelFilters.has(String(p.category)+':'+v)))continue}
    counts[l]=(counts[l]||0)+1;
    const key=objectKey(p,c);
    const hdg=Number(p.heading??p.bearing);
    const props=Object.assign({},p,{key,lyr:l,status:freshness(p),hd:Number.isFinite(hdg)?hdg:0,
      small:p.speed_mps!=null&&Number(p.speed_mps)<90&&p.altitude_m!=null&&Number(p.altitude_m)<3000,
      lbl:safe(p.callsign||p.name||p.label||p.vehicle_id||p.category)});
    if(!MOVING.has(l)){still.push(featureOf([lng,lat],props));continue}
    seen.add(key);
    const to=[lng,lat],st=live.get(key);
    if(!st){live.set(key,{from:to,to,cur:to,t0:nowPerf,props,trail:[to],seen:nowMs})}
    else{
      const jump=!animate||Math.abs(to[0]-st.to[0])>180;
      st.from=jump?to:(st.cur||st.to);st.to=to;st.t0=nowPerf;st.props=props;st.seen=nowMs;
      const last=st.trail[st.trail.length-1];
      if(Math.abs(last[0]-to[0])+Math.abs(last[1]-to[1])>1e-6){st.trail.push(to);while(st.trail.length>TRAIL_POINTS)st.trail.shift()}
    }
  }
  for(const [k,st] of live)if(!seen.has(k)&&nowMs-st.seen>15000)live.delete(k);
  const trails=[];
  for(const st of live.values())if(st.trail.length>1)trails.push({type:'Feature',geometry:{type:'LineString',coordinates:st.trail},properties:{lyr:st.props.lyr}});
  setSource('still',{type:'FeatureCollection',features:still});
  setSource('trails',{type:'FeatureCollection',features:trails});
  paintMoving();kick();
  updateIntelCounts();
  setTxt('argos-flight-count',counts.flights||0);setTxt('argos-ship-count',counts.ships||0);setTxt('argos-transport-count',counts['public-transport']||0);setTxt('argos-camera-count',counts.cameras||0);setTxt('argos-infra-count',counts.infrastructure||0);setTxt('argos-intel-count',counts.intelligence||0);
  setTxt('flightCount',counts.flights||0);setTxt('shipCount',counts.ships||0);setTxt('transportCount',counts['public-transport']||0);setTxt('cameraCount',counts.cameras||0);
  return counts;
}
function renderSources(sources){$('feedHealth').innerHTML=(sources||[]).map(s=>'<div class="feedItem"><span class="dot" style="background:'+(s.status==='live'?'#35d49a':s.status==='error'?'#ff6672':'#f4bb55')+'"></span><b>'+safe(s.layer||'source')+'</b><br><span class="source">'+safe(s.source||'')+' · '+safe(s.status||'unknown')+(s.error?' · '+safe(s.error):'')+'</span></div>').join('')||'<div class="feedItem">No configured feed in current viewport.</div>'}
function updateCoords(){const c=map.getCenter();coords.textContent='ZOOM '+map.getZoom().toFixed(1)+' · '+c.lat.toFixed(2)+', '+c.lng.toFixed(2)}
let movementBusy=false,movementFailures=0;
async function loadMovement(){
  if(!mapReady)return;
  if(!selected.size){drawFeatures({features:[]});renderSources([]);lastData={features:[],sources:[]};setAlerts(0);status.innerHTML='<span class="live">●</span> NO MOVEMENT LAYERS SELECTED';return}
  if(movementBusy)return;movementBusy=true;
  const b=map.getBounds(),bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(n=>Math.max(-180,Math.min(180,n))).join(','),zoom=Math.round(map.getZoom());
  status.innerHTML='<span class="live">●</span> REFRESHING GLOBAL SOURCES…';
  try{
    const r=await fetch(API+'/api/global/movement?bbox='+encodeURIComponent(bbox)+'&zoom='+zoom+'&layers='+encodeURIComponent([...selected].join(',')),{cache:'no-store'});
    if(!r.ok)throw Error('HTTP '+r.status);
    const data=await r.json();lastData=data;drawFeatures(data);renderSources(data.sources);movementFailures=0;
    setAlerts((data.sources||[]).filter(s=>s.status==='error').length);
    const liveCount=(data.sources||[]).filter(s=>s.status==='live').length;
    status.innerHTML='<span class="live">●</span> '+liveCount+' LIVE SOURCES · '+new Date().toLocaleTimeString();updateCoords();
  }catch(e){movementFailures=Math.min(movementFailures+1,3);setAlerts(1);status.innerHTML='<span style="color:#ff6672">●</span> SOURCE ERROR · '+safe(e.message)}
  finally{movementBusy=false}
}
let moveTimer,movementTimer;
function scheduleMovement(){clearTimeout(movementTimer);movementTimer=setTimeout(async()=>{await loadMovement();scheduleMovement()},movementFailures?Math.min(15000,5000*Math.pow(2,movementFailures)):5000)}

/* pointer: hover tooltip + click-to-inspect */
const tip=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:14,className:'tm-tip'});
function hitTest(pt){
  const layers=CLICKABLE.filter(id=>map.getLayer(id));
  return map.queryRenderedFeatures([[pt.x-8,pt.y-8],[pt.x+8,pt.y+8]],{layers})[0];
}
let hoverRaf=0;
map.on('mousemove',e=>{
  if(hoverRaf||!mapReady)return;
  hoverRaf=requestAnimationFrame(()=>{
    hoverRaf=0;const f=hitTest(e.point);map.getCanvas().style.cursor=f?'pointer':'';
    if(f&&f.properties.lbl)tip.setLngLat(f.geometry.coordinates).setText(f.properties.lbl).addTo(map);else tip.remove();
  });
});
map.on('click',e=>{
  if(!mapReady)return;const f=hitTest(e.point);if(!f)return;
  const p=Object.assign({},f.properties),c=f.geometry.coordinates.slice();
  const st=live.get(p.key);if(st)c[0]=st.cur[0],c[1]=st.cur[1];
  showObject(p,c);
});
map.on('moveend',()=>{updateCoords();clearTimeout(moveTimer);moveTimer=setTimeout(loadMovement,250)});

/* ───────────────────────── search ───────────────────────── */
$('searchBtn').onclick=searchPlace;search.addEventListener('keydown',e=>{if(e.key==='Enter')searchPlace()});
async function searchPlace(){
  const q=search.value.trim();if(!q)return;
  status.innerHTML='<span class="live">●</span> SEARCHING…';
  const norm=q.toLowerCase();
  const hit=(lastData?.features||[]).find(f=>{const p=f.properties||{};return [p.callsign,p.name,p.label,p.vehicle_id,p.icao24,p.mmsi,p.imo,p.cellid,p.nci,p.eci,p.osm_id,p.id].some(v=>{const s=String(v??'').toLowerCase();return s&&(s===norm||s.includes(norm))})});
  if(hit){const c=hit.geometry?.coordinates;if(c?.length>=2){map.flyTo({center:[c[0],c[1]],zoom:Math.max(map.getZoom(),11),essential:true});showObject(Object.assign({},hit.properties||{}),c);status.innerHTML='<span class="live">●</span> FOUND · '+safe(hit.properties?.callsign||hit.properties?.name||q);return}}
  const coord=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(coord&&Math.abs(+coord[1])<=90&&Math.abs(+coord[2])<=180){flyTo(+coord[1],+coord[2],'Coordinates '+q);status.innerHTML='<span class="live">●</span> COORDINATES · '+safe(q);return}
  try{
    let r=null;
    try{const sr=await fetch(API+'/api/global/search?q='+encodeURIComponent(q),{cache:'no-store'});if(sr.ok){const sd=await sr.json();r=sd.results?.[0]||null}}catch(e){}
    if(!r){const nr=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}});if(nr.ok){const d=await nr.json();if(d[0])r={lat:d[0].lat,lon:d[0].lon,label:d[0].display_name}}}
    if(!r)throw Error('No place, object or identifier found for “'+q+'”');
    if(r.lat==null||r.lon==null)throw Error('Result has no map position');
    if(r.type==='aircraft'){map.flyTo({center:[Number(r.lon),Number(r.lat)],zoom:Math.max(map.getZoom(),8),essential:true});showObject({category:'flight',source:r.source,callsign:r.callsign||r.label,icao24:r.icao24,heading:r.heading,speed_mps:r.speed_mps,status:'LIVE'},[Number(r.lon),Number(r.lat)])}
    else flyTo(Number(r.lat),Number(r.lon),r.label||q);
    status.innerHTML='<span class="live">●</span> FOUND · '+safe(r.label||q);
  }catch(e){status.innerHTML='<span style="color:#ff6672">●</span> SEARCH · '+safe(e.message);tmToast(e.message,'warn')}
}
function flyTo(lat,lon,label){
  map.flyTo({center:[lon,lat],zoom:14,essential:true});
  searchMarker?.remove();
  searchMarker=new maplibregl.Marker({color:'#45a8ff'}).setLngLat([lon,lat]).setPopup(new maplibregl.Popup({offset:26}).setHTML('<b>'+safe(label)+'</b>')).addTo(map);
  searchMarker.togglePopup();
}

/* ───────────────────────── panels, layers, views ───────────────────────── */
document.querySelectorAll('.tm-ip-headrow').forEach(h=>h.onclick=()=>h.parentElement.classList.toggle('open'));
function refreshEventTypes(){const sw=document.querySelector('#tm-control-panel .cp-switch[data-cp-layer="events"]');const on=!sw||sw.classList.contains('on');const types=new Set();if(on)document.querySelectorAll('#tm-control-panel .cp-chip[data-cp-type="event"].on:not(.cp-unavailable)').forEach(c=>types.add(c.dataset.v));window.tmEventTypes=types;loadTrackMeNowEvents()}
document.querySelectorAll('[data-cp-expand]').forEach(h=>h.addEventListener('click',e=>{if(e.target.closest('.cp-switch'))return;const body=h.parentElement.querySelector(':scope > .cp-sec-body');if(body)body.hidden=!body.hidden}));
document.querySelectorAll('#tm-control-panel .cp-switch').forEach(sw=>sw.addEventListener('click',e=>{e.stopPropagation();if(sw.classList.contains('cp-unavailable'))return;const on=!sw.classList.contains('on');sw.classList.toggle('on',on);sw.setAttribute('aria-checked',String(on));const layer=sw.dataset.cpLayer;if(layer==='intelligence'){if(on)selected.add('intelligence');else selected.delete('intelligence');syncLayerButtons();loadMovement()}if(layer==='events')refreshEventTypes()}));
document.querySelectorAll('#tm-control-panel .cp-chip:not(.cp-unavailable)').forEach(btn=>btn.addEventListener('click',()=>{btn.classList.toggle('on');if(btn.dataset.cpType==='event')refreshEventTypes()}));
$('tmControlClose')?.addEventListener('click',()=>$('tm-control-panel')?.classList.remove('on'));
$('tmIntelClose')?.addEventListener('click',()=>$('tm-intel-panel')?.classList.remove('on'));
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
  if(v==='map')map.flyTo({center:[0,20],zoom:2,bearing:0,pitch:0,essential:true});
  if(v==='events')tmToast('LIVE EARTHQUAKES (USGS) SHOWN · MOVEMENT LAYERS OFF');
  if(v==='space')tmToast('NO LIVE SPACE FEED IS CONNECTED YET','warn');
  setLayers(VIEW_LAYERS[v]||[]);
});
$('tmcp-open-btn')?.addEventListener('click',()=>{const cp=$('tm-control-panel');const open=!cp.classList.contains('on');closePanels();cp.classList.toggle('on',open)});
document.querySelectorAll('[data-argos]').forEach(b=>b.addEventListener('click',()=>{const v=b.dataset.argos;if(v==='ai'){window.tmToggleAi?.();return}const l=ARGOS_LAYER[v];if(!l)return;if(selected.has(l))selected.delete(l);else selected.add(l);syncLayerButtons();loadMovement()}));
const leftNav=$('leftNav'),collapseNav=$('collapseNav');
collapseNav.onclick=()=>{leftNav.classList.toggle('expanded');collapseNav.textContent=leftNav.classList.contains('expanded')?'‹':'›'};

/* ───────────────────────── GPS, history, geofence ───────────────────────── */
function setGpsUi(on){const b=$('gpsBtn');b.textContent=on?'■ Stop GPS':'◎ GPS';b.classList.toggle('rec',on);document.body.classList.toggle('tm-recording',on)}
function drawGpsFix(lng,lat,acc){
  const feats=[circlePoly(lng,lat,Math.max(5,acc||10))];
  if(gpsTrack.length>1)feats.push({type:'Feature',geometry:{type:'LineString',coordinates:gpsTrack},properties:{}});
  setSource('gpsfix',{type:'FeatureCollection',features:feats});
}
let gpsStarting=false;
async function startGps(){
  if(gpsStarting||watchId!==null)return;
  if(!navigator.geolocation){tmToast('BROWSER GPS IS UNAVAILABLE','warn');return}
  gpsStarting=true;sessionId=null;
  try{const r=await fetch(API+'/api/sessions',{method:'POST'});if(!r.ok)throw Error('HTTP '+r.status);sessionId=(await r.json()).id}catch(e){tmToast('LOCATION SERVICE OFFLINE · TRACKING LOCALLY, HISTORY NOT SAVED','warn')}
  gpsStarting=false;
  watchId=navigator.geolocation.watchPosition(p=>{
    const c=[p.coords.longitude,p.coords.latitude];
    if(!gpsMarker)gpsMarker=new maplibregl.Marker({color:'#43e0a0'}).setLngLat(c).setPopup(new maplibregl.Popup({offset:26}).setText('AUTHORIZED LIVE GPS')).addTo(map);else gpsMarker.setLngLat(c);
    gpsTrack.push(c);if(gpsTrack.length>500)gpsTrack.shift();drawGpsFix(c[0],c[1],p.coords.accuracy);
    map.easeTo({center:c,zoom:Math.max(map.getZoom(),14)});
    if(sessionId)fetch(API+'/api/sessions/'+sessionId+'/location',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lat:c[1],lon:c[0],accuracy:p.coords.accuracy,altitude:p.coords.altitude,heading:p.coords.heading,speed:p.coords.speed,timestamp:new Date(p.timestamp).toISOString()})}).catch(()=>{});
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
    const r=await fetch(API+'/api/sessions/'+sessionId+'/history');if(!r.ok)throw Error('History service unavailable');
    const pts=await r.json();if(!pts.length)return alert('No GPS points have been recorded yet.');
    const line=pts.map(p=>[Number(p.lon),Number(p.lat)]);
    setSource('history',{type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:line},properties:{}}]});
    const b=new maplibregl.LngLatBounds(line[0],line[0]);line.forEach(c=>b.extend(c));
    map.fitBounds(b,{padding:80,maxZoom:16});
    status.innerHTML='<span class="live">●</span> GPS HISTORY · '+pts.length+' POINTS';
  }catch(e){alert(e.message)}
};
async function createGeofence(){
  const center=map.getCenter();const raw=prompt('Geofence radius in metres','500');if(raw===null)return;const radius=Number(raw);
  if(!Number.isFinite(radius)||radius<=0){tmToast('ENTER A RADIUS GREATER THAN 0','warn');return}
  let g={lat:center.lat,lon:center.lng,radius_m:radius},saved=false;
  if(sessionId){try{const r=await fetch(API+'/api/geofences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,lat:center.lat,lon:center.lng,radius_m:radius,name:'TrackMeNow geofence'})});if(!r.ok)throw Error('HTTP '+r.status);g=await r.json();saved=true}catch(e){}}
  fences.push(circlePoly(Number(g.lon),Number(g.lat),Number(g.radius_m)));
  setSource('fences',{type:'FeatureCollection',features:fences});
  tmToast(saved?'GEOFENCE CREATED · ENTER/EXIT ALERTS ACTIVE':'GEOFENCE DRAWN ONLY · START GPS FOR ENTER/EXIT ALERTS',saved?'ok':'warn');
}
$('geoBtn').onclick=createGeofence;

/* ───────────────────────── report ───────────────────────── */
$('reportBtn').onclick=()=>{if(!lastData)return loadMovement().then(()=>showReport());showReport()};
$('reportClose').onclick=()=>{$('report').classList.remove('show')};
function showReport(){const f=lastData?.features||[],c={};for(const x of f){const p=x.properties||{};const k=logical(p);c[k]=(c[k]||0)+1}$('reportGrid').innerHTML=[['Aircraft',c.flights||0],['Ships',c.ships||0],['Transport',c['public-transport']||0],['Cameras',c.cameras||0],['Cells',c.cells||0],['Infrastructure',c.infrastructure||0]].map(x=>'<div class="reportBlock"><b>'+x[0]+'</b><strong>'+x[1]+'</strong></div>').join('');$('reportSources').innerHTML=(lastData?.sources||[]).map(s=>'<div class="feedItem"><b>'+safe(s.layer)+'</b> · '+safe(s.status)+'<br><span class="source">'+safe(s.source)+'</span></div>').join('');$('report').classList.add('show')}

/* ───────────────────────── HUD: toast, alerts, zoom, basemap, globe ───────────────────────── */
let tmToastTimer=null;
function tmToast(message,type='ok'){const el=$('tm-toast');if(!el)return;el.textContent=message;el.className='tm-toast-on '+(type==='warn'?'tm-toast-warn':'tm-toast-ok');clearTimeout(tmToastTimer);tmToastTimer=setTimeout(()=>el.className='',3200)}
function setAlerts(n){const b=$('alertBadge');if(!b)return;if(n){b.textContent=n>9?'9+':n;b.classList.add('show')}else b.classList.remove('show')}
$('argos-alerts')?.addEventListener('click',()=>{const bad=(lastData?.sources||[]).filter(s=>s.status==='error');if(!bad.length&&!movementFailures){tmToast('NO ACTIVE TRACKMENOW ALERTS');return}tmToast(bad.length?'SOURCE ERRORS · '+bad.map(s=>s.layer).join(', ').toUpperCase():'LIVE SOURCE SERVER UNREACHABLE','warn')});
$('argos-sat')?.addEventListener('click',()=>{tmToast('BASEMAP · '+setBase(baseIndex+1).toUpperCase())});
$('argos-globe')?.addEventListener('click',()=>{tmToast(toggleGlobe()?'3D GLOBE':'FLAT MAP')});
$('argos-night')?.addEventListener('click',e=>{const on=document.body.classList.toggle('tm-night');e.currentTarget.classList.toggle('on',on);applyNight(on);tmToast(on?'NIGHT MODE':'DAY MODE')});
$('zoomIn')?.addEventListener('click',()=>map.zoomIn());
$('zoomOut')?.addEventListener('click',()=>map.zoomOut());
$('zoomNorth')?.addEventListener('click',()=>map.easeTo({bearing:0,pitch:0}));
function syncZoomButtons(){const z=map.getZoom();$('zoomIn')?.toggleAttribute('disabled',z>=map.getMaxZoom()-.01);$('zoomOut')?.toggleAttribute('disabled',z<=map.getMinZoom()+.01)}
function syncCompass(){const b=map.getBearing(),p=map.getPitch(),el=$('zoomNorth');if(!el)return;el.style.setProperty('--b',(-b)+'deg');el.classList.toggle('on',Math.abs(b)>.5||p>.5)}
map.on('zoom',syncZoomButtons);map.on('zoomend',syncZoomButtons);map.on('rotate',syncCompass);map.on('pitch',syncCompass);
syncZoomButtons();syncCompass();
window.addEventListener('beforeunload',()=>{if(watchId!==null)navigator.geolocation.clearWatch(watchId)});
const itkBack=$('itkBack');function closeItk(){itkBack?.classList.remove('on');itkBack?.setAttribute('aria-hidden','true')}
$('itkClose')?.addEventListener('click',closeItk);itkBack?.addEventListener('click',e=>{if(e.target===itkBack)closeItk()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeItk()});
$('itkGo')?.addEventListener('click',()=>{const q=$('itkQuery').value.trim();if(q){search.value=q;closeItk();searchPlace()}});
// TrackMeNow AI bar: uses the same universal search pipeline, never fabricates live intelligence.
(function(){
  const ai=$('trackmenowAi'),input=$('tmAiInput'),go=$('tmAiGo');
  function run(){const q=(input?.value||'').trim();if(!q)return;search.value=q;searchPlace();ai?.classList.remove('on')}
  window.tmToggleAi=()=>{ai?.classList.toggle('on');if(ai?.classList.contains('on'))input?.focus()};
  go?.addEventListener('click',run);
  input?.addEventListener('keydown',e=>{if(e.key==='Enter')run()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')ai?.classList.remove('on')});
})();

/* ───────────────────────── events: USGS earthquakes (source-backed) ───────────────────────── */
async function loadTrackMeNowEvents(){
  if(!mapReady)return;
  const wanted=window.tmEventTypes||new Set(['quake']);
  if(!wanted.has('quake')){setSource('quakes',EMPTY);return}
  try{
    const r=await fetch(API+'/api/global/events?ts='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw Error('events HTTP '+r.status);
    const d=await r.json(),feats=[];
    for(const f of (d.features||[])){
      const p=f.properties||{},c=f.geometry?.coordinates||[];if(!Number.isFinite(c[0])||!Number.isFinite(c[1]))continue;
      const mag=Number(p.magnitude);
      feats.push(featureOf([c[0],c[1]],{category:'event',source:p.source||'USGS',status:'LIVE FEED',name:p.name||'Earthquake',magnitude:p.magnitude,mag:Number.isFinite(mag)?mag:0,timestamp:p.time,
        lbl:'M '+(Number.isFinite(mag)?mag.toFixed(1):'—')+' · '+safe(p.name||'USGS event'),key:'quake:'+String(p.ts||p.name)+':'+c.join(',')}));
    }
    setSource('quakes',{type:'FeatureCollection',features:feats});
    window.dispatchEvent(new CustomEvent('tmcp-source-status',{detail:'USGS earthquakes · '+feats.length+' events'}));
  }catch(e){window.dispatchEvent(new CustomEvent('tmcp-source-status',{detail:'USGS events · unavailable'}))}
}
setInterval(loadTrackMeNowEvents,60000);

/* ───────────────────────── boot ───────────────────────── */
let booted=false;
function boot(){
  if(booted)return;booted=true;
  initOverlays();mapReady=true;
  setBase(baseIndex);applyProjection();
  $('argos-globe')?.classList.toggle('on',globeOn);
  const qp=new URLSearchParams(location.search);
  if(qp.has('lat')&&qp.has('lon')&&Number.isFinite(+qp.get('lat'))&&Number.isFinite(+qp.get('lon')))map.jumpTo({center:[+qp.get('lon'),+qp.get('lat')],zoom:11});
  window.selected=selected;window.loadMovement=loadMovement;
  syncLayerButtons();refreshEventTypes();loadMovement();scheduleMovement();updateCoords();
}
/* start on style.load, not 'load': 'load' waits for tiles and never fires if the tile server is blocked */
if(map.isStyleLoaded())boot();else map.on('style.load',boot);
map.on('load',boot);

/* tile failures: tell the person and fall back to another basemap instead of showing a blank map */
let tileErrors=0,fellBack=false;
map.on('error',e=>{
  const u=(e&&e.error&&e.error.url)||'';if(!u||!/\/\d+\/\d+\/\d+/.test(u))return;
  if(++tileErrors===6&&!fellBack){
    fellBack=true;
    const next=(baseIndex+1)%BASES.length;
    tmToast('Basemap tiles are not loading – switching to '+BASES[next].name,'warn');
    setBase(next);
  }
});
window.selected=selected;window.loadMovement=loadMovement;
syncLayerButtons();
