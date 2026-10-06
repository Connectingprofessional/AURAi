/* TrackMeNow — full category UI. All navigation lives in the bottom dock; map viewport ends above it. */
(function(){
'use strict';
const API=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?location.origin:'https://wispy-bush-9aee.recreationeeraj.workers.dev';
const isLocal=location.hostname==='localhost'||location.hostname==='127.0.0.1';
const T={
 MAP:['OVERVIEW','LAYERS','SEARCH'],
 SPACE:['SOLAR SYSTEM','EARTH','MOON','MARS','SATELLITES','ISS / SPACE STATIONS','EARTH OBSERVATION','SPACE WEATHER'],
 TRANSIT:['ALL TRANSPORT','AIR','SHIP','TAXI','BUS','RAILWAY','METRO','BOAT','PERSONAL JET','CAR','BIKES'],
 WEATHER:['NATURAL CALAMITIES','WEATHER REPORT'],
 COMMUNICATION:['WEBRTC','PHONE'],
 TRACK:['GPS','IP','CELL','DEVICE','HISTORY','GEOFENCE','CONSENT'],
 VISUALS:['LIVE','CAMERAS','IMAGES','VIDEOS','CLIPS','HISTORY','USER SHARED'],
 MORE:['ADMIN','SOURCES','STATUS','SETTINGS']
};
const state={tab:'MAP',sub:'OVERVIEW',stack:null,period:'DAY',panel:false};
let gps={watch:null,session:null,marker:null,lastFix:0,lastAccuracy:null,error:''}, historyTimer=null;
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
function setPanelTitle(){const h=$('#tm-panel-title');if(h)h.textContent=state.tab+' / '+state.sub+(state.stack?' / '+state.stack:'')}
function build(){
 const top=el('header',{id:'tm-top'});
 const brand=el('div',{class:'tm-brand'});brand.append(document.createTextNode('TRACKME'));const brandSpan=el('span',{},'NOW');brand.append(brandSpan);
 const search=el('div',{class:'tm-search'}),inp=el('input',{id:'tm-global-search',placeholder:'Search city, place, device, cell ID, aircraft, IP…',autocomplete:'off'}),go=el('button',{type:'button'},'SEARCH');
 go.onclick=()=>doSearch(inp.value);inp.onkeydown=e=>{if(e.key==='Enter')doSearch(inp.value)};search.append(inp,go);
 const admin=el('button',{id:'tm-admin',type:'button','aria-label':'Admin'},'⚙');admin.onclick=openAdmin;
 top.append(brand,search,admin);document.body.append(top);
 const shell=el('div',{id:'tm-shell'});
 const main=el('nav',{id:'tm-main-tabs'});Object.keys(T).forEach(k=>{const b=el('button',{class:'tm-tab',type:'button'},k);b.onclick=()=>{state.tab=k;state.sub=T[k][0];state.stack=null;state.panel=false;logUi('tab',k,'');render()};main.append(b)});
 const sub=el('div',{id:'tm-subbar'});
 const zoom=el('div',{class:'tm-zoom-common'});[['−',-1],['+',1]].forEach(([txt,d])=>{const b=el('button',{type:'button'},txt);b.onclick=()=>engine()&&engine().zoomBy(d);zoom.append(b)});
 const panel=el('section',{id:'tm-panel'});const head=el('div',{class:'tm-panel-head'}),title=el('div',{id:'tm-panel-title',class:'tm-panel-title'}),meta=el('div',{class:'tm-panel-meta'},'LIVE / PUBLIC / CONSENT-BASED'),close=el('button',{class:'tm-close',type:'button'},'×');close.onclick=()=>{state.panel=false;render()};head.append(title,meta,close);panel.append(head);
 shell.append(main,sub,zoom,panel);document.body.append(shell);render();
}
function render(){
 const main=$('#tm-main-tabs'),sub=$('#tm-subbar'),panel=$('#tm-panel');Array.from(main.children).forEach(b=>b.classList.toggle('active',b.textContent===state.tab));
 sub.innerHTML='';T[state.tab].forEach(s=>{const b=el('button',{class:'tm-sub',type:'button'},s);b.classList.toggle('active',s===state.sub);b.onclick=()=>{state.sub=s;state.stack=null;state.panel=true;logUi('subtab',state.tab,s);render()};sub.append(b)});
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
function drawMap(p){
 if(state.sub==='SEARCH')return drawSearch(p);
 const items={OVERVIEW:['SATELLITE','LIVE','3D','FLAT','RADAR','DAY / NIGHT'],LAYERS:['SATELLITE','LIVE','RADAR','DAY / NIGHT'],SEARCH:[]}[state.sub]||[];
 p.append(status('Map views are mutually selectable; the common zoom control stays in the dock.'));
 const g=el('div',{class:'tm-stack'});
 items.forEach(k=>g.append(card(k,'Select this map view.',()=>mapAction(k),'SELECT')));p.append(g);
}
function mapAction(k){
 const e=engine();if(!e)return;
 if(k==='SATELLITE')oldClick('[data-bar="satellite"]');
 if(k==='LIVE')e.selectWeather('live');
 if(k==='RADAR')e.selectWeather('radar');
 if(k==='DAY / NIGHT')oldClick('[data-bar="daynight"]');
 if(k==='FLAT')e.setEarthMode('flat');
 if(k==='3D')e.setEarthMode('globe');
}
function drawSpace(p){
 const planetActions={'SOLAR SYSTEM':'solar','EARTH':'earth3d','MOON':'moon','MARS':'mars'};
 p.append(status('SPACE is powered by TrackMeNow source adapters. Reference websites are not embedded; their public data is normalized by the backend and rendered here.'));
 const g=el('div',{class:'tm-stack'});
 if(planetActions[state.sub]){
   const k=state.sub;
   g.append(card(k,k==='EARTH'?'Return to the live Earth globe.':k==='SOLAR SYSTEM'?'Open the Solar System orbital view.':'Open the interactive '+k.toLowerCase()+' view.',()=>{const e=engine();if(e)e.setScale(planetActions[k]);},'OPEN 3D'));
 } else if(state.sub==='SATELLITES'){
   const loadSatellites=async()=>{
     try{
       const m=map(),c=m?m.getCenter():{lat:28.6139,lng:77.209};
       const j=await api('/api/space/satellites?lat='+encodeURIComponent(c.lat)+'&lon='+encodeURIComponent(c.lng)+'&seconds=90&category=0');
       if(!m)throw new Error('Map unavailable');
       const feats=(j.satellites||[]).filter(s=>Number.isFinite(Number(s.satlat))&&Number.isFinite(Number(s.satlng))).map(s=>({type:'Feature',geometry:{type:'Point',coordinates:[Number(s.satlng),Number(s.satlat)]},properties:{name:s.satname||s.satid,id:s.satid,altitude:s.satalt,source:'N2YO',sourceStatus:'live'}}));
       if(!m.getSource('tm-satellites'))m.addSource('tm-satellites',{type:'geojson',data:{type:'FeatureCollection',features:feats}});
       else m.getSource('tm-satellites').setData({type:'FeatureCollection',features:feats});
       if(!m.getLayer('tm-satellites'))m.addLayer({id:'tm-satellites',type:'circle',source:'tm-satellites',paint:{'circle-radius':['interpolate',['linear'],['zoom'],1,2,5,4,10,6],'circle-color':'#b7f36b','circle-stroke-color':'#071018','circle-stroke-width':1}});
       setStatus('SATELLITES · '+feats.length+' live orbital objects · N2YO',true);
       if(feats[0])m.flyTo({center:feats[0].geometry.coordinates,zoom:3,duration:700});
     }catch(e){p.append(status('Satellite source unavailable: '+e.message));}
   };
   g.append(card('SATELLITES','Fetch current orbital positions through the TrackMeNow Worker.',loadSatellites,'LOAD LIVE SATELLITES'));
   g.append(card('ISS','Fetch the current ISS position from the public ISS source.',async()=>{try{const j=await api('/api/space/iss');const f=j.feature;if(f&&map())map().flyTo({center:f.geometry.coordinates,zoom:5});setStatus('ISS · LIVE · '+new Date(j.observedAt).toLocaleTimeString(),true);}catch(e){p.append(status('ISS source unavailable: '+e.message));}},'LOAD LIVE ISS'));
   g.append(card('SOURCE CONFIG','Broader satellite coverage uses N2YO through a Worker secret. The map never embeds the reference website.',null,'BACKEND'));
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
const transitMap={AIR:'air',SHIP:'ships',RAILWAY:'rail',BOAT:'ships','PERSONAL JET':'air',TAXI:'taxi',BUS:'transit',METRO:'transit',CAR:'car',BIKES:'bike'};
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
 const sim=el('button',{type:'button',class:'tm-action'},'RUN TRANSPORT SIMULATION');
 sim.onclick=()=>{const e=engine();if(e&&e.startTransportSimulation)e.startTransportSimulation();};
 p.append(sim);
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
function drawGps(p){const hasDevice=!!localStorage.getItem('tmDeviceId')&&!!localStorage.getItem('tmDeviceToken');const c=card('LIVE GPS',isLocal?'Permission-based browser GPS. Local sessions are stored by the tracking API.':'Permission-based browser GPS. On GitHub Pages, consented device telemetry is stored through the TrackMeNow Worker/D1 history API.',startGps,gps.watch?'STOP LIVE GPS':'START LIVE GPS');p.append(c);const live=gps.lastFix?'GPS: LIVE · ±'+Math.round(gps.lastAccuracy||0)+' m · updated '+Math.max(0,Math.round((Date.now()-gps.lastFix)/1000))+'s ago':(gps.error?'GPS: ERROR · '+gps.error:'GPS: WAITING FOR FIX');p.append(status(live+' · '+(gps.session?'SESSION / DEVICE '+gps.session:(hasDevice?'CONSENTED DEVICE READY':'CONSENTED DEVICE REQUIRED'))))}
async function startGps(){
 if(gps.watch!==null){navigator.geolocation.clearWatch(gps.watch);gps.watch=null;if(isLocal&&gps.session)await api('/api/sessions/'+gps.session+'/stop',{method:'POST'}).catch(()=>{});render();return}
 try{
   let deviceId=localStorage.getItem('tmDeviceId'),deviceToken=localStorage.getItem('tmDeviceToken');
   if(!isLocal&&!deviceId){const phone=prompt('Enter the mobile number for this consenting device:');if(!phone)return;if(!confirm('I own this device and consent to live GPS tracking.'))return;const j=await api('/api/devices/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,label:'TrackMeNow Live GPS',consent:true})});deviceId=j.deviceId;deviceToken=j.deviceToken;localStorage.setItem('tmDeviceId',deviceId);localStorage.setItem('tmDeviceToken',deviceToken);alert('Consent registered. Pairing code: '+j.pairingCode+'\nKeep this code private; use it to authorize a viewer.')}
   if(isLocal){const s=await api('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});gps.session=s.id}
   else gps.session=deviceId;
   const publish=async(pos)=>{
     const q=pos.coords, body={lat:q.latitude,lon:q.longitude,accuracy:q.accuracy,altitude:q.altitude,heading:q.heading,speed:q.speed,source:'browser-gps',timestamp:new Date(pos.timestamp).toISOString()};
     if(isLocal)await api('/api/sessions/'+gps.session+'/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});
     else await api('/api/devices/'+gps.session+'/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},Authorization:'Bearer '+deviceToken,body:JSON.stringify(body)}).catch(()=>{});
     const m=map();if(m&&window.maplibregl){if(!gps.marker)gps.marker=new maplibregl.Marker({color:'#43e0a0'}).setLngLat([q.longitude,q.latitude]).addTo(m);else gps.marker.setLngLat([q.longitude,q.latitude]);m.flyTo({center:[q.longitude,q.latitude],zoom:Math.max(m.getZoom(),12),duration:400})}
     gps.lastFix=Date.now(); gps.lastAccuracy=q.accuracy;
   };
   const onError=e=>{gps.error=(e&&e.message)||'Unable to acquire GPS';console.warn(e);render();};
   navigator.geolocation.getCurrentPosition(publish,onError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
   gps.watch=navigator.geolocation.watchPosition(publish,onError,{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
   render();
 }catch(e){alert(e.message)}
}
function drawIp(p){const input=el('input',{class:'tm-input',placeholder:'IP address or MY IP'}),b=el('button',{class:'tm-action',type:'button'},'LOOK UP');b.onclick=async()=>{try{const path=/^my ip$/i.test(input.value)?'/api/integrations/ip/my':'/api/integrations/ip/lookup?ip='+encodeURIComponent(input.value);const j=await api(path);if(Number.isFinite(+j.latitude)&&Number.isFinite(+j.longitude)&&map())map().flyTo({center:[+j.longitude,+j.latitude],zoom:7});}catch(e){alert(e.message)}};const row=el('div',{class:'tm-row'});row.append(input,b);p.append(row,status('IP location is approximate; it is not device GPS.'))}
function drawCell(p){const row=el('div',{class:'tm-row'});['mcc','mnc','lac','cellid'].forEach(x=>row.append(el('input',{class:'tm-input',id:'cell-'+x,placeholder:x.toUpperCase()})));const b=el('button',{class:'tm-action',type:'button'},'LOOK UP');b.onclick=async()=>{try{const q=['mcc','mnc','lac','cellid'].map(x=>x+'='+encodeURIComponent($('#cell-'+x).value)).join('&');const j=await api('/api/cell?'+q);const d=j.data||j;if(map()&&Number.isFinite(+d.longitude))map().flyTo({center:[+d.longitude,+d.latitude],zoom:13});}catch(e){alert(e.message)}};p.append(row,b,status('OpenCelliD is a public cell database estimate, not live handset location.'))}
function drawDevice(p){const phone=el('input',{class:'tm-input',placeholder:'+91 mobile number'}),label=el('input',{class:'tm-input',placeholder:'Device label'}),cons=el('label',{class:'tm-check'}),cb=el('input',{type:'checkbox'}),code=el('input',{class:'tm-input',placeholder:'6-digit pairing code'}),pair=el('button',{class:'tm-action',type:'button'},'PAIR VIEWER');cons.append(cb,document.createTextNode(' I own this device and consent to tracking'));const b=el('button',{class:'tm-action',type:'button'},'REGISTER + GENERATE 6-DIGIT CODE');b.onclick=async()=>{if(!cb.checked)return alert('Owner consent is required.');try{const j=await api('/api/devices/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:phone.value,label:label.value||'My TrackMeNow device',consent:true})});localStorage.setItem('tmDeviceId',j.deviceId||'');localStorage.setItem('tmDeviceToken',j.deviceToken||'');p.append(card('PAIRING CODE',String(j.pairingCode||'—'),null,'KEEP CODE PRIVATE'));}catch(e){alert(e.message)}};pair.onclick=async()=>{try{const j=await api('/api/devices/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pairingCode:code.value.trim(),phone:phone.value.trim()})});localStorage.setItem('tmViewerToken',j.viewerToken||'');localStorage.setItem('tmDeviceId',j.deviceId||localStorage.getItem('tmDeviceId')||'');alert('Viewer paired successfully.');}catch(e){alert(e.message)}};p.append(phone,label,cons,b,code,pair,status('The 6-digit code is generated by the consented device registration. A phone number alone never grants location.'))}
function drawHistory(p){const id=gps.session||localStorage.getItem('tmDeviceId');if(!id){p.append(status('Start LIVE GPS first and complete device consent.'));return}const b=el('button',{class:'tm-action',type:'button'},'LOAD HISTORY');const out=el('div',{class:'tm-report'});b.onclick=async()=>{try{let j;if(isLocal)j=await api('/api/sessions/'+id+'/history');else{const tok=localStorage.getItem('tmViewerToken')||'';if(!tok)throw Error('Pair the consenting device first, then load history with the viewer token.');const r=await api('/api/devices/'+id+'/history?limit=500',{headers:{Authorization:'Bearer '+tok}});j=r.history||[]}out.textContent='HISTORY · '+j.length+' points · '+(j.length?new Date(j[0].recorded_at||j[0].recordedAt||j[0].timestamp).toLocaleString():'no points')}catch(e){out.textContent=e.message}};p.append(b,out)}
function drawGeofence(p){p.append(status('Geofences use the current GPS session and server-side distance checks.'));p.append(card('CREATE GEOFENCE','Create around the current map center.',async()=>{const m=map();if(!m)return;const c=m.getCenter(),name=prompt('Geofence name','My zone'),radius=Number(prompt('Radius in metres','500'));if(!name||!radius)return;await api('/api/geofences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:gps.session,lat:c.lat,lon:c.lng,radius_m:radius,name})});alert('Geofence created.')},'CREATE'))}
function cameraBbox(){const m=map();if(!m)return null;const b=m.getBounds();return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',');}
async function loadCameraAtlas(){const m=map();if(!m)return;const bbox=cameraBbox();if(!bbox)return;try{const j=await api('/api/cameras?bbox='+encodeURIComponent(bbox));if(!m.getSource('tm-cameras'))m.addSource('tm-cameras',{type:'geojson',data:{type:'FeatureCollection',features:[]}});if(!m.getLayer('tm-cameras')){m.addLayer({id:'tm-cameras',type:'circle',source:'tm-cameras',paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,3,8,5,14,8],'circle-color':'#67d5ff','circle-stroke-color':'#071018','circle-stroke-width':1.5,'circle-opacity':.9}});m.on('click','tm-cameras',e=>{const f=e.features&&e.features[0],p=f&&f.properties;if(!p)return;const u=p.imageUrl||p.streamUrl||p.sourceUrl;new maplibregl.Popup({closeButton:true,maxWidth:'300px'}).setLngLat(e.lngLat).setHTML('<b>'+String(p.title||'PUBLIC CAMERA').replace(/[<>]/g,'')+'</b><div style="opacity:.65;font-size:11px;margin-top:4px">'+String(p.provider||'Public source').replace(/[<>]/g,'')+'</div><div style="font-size:11px;margin-top:5px">'+String(p.location||'').replace(/[<>]/g,'')+'</div><div style="opacity:.6;font-size:10px;margin-top:5px">Observed '+(p.observedAt?new Date(p.observedAt).toLocaleString():'—')+'</div>'+((u)?'<button id="tm-open-camera" style="margin-top:8px">OPEN SOURCE</button>':'')).addTo(m);setTimeout(()=>{const b=document.getElementById('tm-open-camera');if(b)b.onclick=()=>window.open(u,'_blank','noopener,noreferrer')},0)});m.on('mouseenter','tm-cameras',()=>m.getCanvas().style.cursor='pointer');m.on('mouseleave','tm-cameras',()=>m.getCanvas().style.cursor='');}m.getSource('tm-cameras').setData({type:'FeatureCollection',features:j.features||[]});m.setLayoutProperty('tm-cameras','visibility',(j.features||[]).length?'visible':'none');const s=(j.sources||[])[0];setStatus('CAMERAS · '+(s&&s.count||0).toLocaleString()+' · '+(s&&s.source||'public feed')+' · '+(s&&s.status||'STATUS'),!!(j.features||[]).length)}catch(e){setStatus('CAMERAS · '+(e.message||'source unavailable'),false)}}
function drawVisuals(p){
 if(state.sub==='CAMERAS'){p.append(status('CAMERAS shows only real public/authorized image or video feeds configured in the TrackMeNow backend. Reference camera catalogues are never rendered as cameras.'));const g=el('div',{class:'tm-stack'});g.append(card('LIVE CAMERA FEEDS','Load real camera image/stream records for the current map viewport.',()=>loadCameraAtlas(),'LOAD LIVE CAMERAS'));g.append(card('SOURCE POLICY','A camera must expose an actual current image or stream URL through a permitted backend source.',null,'SOURCE STATUS'));p.append(g);loadCameraAtlas();return;}
 p.append(status('LIVE/PUBLIC resources only. TrackMeNow never copies or stores media. HISTORY means source-provided history/metadata; USER SHARED means a reference shared by the user, not an uploaded TrackMeNow media file.'));
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
 api('/api/sources?bbox='+encodeURIComponent(bbox)).then(j=>{
   (j.sources||[]).forEach(s=>g.append(card((s.layer||'SOURCE').toUpperCase(),(s.source||'Unknown')+' · '+(s.status||'unknown')+' · '+(Number(s.count||0)).toLocaleString()+' objects'+(s.observedAt?' · observed '+new Date(s.observedAt).toLocaleTimeString():''),null,s.error?'SOURCE ERROR':'LIVE SOURCE')));
   const c=j.configuration||{};
   g.append(card('CAMERAS',c.camera==='configured'?'Configured public camera feed':'Catalog only · no live video feed is claimed',null,'BACKEND'));
   g.append(card('TAXI',c.taxi?'Configured real-time taxi feed':'No authorized/public taxi vehicle feed configured',null,'BACKEND'));
   g.append(card('GBFS',c.gbfs?'Configured real-time mobility feed':'No GBFS vehicle feed configured',null,'BACKEND'));
   p.append(g);
 }).catch(e=>p.append(status('Source registry unavailable: '+e.message)));
 p.append(status('Reference websites are never embedded. Each layer must have a real backend source, observation timestamp and source status.'));
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
function drawSearch(p){const i=el('input',{class:'tm-input',id:'tm-panel-search',placeholder:'Search anything…'}),b=el('button',{class:'tm-action',type:'button'},'SEARCH');b.onclick=()=>doSearch(i.value);i.onkeydown=e=>{if(e.key==='Enter')doSearch(i.value)};const row=el('div',{class:'tm-row'});row.append(i,b);p.append(row,status('Places, coordinates, aircraft, IP, device and cell identifiers are supported where a live source exists.'))}
async function doSearch(q){q=String(q||'').trim();if(!q)return;try{if(/^\+?[0-9][0-9 ()-]{6,18}$/.test(q)){state.tab='TRACK';state.sub='DEVICE';state.panel=true;render();return}
 let j=null;try{j=await api('/api/global/search?q='+encodeURIComponent(q));}catch(e){try{j=await api('/api/search?q='+encodeURIComponent(q));}catch(e2){j=null}}
 if(!j){
   const nr=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q='+encodeURIComponent(q),{headers:{'Accept':'application/json'}}).then(r=>r.json()).catch(()=>[]);
   j={results:(nr||[]).map(x=>({type:'place',lat:Number(x.lat),lon:Number(x.lon),label:x.display_name}))};
 }
 const x=(j.results||[])[0];if(x&&map()&&Number.isFinite(+x.lon))map().flyTo({center:[+x.lon,+x.lat],zoom:Math.max(8,map().getZoom()),duration:900});else alert('No live/public result found.')}catch(e){alert(e.message)}}
function start(){const l=el('link',{rel:'stylesheet',href:'./visuals.css?v=full-frame-1'});document.head.append(l);build();setTimeout(()=>{const z=$('#tm-zoom-common');if(z)z.title='Common map zoom';},100)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();