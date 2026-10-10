/* TrackMeNow — full category UI. All navigation lives in the bottom dock; map viewport ends above it. */
(function(){
'use strict';
const API=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?location.origin:'https://wispy-bush-9aee.recreationeeraj.workers.dev';
const isLocal=location.hostname==='localhost'||location.hostname==='127.0.0.1';
const T={
 MAP:['GOOGLE EARTH','SATELLITE','LIVE','3D','FLAT','RADAR','DAY / NIGHT','WEATHER','OVERVIEW','LAYERS','INTELLIGENCE','SEARCH'],
 SPACE:['SOLAR SYSTEM','EARTH','MOON','MARS','SATELLITES','ISS / SPACE STATIONS','EARTH OBSERVATION','SPACE WEATHER'],
 TRANSIT:['ALL TRANSPORT','AIR','SHIP','TAXI','BUS','RAILWAY','METRO','BOAT','PERSONAL JET','CAR','BIKES'],
 WEATHER:['NATURAL CALAMITIES','WEATHER REPORT'],
 COMMUNICATION:['WEBRTC','PHONE'],
 TRACK:['GPS','IP','CELL','DEVICE','HISTORY','GEOFENCE','CONSENT'],
 VISUALS:['LIVE','CAMERAS','IMAGES','VIDEOS','CLIPS','HISTORY','USER SHARED'],
 MORE:['ADMIN','SOURCES','STATUS','SETTINGS']
};
const state={tab:'MAP',sub:'OVERVIEW',stack:null,period:'DAY',panel:false};
const PHONE_SEARCH_HISTORY_KEY='tmPhoneSearchHistory';
function phoneMask(v){const d=String(v||'').replace(/\\D/g,'');return d.length>=7?'+'+d.slice(0,2)+'•••••'+d.slice(-3):String(v||'');}
function getPhoneSearchHistory(){
 try{return JSON.parse(localStorage.getItem(PHONE_SEARCH_HISTORY_KEY)||'[]').filter(x=>x&&x.maskedPhone).slice(0,20)}
 catch(e){return[]}
}
function savePhoneSearchHistory(phone,found,deviceId){
 const item={maskedPhone:phoneMask(phone),found:!!found,deviceId:deviceId||null,at:new Date().toISOString()};
 const next=[item,...getPhoneSearchHistory().filter(x=>x.maskedPhone!==item.maskedPhone)].slice(0,20);
 try{localStorage.setItem(PHONE_SEARCH_HISTORY_KEY,JSON.stringify(next))}catch(e){}
}
let gps={watch:null,session:null,marker:null,lastFix:0,lastAccuracy:null,error:'',trail:[],poll:null}, historyTimer=null;
function ensureGpsLayers(m){
 if(!m||!window.maplibregl||!m.isStyleLoaded||!m.isStyleLoaded())return;
 const empty={type:'FeatureCollection',features:[]};
 if(!m.getSource('tm-gps-track'))m.addSource('tm-gps-track',{type:'geojson',data:empty});
 if(!m.getLayer('tm-gps-track'))m.addLayer({id:'tm-gps-track',type:'line',source:'tm-gps-track',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#43e0a0','line-width':['interpolate',['linear'],['zoom'],1,2,8,3.5,15,5],'line-opacity':.88,'line-blur':.15}});
 if(!m.getSource('tm-gps-accuracy'))m.addSource('tm-gps-accuracy',{type:'geojson',data:empty});
 if(!m.getLayer('tm-gps-accuracy'))m.addLayer({id:'tm-gps-accuracy',type:'circle',source:'tm-gps-accuracy',paint:{'circle-radius':['interpolate',['linear'],['zoom'],5,7,10,14,15,22],'circle-color':'#43e0a0','circle-opacity':.12,'circle-stroke-color':'#43e0a0','circle-stroke-width':1,'circle-stroke-opacity':.38}});
}
function paintGpsTrack(m,points){
 if(!m||!points||!points.length)return;
 ensureGpsLayers(m);
 const coords=points.map(p=>[Number(p.lon),Number(p.lat)]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
 if(coords.length>=2&&m.getSource('tm-gps-track'))m.getSource('tm-gps-track').setData({type:'Feature',properties:{source:'consented-live-gps'},geometry:{type:'LineString',coordinates:coords}});
 const last=coords[coords.length-1];
 const accuracy=Number(points[points.length-1].accuracy);
 if(last&&m.getSource('tm-gps-accuracy'))m.getSource('tm-gps-accuracy').setData({type:'Feature',properties:{accuracy:Number.isFinite(accuracy)?accuracy:0},geometry:{type:'Point',coordinates:last}});
}
const $=(s)=>document.querySelector(s);
function el(tag,attrs={},txt){const x=document.createElement(tag);Object.keys(attrs).forEach(k=>x.setAttribute(k,attrs[k]));if(txt!==undefined)x.textContent=txt;return x}
function api(path,opt){return fetch(API+path,Object.assign({cache:'no-store'},opt||{})).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(j.error||('HTTP '+r.status)),{status:r.status,data:j});return j})}
function oldClick(selector){const b=document.querySelector(selector);if(b){b.click();return true}return false}
function engine(){return window.TrackMeNowEngine||null}
function map(){return window.map||null}
function openAdmin(){window.open('./admin.html','_blank','noopener,noreferrer')}
function logUi(event,tab,detail){api('/api/visitor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({screen:'map',tab:tab,sub:state.sub,event:event,detail:detail})}).catch(()=>{})}
function card(title,desc,action,label){const c=el('article',{class:'tm-card'});c.append(el('b',{},title));if(desc)c.append(el('p',{},desc));if(action){const b=el('button',{class:'tm-action',type:'button'},label||'OPEN');b.onclick=action;c.append(b)}return c}
function status(text){const x=el('div',{class:'tm-status'},text);return x}
function setStatus(text,ok){const p=document.querySelector('#tm-panel .tm-panel-body');if(!p)return;const old=p.querySelector('.tm-global-feed-status');if(old)old.remove();const x=status(text);x.classList.add('tm-global-feed-status',ok?'ok':'error');p.append(x)}
function setPanelTitle(){const h=$('#tm-panel-title');if(h)h.textContent=state.tab+' / '+state.sub+(state.stack?' / '+state.stack:'')}
function build(){
 const top=el('header',{id:'tm-top'});
 const brand=el('div',{class:'tm-brand'});brand.append(document.createTextNode('TRACKME'));const brandSpan=el('span',{},'NOW');brand.append(brandSpan);
 const search=el('div',{class:'tm-search'}),inp=el('input',{id:'tm-global-search',placeholder:'Search city, place, device, cell ID, aircraft, IP…',autocomplete:'off'}),go=el('button',{type:'button'},'SEARCH');
 go.onclick=()=>doSearch(inp.value);inp.onkeydown=e=>{if(e.key==='Enter')doSearch(inp.value)};search.append(inp,go);
 const admin=el('button',{id:'tm-admin',type:'button','aria-label':'Admin'},'⚙');admin.onclick=openAdmin;
 top.append(brand,search,admin);document.body.append(top);
 const shell=el('div',{id:'tm-shell'});
 const main=el('nav',{id:'tm-main-tabs'});Object.keys(T).forEach(k=>{const b=el('button',{class:'tm-tab',type:'button'},k);b.onclick=()=>{if(k!=='MAP'&&window.TrackMeNowGoogleEarth)window.TrackMeNowGoogleEarth.close();state.tab=k;state.sub=T[k][0];state.stack=null;state.panel=false;logUi('tab',k,'');render()};main.append(b)});
 const sub=el('div',{id:'tm-subbar'});
 const zoom=el('div',{class:'tm-zoom-common'});[['−',-1],['+',1]].forEach(([txt,d])=>{const b=el('button',{type:'button'},txt);b.onclick=()=>engine()&&engine().zoomBy(d);zoom.append(b)});
 const panel=el('section',{id:'tm-panel'});const head=el('div',{class:'tm-panel-head'}),title=el('div',{id:'tm-panel-title',class:'tm-panel-title'}),meta=el('div',{class:'tm-panel-meta'},'LIVE / PUBLIC / CONSENT-BASED'),close=el('button',{class:'tm-close',type:'button'},'×');close.onclick=()=>{state.panel=false;render()};head.append(title,meta,close);panel.append(head);
 shell.append(main,sub,zoom,panel);document.body.append(shell);render();
}
function render(){
 const main=$('#tm-main-tabs'),sub=$('#tm-subbar'),panel=$('#tm-panel');Array.from(main.children).forEach(b=>b.classList.toggle('active',b.textContent===state.tab));
 sub.innerHTML='';T[state.tab].forEach(s=>{const b=el('button',{class:'tm-sub',type:'button'},s);b.classList.toggle('active',s===state.sub);b.onclick=()=>{state.sub=s;state.stack=null;if(state.tab==='MAP'&&['GOOGLE EARTH','SATELLITE','LIVE','3D','FLAT','RADAR','DAY / NIGHT','WEATHER'].includes(s)){state.panel=false;mapAction(s)}else{if(window.TrackMeNowGoogleEarth)window.TrackMeNowGoogleEarth.close();state.panel=true;}logUi('subtab',state.tab,s);render()};sub.append(b)});
 panel.classList.toggle('open',state.panel);setPanelTitle();if(state.panel)draw(panel);
 requestAnimationFrame(()=>document.documentElement.style.setProperty('--tm-dock-h',($('#tm-shell').offsetHeight||74)+'px'));
}
function draw(panel){
 while(panel.children.length>1)panel.lastChild.remove();
 const body=el('div',{class:'tm-panel-body'});panel.append(body);
 if(state.tab==='MAP')return drawMap(body);
 if(state.tab==='SPACE')return drawSpace(body);
 if(state.tab==='TRANSIT')return drawTransit(body);
 if(state.tab==='WEATHER')return drawWeather(body);
 if(state.tab==='COMMUNICATION')return drawCommunication(body);
 if(state.tab==='TRACK')return drawTrack(body);
 if(state.tab==='VISUALS')return drawVisuals(body);
 return drawMore(body);
}
function drawRoadDeviceIntelligence(p){
 const m=map();
 const bbox=(()=>{const b=m&&m.getBounds?m.getBounds():null;return b?[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(','):'-180,-85,180,85'})();
 const probe=status('ROAD PROBE · Click a road or moving object to inspect sourced observations within 250 m.');
 p.append(status('LIVE INTELLIGENCE · Real-source map telemetry. Vehicle totals are feed observations, not a census. Public cameras are catalogue points and may not have a live stream.'));
 p.append(probe);
 const g=el('div',{class:'tm-stack'});
 g.append(card('ROAD FLOW','Checking live traffic/vehicle sources…',null,'CHECKING'));
 g.append(card('LIVE ROAD OBJECTS','Checking car, taxi, bike and public-transport observations…',null,'CHECKING'));
 g.append(card('PUBLIC CAMERAS','Checking the public camera catalogue for this viewport…',null,'CHECKING'));
 g.append(card('CONSENTED PHONES','Checking privacy-safe aggregate telemetry…',null,'CHECKING'));
 p.append(g);
 const refresh=()=>Promise.all([
   api('/api/movement?bbox='+encodeURIComponent(bbox)+'&layers=car,taxi,bike,transit,rail,metro'),
   api('/api/cameras?bbox='+encodeURIComponent(bbox)),
   api('/health'),
   api('/api/devices/stats')
 ]).then(([mv,cams,h,ds])=>{
   g.innerHTML='';
   const features=Array.isArray(mv.features)?mv.features:[];
   const sources=Array.isArray(mv.sources)?mv.sources:[];
   const byKind=features.reduce((a,f)=>{const p=f.properties||{},k=String(p.kind||p.category||p.layer||'other').toLowerCase();a[k]=(a[k]||0)+1;return a},{});
   const roadCount=['car','cars','taxi','bike','bikes','transit','rail','metro'].reduce((n,k)=>n+(byKind[k]||0),0);
   const roadSources=sources.filter(s=>/car|taxi|bike|transit|rail|metro|vehicle|mobility|gbfs|gtfs/i.test(String(s.layer||'')+' '+String(s.source||'')));
   const liveRoadSources=roadSources.filter(s=>!/(error|missing|unavailable|feed-required|disabled)/i.test(String(s.status||'')));
   const cameraFeatures=Array.isArray(cams.features)?cams.features:[];
   const cameraSources=Array.isArray(cams.sources)?cams.sources:[];
   const cameraStatus=cameraSources[0]?.status||'catalogue';
   const sourceNames=[...new Set(liveRoadSources.map(s=>s.source||s.layer).filter(Boolean))];
   g.append(card('ROAD FLOW',
     sourceNames.length
       ? sourceNames.join(' · ')+' · live source available; speed/congestion values depend on the provider.'
       : 'No dedicated speed/congestion provider is configured. TrackMeNow will not invent traffic colours or car counts.',
     null,sourceNames.length?'SOURCE LIVE':'PROVIDER NEEDED'));
   g.append(card('LIVE ROAD OBJECTS',
     roadCount
       ? roadCount.toLocaleString()+' sourced road/transit observations in the current viewport · '+Object.entries(byKind).filter(([k])=>/car|taxi|bike|transit|rail|metro/.test(k)).map(([k,v])=>k+': '+v).join(' · ')
       : 'No current car/taxi/bike/transit position records were returned for this viewport. This is not proof that roads are empty.',
     null,roadCount?'LIVE FEED':'NO CURRENT OBSERVATIONS'));
   g.append(card('PUBLIC CAMERAS',
     cameraFeatures.length
       ? cameraFeatures.length.toLocaleString()+' public catalogue points returned · source '+(cameraSources.map(s=>s.source).filter(Boolean).join(', ')||'TrackMeNow')
       : (cameraStatus==='zoom-in-required'?'Zoom into a regional/city view to load OpenStreetMap / Overpass camera points.':'No public camera points were returned for this viewport.'),
     null,cameraFeatures.length?'CATALOGUE LOADED':cameraStatus==='zoom-in-required'?'ZOOM IN':'NO POINTS'));
   g.append(card('CONSENTED PHONES',
     ds&&ds.ok
       ? Number(ds.registered||0).toLocaleString()+' registered · '+Number(ds.online||0).toLocaleString()+' online in '+Number(ds.onlineWindowSeconds||120)+'s · '+Number(ds.activeLastHour||0).toLocaleString()+' active in the last hour. Aggregate only.'
       : h&&h.devices?'Device service is configured but aggregate telemetry is unavailable right now.':'Device telemetry is not configured.',
     null,ds&&ds.ok?'LIVE AGGREGATE':'SERVICE STATUS'));
   const foot=status('UPDATED · '+new Date().toLocaleTimeString()+' · '+(mv.generatedAt||'source timestamp unavailable'));
   foot.classList.add('tm-global-feed-status','ok');p.append(foot);
 }).catch(e=>{
   g.innerHTML='';g.append(card('INTELLIGENCE SERVICE','The live source adapter could not be reached: '+(e.message||'service unavailable'),null,'RETRY'));
 });
 const refreshBtn=el('button',{class:'tm-action',type:'button'},'REFRESH LIVE SOURCES');
 refreshBtn.onclick=()=>{refreshBtn.disabled=true;refreshBtn.textContent='REFRESHING…';refresh().finally(()=>{refreshBtn.disabled=false;refreshBtn.textContent='REFRESH LIVE SOURCES';})};
 p.append(refreshBtn);
 refresh();
 // Road click probe: source observations only; never claims an exact road census.
 if(m&&typeof m.on==='function'){
   if(window.__tmRoadInspectorMap&&window.__tmRoadInspectorHandler){try{window.__tmRoadInspectorMap.off('click',window.__tmRoadInspectorHandler)}catch(e){}}
   window.__tmRoadInspectorMap=m;
   window.__tmRoadInspectorHandler=async function(ev){
     if(state.tab!=='MAP'||state.sub!=='INTELLIGENCE'||!ev||!ev.lngLat)return;
     const lat=Number(ev.lngLat.lat),lon=Number(ev.lngLat.lng);
     const dLat=250/111320,dLon=250/(111320*Math.max(.15,Math.cos(lat*Math.PI/180)));
     const box=[lon-dLon,lat-dLat,lon+dLon,lat+dLat].map((v,i)=>i%2===0?Math.max(-180,Math.min(180,v)):Math.max(-90,Math.min(90,v)));
     probe.textContent='ROAD PROBE · checking live car/taxi/bike observations near '+lat.toFixed(5)+', '+lon.toFixed(5)+'…';
     try{
       const mv=await api('/api/movement?bbox='+encodeURIComponent(box.join(','))+'&layers=car,taxi,bike');
       const fs=Array.isArray(mv.features)?mv.features:[];
       const relevant=(mv.sources||[]).filter(s=>/car|taxi|bike|vehicle|gbfs/i.test(String(s.layer||'')+' '+String(s.source||'')));
       if(!relevant.length||relevant.every(s=>/(error|missing|unavailable|feed-required)/i.test(String(s.status||'')))){
         probe.textContent='ROAD PROBE · no configured live road-position feed returned data for this area. No vehicle count is fabricated.';
       }else if(!fs.length){
         probe.textContent='ROAD PROBE · 0 sourced road-position records within 250 m. That means no records were returned by the configured feed, not that the road is empty.';
       }else{
         probe.textContent='ROAD PROBE · '+fs.length.toLocaleString()+' sourced road-position records within 250 m · '+relevant.map(s=>s.source||s.layer).filter(Boolean).join(', ')+' · '+(mv.generatedAt||'timestamp unavailable');
       }
     }catch(e){probe.textContent='ROAD PROBE · feed lookup failed: '+(e.message||'service unavailable')}
   };
   m.on('click',window.__tmRoadInspectorHandler);
 }
}
function drawMap(p){
 if(state.sub==='SEARCH')return drawSearch(p);
 if(state.sub==='INTELLIGENCE')return drawRoadDeviceIntelligence(p);
 if(['GOOGLE EARTH','SATELLITE','LIVE','3D','FLAT','RADAR','DAY / NIGHT','WEATHER'].includes(state.sub))return;
 const items={OVERVIEW:['GOOGLE EARTH','SATELLITE','LIVE','3D','FLAT','RADAR','DAY / NIGHT','WEATHER'],LAYERS:['SATELLITE','LIVE','RADAR','DAY / NIGHT','WEATHER'],SEARCH:[]}[state.sub]||[];
 p.append(status('Map views are mutually selectable; the common zoom control stays in the dock.'));
 const g=el('div',{class:'tm-stack'});
 items.forEach(k=>g.append(card(k,'Select this map view.',()=>mapAction(k),'SELECT')));p.append(g);
}
function mapAction(k){
 if(k==='GOOGLE EARTH'){if(window.TrackMeNowGoogleEarth)window.TrackMeNowGoogleEarth.open();return;}
 if(window.TrackMeNowGoogleEarth)window.TrackMeNowGoogleEarth.close();
 const e=engine();if(!e)return;
 if(k==='SATELLITE')oldClick('[data-bar="satellite"]');
 if(k==='LIVE')e.selectWeather('live');
 if(k==='RADAR')e.selectWeather('radar');
 if(k==='DAY / NIGHT'){window.__tmDayNightMode=!window.__tmDayNightMode;e.setDayNight(window.__tmDayNightMode);}
 if(k==='FLAT'){e.setScale('earth');e.setEarthMode('flat');}
 if(k==='3D'){e.setScale('earth');e.setEarthMode('globe');}
 if(k==='WEATHER')e.selectWeather('precip');
}
function drawSpace(p){
 const planetActions={'SOLAR SYSTEM':'solar','EARTH':'earth3d','MOON':'moon','MARS':'mars'};
 p.append(status('SPACE is powered by TrackMeNow source adapters. Reference websites are not embedded; their public data is normalized by the backend and rendered here.'));
 const g=el('div',{class:'tm-stack'});
 if(planetActions[state.sub]){
   const k=state.sub;
   g.append(card(k,k==='EARTH'?'Return to the live Earth globe.':k==='SOLAR SYSTEM'?'Open the Solar System orbital view.':'Open the interactive '+k.toLowerCase()+' view.',()=>{const e=engine();if(e)e.setScale(planetActions[k]);},'OPEN 3D'));
 } else if(state.sub==='SATELLITES'){
   const satelliteStatus=(text,kind='info')=>{
     const old=p.querySelectorAll('.tm-space-feed-status');old.forEach(x=>x.remove());
     const x=status(text);x.classList.add('tm-space-feed-status',kind);p.append(x);
   };
   const loadSatellites=async()=>{
     try{
       const m=map(),c=m?m.getCenter():{lat:28.6139,lng:77.209};
       const j=await api('/api/space/satellites?lat='+encodeURIComponent(c.lat)+'&lon='+encodeURIComponent(c.lng)+'&radius=90&category=0');
       if(!m)throw new Error('Map unavailable');
       const feats=(j.satellites||[]).filter(s=>Number.isFinite(Number(s.satlat))&&Number.isFinite(Number(s.satlng))).map(s=>({type:'Feature',geometry:{type:'Point',coordinates:[Number(s.satlng),Number(s.satlat)]},properties:{name:s.satname||s.satid,id:s.satid,altitude:s.satalt,source:'N2YO',sourceStatus:'live'}}));
       if(!m.getSource('tm-satellites'))m.addSource('tm-satellites',{type:'geojson',data:{type:'FeatureCollection',features:feats}});
       else m.getSource('tm-satellites').setData({type:'FeatureCollection',features:feats});
       if(!m.getLayer('tm-satellites'))m.addLayer({id:'tm-satellites',type:'circle',source:'tm-satellites',paint:{'circle-radius':['interpolate',['linear'],['zoom'],1,2,5,4,10,6],'circle-color':'#b7f36b','circle-stroke-color':'#071018','circle-stroke-width':1}});
       setStatus('SATELLITES · '+feats.length+' live orbital objects · N2YO',true);
       satelliteStatus('N2YO · LIVE · '+feats.length.toLocaleString()+' orbital objects · radius 90°');
       if(feats[0])m.flyTo({center:feats[0].geometry.coordinates,zoom:3,duration:700});
     }catch(e){
       const d=e.data||{};
       satelliteStatus(d.code==='N2YO_API_KEY_MISSING'?'SATELLITES · FEED REQUIRED · Configure N2YO_API_KEY on the Worker. ISS remains independently available.':'SATELLITES · '+(d.status||'SOURCE ERROR')+' · '+e.message,'error');
     }
   };
   g.append(card('SATELLITES','Fetch current orbital positions through the TrackMeNow Worker → N2YO. The browser never receives the API key.',loadSatellites,'LOAD LIVE SATELLITES'));
   g.append(card('ISS','Fetch the current ISS position from the public ISS source.',async()=>{try{const j=await api('/api/space/iss');const f=j.feature;if(f&&map())map().flyTo({center:f.geometry.coordinates,zoom:5});setStatus('ISS · LIVE · '+new Date(j.observedAt).toLocaleTimeString(),true);satelliteStatus('ISS · LIVE · '+new Date(j.observedAt).toLocaleTimeString());}catch(e){satelliteStatus('ISS · SOURCE ERROR · '+e.message,'error');}},'LOAD LIVE ISS'));
   g.append(card('SOURCE CONFIG','N2YO is a server-side feed. If the Worker secret is absent, satellites are explicitly marked FEED REQUIRED; ISS remains independent.',()=>satelliteStatus('N2YO · '+(window.__tmN2yoStatus||'STATUS AVAILABLE WHEN SATELLITE FEED IS CALLED')),'SOURCE STATUS'));
 } else if(state.sub==='ISS / SPACE STATIONS'){
   g.append(card('ISS LIVE POSITION','Fetch the current ISS position from the TrackMeNow Worker.',async()=>{try{const j=await api('/api/space/iss');const f=j.feature;if(f&&map())map().flyTo({center:f.geometry.coordinates,zoom:5});p.append(status('ISS · '+f.geometry.coordinates[1].toFixed(3)+', '+f.geometry.coordinates[0].toFixed(3)+' · '+new Date(j.observedAt).toLocaleTimeString()));}catch(e){p.append(status('ISS source unavailable: '+e.message));}},'GET LIVE POSITION'));
 } else if(state.sub==='EARTH OBSERVATION'){
   api('/api/earth-observation').then(j=>{(j.layers||[]).forEach(s=>g.append(card(s.id.toUpperCase(),s.provider+' · '+s.status,()=>{if(s.id==='viirs-true-color'){const e=engine();if(e)e.selectWeather('live');}else if(s.id==='viirs-fires'){const e=engine();if(e)e.selectWeather('fires');}},'SHOW ON MAP')))}).catch(e=>g.append(status('Earth-observation backend unavailable: '+e.message)));
   g.append(card('SATELLITE BASEMAP','Use the TrackMeNow satellite basemap, separate from cameras and visual references.',()=>{const e=engine();if(e)e.selectWeather('dark');},'MAP'));
 } else if(state.sub==='SPACE WEATHER'){
   g.append(card('SPACE WEATHER','Backend slot for solar and geomagnetic feeds. No reference website is embedded.',null,'SOURCE STATUS'));
 }
 p.append(g);
}
const transitMap={AIR:'air',SHIP:'ships',RAILWAY:'rail',BOAT:'ships','PERSONAL JET':'air',TAXI:'taxi',BUS:'transit',METRO:'metro',CAR:'car',BIKES:'bike'};
function drawTransit(p){
 p.append(status('ALL TRANSPORT is the default view. Mode buttons filter the globe to observed source data; station discovery is separate from vehicle telemetry.'));
 const g=el('div',{class:'tm-stack'});
 T.TRANSIT.forEach(k=>{
   if(k==='ALL TRANSPORT'){
     g.append(card(k,'Restore every available transport layer on the globe.',()=>{const e=engine();if(e&&e.showAllTransport)e.showAllTransport();},'SHOW ALL'));
     return;
   }
   const feed=transitMap[k];
   const desc=feed?'Filter the globe to real '+k.toLowerCase()+' observations from the TrackMeNow backend.':'Use public network/station discovery; no vehicle position is invented.';
   const act=feed?()=>{const e=engine();if(e&&e.activateTransport)e.activateTransport(feed);}:()=>showSourceStatus(p,k);
   g.append(card(k,desc,act,feed?'SHOW ONLY':'SOURCE STATUS'));
 });
 if(['BUS','METRO','RAILWAY'].includes(state.sub)){
   const mode=state.sub==='BUS'?'bus':state.sub==='METRO'?'metro':'rail';
   g.append(card('NETWORK & STATIONS','Discover nearby stations/networks from OpenStreetMap/Overpass, using the transit-network behavior of TRAVIC, GeoP GeOps and the metro reference sites.',async()=>{
     try{
       const m=map();if(!m)throw new Error('Map unavailable');
       const b=m.getBounds(),bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',');
       const j=await api('/api/transit/discovery?mode='+mode+'&bbox='+encodeURIComponent(bbox));
       const feats=j.features||[];
       if(!m.getSource('tm-transit-stations'))m.addSource('tm-transit-stations',{type:'geojson',data:{type:'FeatureCollection',features:feats}});
       else m.getSource('tm-transit-stations').setData({type:'FeatureCollection',features:feats});
       if(!m.getLayer('tm-transit-stations'))m.addLayer({id:'tm-transit-stations',type:'circle',source:'tm-transit-stations',paint:{'circle-radius':['interpolate',['linear'],['zoom'],4,2.5,10,5,15,7],'circle-color':['match',['get','kind'],'metro','#c084fc','rail','#f59e0b','#38bdf8'],'circle-stroke-color':'#071018','circle-stroke-width':1}});
       setStatus(mode.toUpperCase()+' STATIONS · '+feats.length.toLocaleString()+' · OSM/Overpass',true);
       if(feats[0])m.flyTo({center:feats[0].geometry.coordinates,zoom:Math.max(10,m.getZoom()),duration:700});
     }catch(e){p.append(status('Station discovery unavailable: '+e.message));}
   },'SHOW STATIONS'));
 }
 if(state.sub==='METRO'){
   g.append(card('ROUTE SEARCH','Search the current map for a station or metro network. Vehicle positions remain live-only when a GTFS-Realtime source exists.',()=>{state.tab='MAP';state.sub='SEARCH';state.panel=true;render();const i=$('#tm-panel-search');if(i)i.focus();},'SEARCH STATION'));
 }
 if(state.sub==='TAXI'){
   g.append(card('RIDE WORKFLOW','Open the public Uber ride-request workflow. TrackMeNow does not scrape private ride data or claim access to Uber vehicle positions.',()=>window.open('https://m.uber.com/go/home','_blank','noopener,noreferrer'),'OPEN RIDE WORKFLOW'));
 }
}
function showSourceStatus(p,k){p.append(status(k+': no dedicated live feed is configured. TrackMeNow will not invent vehicle positions.'))}
function drawWeather(p){
 if(state.sub==='NATURAL CALAMITIES')return drawCalamities(p);
 return drawWeatherReport(p);
}
function drawCalamities(p){
 const g=el('div',{class:'tm-stack'}),items=[['LIVE CLOUD','Current-day NASA VIIRS imagery',()=>engine().selectWeather('live')],['ACTIVE FIRES','NASA VIIRS thermal anomalies',()=>engine().selectWeather('fires')],['EONET','NASA open natural-event feed',()=>engine().selectWeather('events')],['EARTHQUAKE','USGS earthquake feed',()=>engine().selectWeather('quakes')],['DARK BASE','Dark base map',()=>engine().selectWeather('dark')]];
 items.forEach(x=>g.append(card(x[0],x[1],x[2],'SHOW ON MAP')));p.append(g);
}
function drawWeatherReport(p){
 const g=el('div',{class:'tm-stack'}),items=[['LIVE CLOUD','Current-day cloud/imagery layer',()=>engine().selectWeather('live')],['RAIN','Weather report focused on rain',()=>weatherSelect('precip')],['PRECIPITATION','Precipitation layer/report',()=>weatherSelect('precip')],['WIND','Wind report/layer',()=>weatherSelect('wind')],['TEMPERATURE','Temperature report/layer',()=>weatherSelect('temp')],['HUMIDITY','Humidity report/layer',()=>weatherSelect('humidity')],['PRESSURE','Pressure report/layer',()=>weatherSelect('pressure')]];
 items.forEach(x=>g.append(card(x[0],x[1],x[2],'SELECT')));p.append(g);
 const periods=el('div',{class:'tm-periods'});['DAY','MONTH','QUARTER','YEAR'].forEach(x=>{const b=el('button',{type:'button',class:x===state.period?'on':''},x);b.onclick=()=>{state.period=x;renderWeatherReport(p)};periods.append(b)});p.append(periods);
 const timeline=el('div',{class:'tm-timeline'});const l=el('button',{type:'button'},'◀');const r=el('button',{type:'button'},'▶');const ts=el('span',{},'TIMELINE · '+new Date().toLocaleString());const link=el('button',{type:'button'},'OPEN TIMELINE');l.onclick=()=>shiftPeriod(-1);r.onclick=()=>shiftPeriod(1);link.onclick=()=>showTimeline(p);timeline.append(l,ts,r,link);p.append(timeline);loadWeatherReport();
}
function renderWeatherReport(p){drawWeatherReport(p)}
function weatherSelect(k){const e=engine();if(e)e.selectWeather(k);loadWeatherReport()}
function shiftPeriod(d){const p=$('#tm-panel-body');if(p)loadWeatherReport(d)}
async function loadWeatherReport(){const p=document.querySelector('.tm-panel-body');if(!p)return;const m=map();if(!m)return;
 const c=m.getCenter(), now=new Date(), days=state.period==='DAY'?1:state.period==='MONTH'?30:state.period==='QUARTER'?90:365;
 const end=new Date(now),start=new Date(now);start.setDate(start.getDate()-days);
 const fmt=d=>d.toISOString().slice(0,10);
 const u='https://archive-api.open-meteo.com/v1/archive?latitude='+c.lat.toFixed(3)+'&longitude='+c.lng.toFixed(3)+'&start_date='+fmt(start)+'&end_date='+fmt(end)+'&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto';
 try{const j=await fetch(u).then(r=>r.json()),d=j.daily||{},n=(d.time||[]).length;const box=el('div',{class:'tm-report'},'WEATHER REPORT · '+state.period+' · '+(j.timezone||'local'));box.append(el('div',{},n+' daily points'));if(n){const last=n-1;box.append(el('div',{},'Latest: '+d.time[last]+' · '+(d.temperature_2m_min?.[last]??'—')+'–'+(d.temperature_2m_max?.[last]??'—')+' °C · precip '+(d.precipitation_sum?.[last]??'—')+' mm · wind max '+(d.wind_speed_10m_max?.[last]??'—')+' km/h'))}p.append(box)}catch(e){p.append(status('Weather report unavailable for the current map center.'))}
}
function showTimeline(p){p.append(status('Timeline is tied to the selected weather period. Use ◀ / ▶ to move the reporting window and the day/month/quarter/year selector to change scale.'))}
function drawCommunication(p){
 p.append(status('TrackMeNow communication uses native WebRTC. Calls require microphone/camera permission and an authorized peer. Phone is a communication/contact entry, not a location mechanism.'));
 p.append(card('WEBRTC','Open the native TrackMeNow call room.',()=>{window.open('./rtc-call.html','_blank','noopener,noreferrer')},'OPEN CALL'));
 p.append(card('VIDEO','WebRTC video communication.',()=>window.open('./rtc-call.html','_blank','noopener,noreferrer'),'VIDEO CALL'));
 p.append(card('VOICE','WebRTC voice communication.',()=>window.open('./rtc-call.html','_blank','noopener,noreferrer'),'VOICE CALL'));
 p.append(card('PHONE','Open the device/contact phone action without using it for location.',()=>{const n=prompt('Phone number to call:');if(n)location.href='tel:'+n.replace(/[^+0-9]/g,'')},'PHONE'));
}
function drawTrack(p){
 if(state.sub==='GPS')return drawGps(p);
 if(state.sub==='IP')return drawIp(p);
 if(state.sub==='CELL')return drawCell(p);
 if(state.sub==='DEVICE'||state.sub==='CONSENT')return drawDevice(p);
 if(state.sub==='HISTORY')return drawHistory(p);
 if(state.sub==='GEOFENCE')return drawGeofence(p);
}
function drawGps(p){
 const hasDevice=!!localStorage.getItem('tmDeviceId')&&!!localStorage.getItem('tmDeviceToken');
 const viewerToken=localStorage.getItem('tmViewerToken')||'';
 const c=card('LIVE GPS',
   isLocal
     ? 'Start GPS on this browser/device. The position is recorded to the local TrackMeNow session.'
     : (viewerToken
       ? 'Viewing a consented mobile device. TrackMeNow will receive its latest GPS telemetry and draw it here.'
       : 'To view another consenting phone, enter its one-time pairing code below. A phone number alone never provides GPS.'),
   startGps,
   gps.watch?'STOP LIVE GPS':(viewerToken?'VIEW LIVE DEVICE':'START LIVE GPS'));
 p.append(c);

 if(!isLocal&&!viewerToken){
   const pairCode=el('input',{class:'tm-input',id:'tm-gps-pair-code',placeholder:'6-digit pairing code',inputmode:'numeric',maxlength:'6'});
   const pair=el('button',{class:'tm-action',type:'button'},'PAIR CONSENTED DEVICE');
   pair.onclick=async()=>{
     try{
       const code=String(pairCode.value||'').trim();
       if(!/^\\d{6}$/.test(code))throw Error('Enter the 6-digit pairing code from the consenting mobile device.');
       const j=await api('/api/devices/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pairingCode:code})});
       localStorage.setItem('tmViewerToken',j.viewerToken||'');
       localStorage.setItem('tmDeviceId',j.deviceId||'');
       gps.session=j.deviceId||null;
       gps.error='';
       alert('Device paired. Click VIEW LIVE DEVICE to start receiving its GPS location.');
       render();
     }catch(e){alert(e.message)}
   };
   const row=el('div',{class:'tm-row'});row.append(pairCode,pair);p.append(row);
 }

 const live=gps.lastFix
   ? 'GPS: LIVE · ±'+Math.round(gps.lastAccuracy||0)+' m · updated '+Math.max(0,Math.round((Date.now()-gps.lastFix)/1000))+'s ago · '+gps.trail.length+' points'
   : (gps.error?'GPS: ERROR · '+gps.error:'GPS: WAITING FOR FIX');
 p.append(status(live+' · '+(gps.session?'DEVICE '+gps.session:(hasDevice?'CONSENTED DEVICE REGISTERED':'NO DEVICE REGISTERED'))));
}

function stopGpsWatch(){
 if(gps.watch!==null){
   navigator.geolocation.clearWatch(gps.watch);
   gps.watch=null;
 }
 if(gps.poll){clearInterval(gps.poll);gps.poll=null}
}

async function startRemoteGps(){
 const deviceId=localStorage.getItem('tmDeviceId');
 const viewerToken=localStorage.getItem('tmViewerToken');
 if(!deviceId||!viewerToken)throw Error('Pair the consenting mobile device first.');
 stopGpsWatch();
 gps.session=deviceId;
 gps.trail=[];
 gps.error='';
 const consume=async()=>{
   try{
     const j=await api('/api/devices/'+encodeURIComponent(deviceId)+'/latest',{headers:{Authorization:'Bearer '+viewerToken}});
     const q=j.latest;
     if(!q||!Number.isFinite(Number(q.lat))||!Number.isFinite(Number(q.lon))){
       gps.error='Waiting for the consenting mobile device to send its first GPS fix.';
       render();
       return;
     }
     const point={lat:Number(q.lat),lon:Number(q.lon),accuracy:q.accuracy,altitude:q.altitude,heading:q.heading,speed:q.speed,source:q.source||'android-gps',timestamp:q.timestamp||new Date().toISOString()};
     gps.trail.push(point);
     if(gps.trail.length>2000)gps.trail.splice(0,gps.trail.length-2000);
     const m=map();
     if(m&&window.maplibregl){
       ensureGpsLayers(m);paintGpsTrack(m,gps.trail);
       if(!gps.marker)gps.marker=new maplibregl.Marker({color:'#43e0a0'}).setLngLat([point.lon,point.lat]).addTo(m);
       else gps.marker.setLngLat([point.lon,point.lat]);
       m.flyTo({center:[point.lon,point.lat],zoom:Math.max(m.getZoom(),12),duration:400});
     }
     gps.lastFix=Date.now();
     gps.lastAccuracy=Number(point.accuracy)||null;
     gps.error='';
     render();
   }catch(e){gps.error=e.message||'Unable to read device GPS';render()}
 };
 await consume();
 gps.poll=setInterval(consume,5000);
 render();
}

async function startGps(){
 if(gps.watch!==null||gps.poll){stopGpsWatch();render();return}
 try{
   const viewerToken=localStorage.getItem('tmViewerToken');
   const deviceId=localStorage.getItem('tmDeviceId');

   // A paired viewer reads GPS from the consenting mobile device; it must never
   // attempt to POST telemetry using the device's secret token.
   if(!isLocal&&viewerToken&&deviceId){
     await startRemoteGps();
     return;
   }

   let registeredDeviceId=localStorage.getItem('tmDeviceId');
   let deviceToken=localStorage.getItem('tmDeviceToken');

   // If this is the first use on a phone/browser, register THIS device.
   // Entering a phone number does not remotely activate that phone's GPS.
   if(!registeredDeviceId){
     const phone=prompt('Enter the mobile number for THIS consenting device:');
     if(!phone)return;
     if(!confirm('I own this device and consent to live GPS tracking.'))return;
     const j=await api('/api/devices/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,label:'TrackMeNow Live GPS',consent:true})});
     registeredDeviceId=j.deviceId;deviceToken=j.deviceToken;
     localStorage.setItem('tmDeviceId',registeredDeviceId);
     localStorage.setItem('tmDeviceToken',deviceToken);
     alert('This device is registered. Pairing code: '+j.pairingCode+'\\n\\nIf this is the phone being tracked, keep this page open and allow GPS permission. If this is a desktop viewer, enter the code in the PAIR CONSENTED DEVICE box after registering the phone in the mobile TrackMeNow companion.');
   }

   if(isLocal){
     const ss=await api('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
     gps.session=ss.id;
   }else{
     gps.session=registeredDeviceId;
   }

   gps.trail=[];gps.error='';
   const publish=async(pos)=>{
     const q=pos.coords;
     const point={lat:q.latitude,lon:q.longitude,accuracy:q.accuracy,altitude:q.altitude,heading:q.heading,speed:q.speed,source:'browser-gps',timestamp:new Date(pos.timestamp).toISOString()};
     gps.trail.push(point);
     if(gps.trail.length>2000)gps.trail.splice(0,gps.trail.length-2000);
     if(isLocal){
       await api('/api/sessions/'+gps.session+'/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(point)}).catch(e=>{gps.error='Location save failed: '+e.message});
     }else{
       await api('/api/devices/'+gps.session+'/telemetry',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+deviceToken},body:JSON.stringify(point)}).catch(e=>{gps.error='Telemetry upload failed: '+e.message});
     }
     const m=map();
     if(m&&window.maplibregl){
       ensureGpsLayers(m);paintGpsTrack(m,gps.trail);
       if(!gps.marker)gps.marker=new maplibregl.Marker({color:'#43e0a0'}).setLngLat([q.longitude,q.latitude]).addTo(m);
       else gps.marker.setLngLat([q.longitude,q.latitude]);
       m.flyTo({center:[q.longitude,q.latitude],zoom:Math.max(m.getZoom(),12),duration:400});
     }
     gps.lastFix=Date.now();gps.lastAccuracy=q.accuracy;gps.error='';
     render();
   };
   const onError=e=>{gps.error=(e&&e.message)||'Unable to acquire GPS. Check browser location permission.';console.warn(e);render()};
   navigator.geolocation.getCurrentPosition(publish,onError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
   gps.watch=navigator.geolocation.watchPosition(publish,onError,{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
   render();
 }catch(e){alert(e.message)}
}
function drawIp(p){const input=el('input',{class:'tm-input',placeholder:'IP address or MY IP'}),b=el('button',{class:'tm-action',type:'button'},'LOOK UP');b.onclick=async()=>{try{const path=/^my ip$/i.test(input.value)?'/api/integrations/ip/my':'/api/integrations/ip/lookup?ip='+encodeURIComponent(input.value);const j=await api(path);if(Number.isFinite(+j.latitude)&&Number.isFinite(+j.longitude)&&map())map().flyTo({center:[+j.longitude,+j.latitude],zoom:7});}catch(e){alert(e.message)}};const row=el('div',{class:'tm-row'});row.append(input,b);p.append(row,status('IP location is approximate; it is not device GPS.'))}
function drawCell(p){const row=el('div',{class:'tm-row'});['mcc','mnc','lac','cellid'].forEach(x=>row.append(el('input',{class:'tm-input',id:'cell-'+x,placeholder:x.toUpperCase()})));const b=el('button',{class:'tm-action',type:'button'},'LOOK UP');b.onclick=async()=>{try{const q=['mcc','mnc','lac','cellid'].map(x=>x+'='+encodeURIComponent($('#cell-'+x).value)).join('&');const j=await api('/api/cell?'+q);const d=j.data||j;if(map()&&Number.isFinite(+d.longitude))map().flyTo({center:[+d.longitude,+d.latitude],zoom:13});}catch(e){alert(e.message)}};p.append(row,b,status('OpenCelliD is a public cell database estimate, not live handset location.'))}
function drawDevice(p){const phone=el('input',{class:'tm-input',placeholder:'+91 mobile number'}),label=el('input',{class:'tm-input',placeholder:'Device label'}),cons=el('label',{class:'tm-check'}),cb=el('input',{type:'checkbox'}),code=el('input',{class:'tm-input',placeholder:'6-digit pairing code'}),pair=el('button',{class:'tm-action',type:'button'},'PAIR VIEWER');cons.append(cb,document.createTextNode(' I own this device and consent to tracking'));const b=el('button',{class:'tm-action',type:'button'},'REGISTER + GENERATE 6-DIGIT CODE');b.onclick=async()=>{if(!cb.checked)return alert('Owner consent is required.');try{const j=await api('/api/devices/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone.value,label:label.value||'My TrackMeNow device',consent:true})});localStorage.setItem('tmDeviceId',j.deviceId||'');localStorage.setItem('tmDeviceToken',j.deviceToken||'');p.append(card('PAIRING CODE',String(j.pairingCode||'—'),null,'KEEP CODE PRIVATE'));}catch(e){alert(e.message)}};pair.onclick=async()=>{try{const j=await api('/api/devices/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pairingCode:code.value.trim(),phone:phone.value.trim()})});localStorage.setItem('tmViewerToken',j.viewerToken||'');localStorage.setItem('tmDeviceId',j.deviceId||localStorage.getItem('tmDeviceId')||'');alert('Viewer paired successfully.');}catch(e){alert(e.message)}};p.append(phone,label,cons,b,code,pair,status('The 6-digit code is generated by the consented device registration. A phone number alone never grants location.'))}
function drawHistory(p){
 const id=gps.session||localStorage.getItem('tmDeviceId');
 const phoneHistory=getPhoneSearchHistory();
 p.append(status('PHONE SEARCH HISTORY is retained locally as masked search records. GPS HISTORY is loaded from consented device telemetry.'));
 if(phoneHistory.length){
   const box=el('div',{class:'tm-report'});
   box.append(el('b',{},'PHONE SEARCH HISTORY'));
   phoneHistory.forEach(x=>{
     const row=el('div',{class:'tm-history-row'},(x.maskedPhone||'MOBILE')+' · '+(x.found?'FOUND':'NOT FOUND')+' · '+new Date(x.at).toLocaleString());
     row.style.cursor='pointer';
     row.onclick=()=>{const inp=$('#tm-global-search');if(inp){inp.value=x.maskedPhone;inp.focus()}};
     box.append(row);
   });
   const clear=el('button',{class:'tm-action',type:'button'},'CLEAR PHONE SEARCH HISTORY');
   clear.onclick=()=>{localStorage.removeItem(PHONE_SEARCH_HISTORY_KEY);render()};
   box.append(clear);p.append(box);
 }else p.append(status('No mobile-number searches have been recorded in this browser yet.'));
 if(!id){p.append(status('Start LIVE GPS or search and pair a consenting mobile device to load GPS history.'));return}
 const b=el('button',{class:'tm-action',type:'button'},'LOAD GPS HISTORY');
 const out=el('div',{class:'tm-report'});
 b.onclick=async()=>{
   try{
     let j;
     if(isLocal)j=await api('/api/sessions/'+id+'/history');
     else{
       const tok=localStorage.getItem('tmViewerToken')||'';
       if(!tok)throw Error('Pair the consenting device first, then load history with the viewer token.');
       const r=await api('/api/devices/'+id+'/history?limit=500',{headers:{Authorization:'Bearer '+tok}});
       j=r.history||[];
     }
     gps.trail=j.map(x=>({lat:Number(x.lat),lon:Number(x.lon),accuracy:x.accuracy,timestamp:x.timestamp||x.recorded_at||x.recordedAt})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon));
     const mm=map(); if(mm){ensureGpsLayers(mm);paintGpsTrack(mm,gps.trail); if(gps.trail.length){const last=gps.trail[gps.trail.length-1]; if(!gps.marker)gps.marker=new maplibregl.Marker({color:'#43e0a0'}).setLngLat([last.lon,last.lat]).addTo(mm); else gps.marker.setLngLat([last.lon,last.lat]);}}
     out.textContent='GPS HISTORY · '+j.length+' points · '+(j.length?new Date(j[0].recorded_at||j[0].recordedAt||j[0].timestamp).toLocaleString():'no points');
   }catch(e){out.textContent=e.message}
 };
 p.append(b,out);
}
function drawGeofence(p){p.append(status('Geofences use the current GPS session and server-side distance checks.'));p.append(card('CREATE GEOFENCE','Create around the current map center.',async()=>{const m=map();if(!m)return;const c=m.getCenter(),name=prompt('Geofence name','My zone'),radius=Number(prompt('Radius in metres','500'));if(!name||!radius)return;await api('/api/geofences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:gps.session,lat:c.lat,lon:c.lng,radius_m:radius,name})});alert('Geofence created.')},'CREATE'))}
function cameraBbox(){const m=map();if(!m)return null;const b=m.getBounds();return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',');}
let cameraLoadTimer=null,cameraLoadSeq=0;
function scheduleCameraAtlas(delay=250){clearTimeout(cameraLoadTimer);cameraLoadTimer=setTimeout(()=>loadCameraAtlas(),delay);}
async function loadCameraAtlas(){const m=map();if(!m)return;const bbox=cameraBbox();if(!bbox)return;const seq=++cameraLoadSeq;try{const j=await api('/api/cameras?bbox='+encodeURIComponent(bbox));if(seq!==cameraLoadSeq)return;if(!m.getSource('tm-cameras-atlas'))m.addSource('tm-cameras-atlas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});if(!m.getLayer('tm-cameras-atlas')){m.addLayer({id:'tm-cameras-atlas',type:'circle',source:'tm-cameras-atlas',paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,3,8,5,14,8],'circle-color':'#67d5ff','circle-stroke-color':'#071018','circle-stroke-width':1.5,'circle-opacity':.9}});m.on('click','tm-cameras-atlas',e=>{const f=e.features&&e.features[0],p=f&&f.properties;if(!p)return;const u=p.imageUrl||p.streamUrl||p.sourceUrl;new maplibregl.Popup({closeButton:true,maxWidth:'300px'}).setLngLat(e.lngLat).setHTML('<b>'+String(p.title||'PUBLIC CAMERA').replace(/[<>]/g,'')+'</b><div style="opacity:.65;font-size:11px;margin-top:4px">'+String(p.provider||'Public source').replace(/[<>]/g,'')+'</div><div style="font-size:11px;margin-top:5px">'+String(p.location||'').replace(/[<>]/g,'')+'</div><div style="opacity:.6;font-size:10px;margin-top:5px">Observed '+(p.observedAt?new Date(p.observedAt).toLocaleString():'—')+'</div>'+((u)?'<button id="tm-open-camera" style="margin-top:8px">OPEN SOURCE</button>':'')).addTo(m);setTimeout(()=>{const b=document.getElementById('tm-open-camera');if(b)b.onclick=()=>window.open(u,'_blank','noopener,noreferrer')},0)});/* Camera details are click-only; no hover inspection. */}m.getSource('tm-cameras-atlas').setData({type:'FeatureCollection',features:j.features||[]});m.setLayoutProperty('tm-cameras-atlas','visibility',(j.features||[]).length?'visible':'none');const s=(j.sources||[])[0];setStatus('CAMERAS · '+(s&&s.count||0).toLocaleString()+' · '+(s&&s.source||'public feed')+' · '+(s&&s.status||'STATUS'),!!(j.features||[]).length)}catch(e){setStatus('CAMERAS · '+(e.message||'source unavailable'),false)}}
function bindCameraMap(){
 try{
  const m=map(); if(!m||m.__tmCameraMapBound)return;
  m.__tmCameraMapBound=true;
  scheduleCameraAtlas(700);
  m.on('moveend',()=>scheduleCameraAtlas(450));
 }catch(e){}
}
function drawVisuals(p){
 bindCameraMap();
 if(state.sub==='CAMERAS'){p.append(status('CAMERAS follows the TrackMeNow public-source model: official public traffic/mobility camera feeds are normalized by TrackMeNow and shown with source attribution. No reference website is embedded and no private camera feed is used.'));const g=el('div',{class:'tm-stack'});g.append(card('LIVE CAMERA FEEDS','Load current public/authorized camera image and video records for the current map viewport.',()=>loadCameraAtlas(),'LOAD LIVE CAMERAS'));g.append(card('SOURCE POLICY','Each camera must expose a permitted current image or stream URL. The original operator/source remains visible; TrackMeNow does not alter the media.',null,'SOURCE STATUS'));p.append(g);
try{scheduleCameraAtlas(0)}catch(e){}
return;}
 p.append(status('LIVE/PUBLIC resources only. TrackMeNow uses documented public/authorized sources and keeps source attribution. No private portals or embedded reference websites. HISTORY means source-provided history/metadata; USER SHARED means a reference shared by the user.'));
 if(state.sub==='USER SHARED'){
   const u=el('input',{class:'tm-input',placeholder:'Paste a public/authorized image, video, live or recorded source URL'}),b=el('button',{class:'tm-action',type:'button'},'OPEN SHARED SOURCE');
   b.onclick=()=>{if(/^https:\/\//i.test(u.value.trim()))window.open(u.value.trim(),'_blank','noopener,noreferrer');else alert('Use a public HTTPS source URL.')};
   const row=el('div',{class:'tm-row'});row.append(u,b);p.append(row,status('The URL is opened at its original source. TrackMeNow does not upload or retain the media.'));
   return;
 }
 const load=()=>api('/api/visuals?category='+encodeURIComponent(state.sub)).then(j=>{const g=el('div',{class:'tm-stack'});(j.sources||[]).forEach(s=>g.append(card((s.status||'SOURCE')+' · '+(s.title||s.type||'visual'),[s.provider,s.location,s.timestamp].filter(Boolean).join(' · '),null,'BACKEND SOURCE')));if(!g.children.length)g.append(card(state.sub==='HISTORY'?'NO SOURCE HISTORY':'NO CURRENT PUBLIC SOURCE',state.sub==='HISTORY'?'No source-provided historical metadata is available right now.':'No configured source is available. TrackMeNow does not invent or store media.'));p.append(g)}).catch(e=>p.append(status('Visual source registry unavailable: '+e.message)));
 load();
}
function drawMore(p){
 if(state.sub==='ADMIN')return p.append(card('ADMIN LOGS','Open the protected admin audit dashboard.',openAdmin,'OPEN ADMIN'));
 if(state.sub==='SOURCES')return drawSources(p);
 if(state.sub==='STATUS')return drawStatus(p);
 p.append(card('SETTINGS','Map, privacy, live-source and communication settings belong here. Current defaults keep public media live and unstored.',null,''));
}
function drawSources(p){
 const g=el('div',{class:'tm-stack'});
 const m=map(), b=m?m.getBounds():null, bbox=b?[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(','):'-180,-85,180,85';
 Promise.all([
   api('/api/sources?bbox='+encodeURIComponent(bbox)),
   api('/api/references'),
   api('/api/environment/catalog')
 ]).then(([j,r,e])=>{
   (j.sources||[]).forEach(s=>g.append(card((s.layer||'SOURCE').toUpperCase(),(s.source||'Unknown')+' · '+(s.status||'unknown')+' · '+(Number(s.count||0)).toLocaleString()+' objects'+(s.observedAt?' · observed '+new Date(s.observedAt).toLocaleTimeString():''),null,s.error?'SOURCE ERROR':'LIVE SOURCE')));
   const c=j.configuration||{};
   g.append(card('CAMERAS',c.camera==='configured'?'Configured public camera feed':'No live camera feed configured; catalogue data is not claimed as video',null,'BACKEND'));
   g.append(card('TAXI',c.taxi?'Configured real-time taxi feed':'No authorized/public taxi vehicle feed configured',null,'BACKEND'));
   g.append(card('GBFS',c.gbfs?'Configured real-time mobility feed':'No GBFS vehicle feed configured',null,'BACKEND'));
   g.append(card('REFERENCE IMPLEMENTATION','Public behavior from TRAVIC, GeoP GeOps Mobility, TrackMyMetro, RouteMetro, YoMetro, Global Nature Watch, Uber, Land Carbon Lab, NOAA Earth Real-Time, Google Earth, Copernicus Sentinel and ARGOS is represented through TrackMeNow adapters/UI workflows. Reference sites are not embedded.',null,'SOURCE POLICY'));
   (r.sources||[]).forEach(x=>g.append(card(x.name,x.capabilities.join(' · '),null,x.policy==='handoff-only-no-scraping'?'HANDOFF':'ADAPTER')));
   (e.sources||[]).forEach(x=>g.append(card(x.name,x.status+' · '+x.url,null,'EARTH / ENV')));
   p.append(g);
 }).catch(err=>p.append(status('Source registry unavailable: '+err.message)));
 p.append(status('Reference websites are used as functional and data-discovery references. TrackMeNow fetches permitted public data through its own backend adapters; it does not iframe or copy their private code.'));
}
function drawStatus(p){
 p.append(status('Checking the Worker, the database and each live transport layer…'));
 Promise.all([api('/health').catch(e=>({ok:false,error:e.message})),api('/api/db-test').catch(e=>({ok:false,error:e.message}))]).then(([h,d])=>{
   p.innerHTML='';
   const g=el('div',{class:'tm-stack'});
   g.append(card('WORKER',h.ok?'Reachable · cell lookup '+(h.cell?'configured':'needs OPENCELLID_API_KEY')+' · device API '+(h.devices?'configured':'needs the DB binding'):'Not reachable: '+(h.error||'unknown error'),null,''));
   g.append(card('DATABASE',d.ok?'Connected'+(d.pairingExpiryColumn===false?' (run the migration SQL)':''):'Not connected: '+(d.error||'unknown error'),null,''));
   const e=engine();
   (e&&e.transportStatus?e.transportStatus():[]).forEach(r=>{
     g.append(card(r.label,r.loaded?r.count.toLocaleString()+' '+(r.kind==='cells'?'towers':'live')+' · '+r.ageMinutes+' min old'+(r.on?'':' (off)'):(r.error?'Not loaded: '+r.error:'Not loaded yet'),null,''));
   });
   p.append(g);
 }).catch(()=>{p.innerHTML='';p.append(status('Status unavailable right now.'))});
}
function drawSearch(p){
 const i=el('input',{class:'tm-input',id:'tm-panel-search',placeholder:'Search city, place, phone number, device, cell ID, aircraft, IP…'});
 const b=el('button',{class:'tm-action',type:'button'},'SEARCH');
 b.onclick=()=>doSearch(i.value);i.onkeydown=e=>{if(e.key==='Enter')doSearch(i.value)};
 const row=el('div',{class:'tm-row'});row.append(i,b);p.append(row);
 p.append(status('Places, coordinates, phone numbers, aircraft, IP, device and cell identifiers are supported where an authorized/public source exists.'));
}
async function doSearch(q){
 q=String(q||'').trim();if(!q)return;
 logUi('search',state.tab,state.sub,/^\\+?[0-9][0-9 ()-]{6,18}$/.test(q)?phoneMask(q):q);
 try{
   if(/^\\+?[0-9][0-9 ()-]{6,18}$/.test(q)){
     const clean=q.replace(/[^0-9+]/g,'');
     try{
       const j=await api('/api/devices/search?phone='+encodeURIComponent(clean));
       savePhoneSearchHistory(clean,!!j.found,j.deviceId);
       state.tab='TRACK';state.sub='DEVICE';state.panel=true;render();
       const body=document.querySelector('#tm-panel .tm-panel-body');
       if(body){
         const found=el('div',{class:'tm-status'},j.found?'CONSENTED DEVICE FOUND · '+(j.maskedPhone||phoneMask(clean)):'NO CONSENTED TRACKMENOW DEVICE FOUND FOR '+phoneMask(clean));
         body.append(found);
         if(j.found){
           const viewer=localStorage.getItem('tmViewerToken');
           if(viewer){
             try{
               const loc=await api('/api/devices/lookup?phone='+encodeURIComponent(clean),{headers:{Authorization:'Bearer '+viewer}});
               if(loc.deviceId) localStorage.setItem('tmDeviceId',loc.deviceId);
               if(loc.location&&map()&&Number.isFinite(+loc.location.lon)&&Number.isFinite(+loc.location.lat)){
                 map().flyTo({center:[+loc.location.lon,+loc.location.lat],zoom:15,duration:900});
                 body.append(status('AUTHORIZED DEVICE LOCATION · updated '+new Date(loc.location.timestamp||Date.now()).toLocaleString()));
               } else body.append(status('Device is registered, but no recent GPS telemetry is available. Open TRACK → HISTORY to load stored telemetry.'));
             }catch(e){body.append(status('Pairing required to view this device location/history. Open TRACK → DEVICE and enter its one-time pairing code.'))}
           }else body.append(status('Pairing required. Open TRACK → DEVICE and enter the one-time pairing code from the consented device.'));
         }
         const hist=getPhoneSearchHistory();
         body.append(status('PHONE SEARCH HISTORY · '+hist.length+' saved searches · masked locally in this browser.'));
       }
       return;
     }catch(e){
       savePhoneSearchHistory(clean,false,null);
       state.tab='TRACK';state.sub='DEVICE';state.panel=true;render();
       const body=document.querySelector('#tm-panel .tm-panel-body');
       if(body)body.append(status(e.message||'Phone search unavailable.'));
       return;
     }
   }
   let j=null;try{j=await api('/api/global/search?q='+encodeURIComponent(q));}catch(e){try{j=await api('/api/search?q='+encodeURIComponent(q));}catch(e2){j=null}}
   if(!j){
     const nr=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}}).then(r=>r.json()).catch(()=>[]);
     j={results:(nr||[]).map(x=>({type:'place',lat:Number(x.lat),lon:Number(x.lon),label:x.display_name}))};
   }
   const x=(j.results||[])[0];
   if(x&&map()&&Number.isFinite(+x.lon))map().flyTo({center:[+x.lon,+x.lat],zoom:Math.max(8,map().getZoom()),duration:900});
   else alert('No live/public result found.');
 }catch(e){alert(e.message)}
}
function start(){const l=el('link',{rel:'stylesheet',href:'./visuals.css?v=trackmenow-premium-23'});document.head.append(l);build();window.TrackMeNowCameraAtlas={load:loadCameraAtlas,schedule:scheduleCameraAtlas,bind:bindCameraMap};let tries=0;const bootCameraLayer=()=>{const m=map();if(m){try{bindCameraMap();scheduleCameraAtlas(0)}catch(e){}return}if(++tries<80)setTimeout(bootCameraLayer,250)};bootCameraLayer();setTimeout(()=>{const z=$('#tm-zoom-common');if(z)z.title='Common map zoom'},100)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();