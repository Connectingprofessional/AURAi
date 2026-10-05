/* TrackMeNow — bottom dock framework. No media is stored; public/authorized sources are opened at origin. */
(function(){
'use strict';
var API=(location.hostname==='localhost'||location.hostname==='127.0.0.1')?location.origin:'https://wispy-bush-9aee.recreationeeraj.workers.dev';
var tabs={
 MAP:{subs:['OVERVIEW','LAYERS','SEARCH']},
 TRANSPORT:{subs:['AIR','SEA','RAIL','BUS','TAXI']},
 WEATHER:{subs:['CURRENT','RADAR','PRECIP','WIND','TEMP','HUMIDITY','PRESSURE']},
 VISUALS:{subs:['LIVE','CAMERAS','WEBCAMS','IMAGES','VIDEOS','CLIPS','SOURCE HISTORY']},
 NETWORK:{subs:['CELLS','RADIO','CARRIERS','INFRASTRUCTURE']},
 DEVICES:{subs:['LIVE GPS','HISTORY','GEOfENCE','CONSENT']},
 EVENTS:{subs:['EARTHQUAKES','FIRES','STORMS','ALERTS']},
 SPACE:{subs:['EARTH','SOLAR SYSTEM','PLANETS','ASTEROIDS','UNIVERSE']},
 MORE:{subs:['ADMIN','SOURCES','STATUS','SETTINGS']}
};
var state={tab:'MAP',sub:'OVERVIEW',panel:false};
var fallback=[
 {type:'camera',status:'DISCOVERY',title:'Public camera sources',description:'Configured public camera feeds appear here. TrackMeNow does not scan private cameras.',source:'OpenStreetMap / configured public feeds'},
 {type:'webcam',status:'DISCOVERY',title:'Public webcams',description:'Open public webcam pages or feeds from their original provider.',source:'Provider source'},
 {type:'image',status:'RECORDED',title:'Public imagery',description:'External street, weather and map imagery remains at the original provider.',source:'Mapillary / KartaView / provider'},
 {type:'video',status:'PUBLIC',title:'Public video',description:'Public videos open at their original source; TrackMeNow does not copy them.',source:'Original publisher'},
 {type:'clip',status:'PUBLIC',title:'Clips',description:'Saved references can be added later without storing the media itself.',source:'Original publisher'}
];
function el(tag,attrs,text){var x=document.createElement(tag);if(attrs)Object.keys(attrs).forEach(function(k){x.setAttribute(k,attrs[k])});if(text!=null)x.textContent=text;return x}
function build(){
 var shell=el('div',{id:'tm-shell'});
 var main=el('nav',{id:'tm-main-tabs','aria-label':'TrackMeNow sections'});
 Object.keys(tabs).forEach(function(k){var b=el('button',{class:'tm-tab',type:'button'},k);b.onclick=function(){state.tab=k;state.sub=tabs[k].subs[0];state.panel=false;render()};main.appendChild(b)});
 var sub=el('div',{id:'tm-subbar','aria-label':'TrackMeNow subsections'});
 var panel=el('section',{id:'tm-panel','aria-live':'polite'});
 shell.appendChild(main);shell.appendChild(sub);shell.appendChild(panel);document.body.appendChild(shell);
 render();
}
function render(){
 var main=document.getElementById('tm-main-tabs'),sub=document.getElementById('tm-subbar'),panel=document.getElementById('tm-panel');
 Array.from(main.children).forEach(function(b){b.classList.toggle('active',b.textContent===state.tab)});
 sub.innerHTML='';
 tabs[state.tab].subs.forEach(function(s){var b=el('button',{class:'tm-sub',type:'button'},s);b.classList.toggle('active',s===state.sub);b.onclick=function(){state.sub=s;state.panel=true;render()};sub.appendChild(b)});
 panel.classList.toggle('open',state.panel);
 if(state.panel) drawPanel(panel);
}
function drawPanel(panel){
 panel.innerHTML='';
 var head=el('div',{class:'tm-panel-head'}),title=el('div',{class:'tm-panel-title'},state.tab+' / '+state.sub),meta=el('div',{class:'tm-panel-meta'},'LIVE RESOURCE · NO MEDIA STORAGE');
 var close=el('button',{class:'tm-close',type:'button','aria-label':'Close panel'},'×');close.onclick=function(){state.panel=false;render()};
 head.appendChild(title);head.appendChild(meta);head.appendChild(close);panel.appendChild(head);
 if(state.tab==='VISUALS'){drawVisuals(panel);return}
 if(state.tab==='MAP'&&state.sub==='SEARCH'){drawSearch(panel);return}
 if(state.tab==='DEVICES'&&state.sub==='LIVE GPS'){drawGps(panel);return}
 if(state.tab==='MORE'&&state.sub==='ADMIN'){location.href='./admin.html';return}
 var grid=el('div',{class:'tm-grid'});
 var card=el('div',{class:'tm-card'});card.appendChild(el('b',{},state.sub));card.appendChild(el('p',{},description(state.tab,state.sub)));grid.appendChild(card);panel.appendChild(grid);
}
function description(t,s){
 if(t==='TRANSPORT')return 'Live transport layer controls. Only sources that are actually configured and returning current observations are labelled LIVE.';
 if(t==='WEATHER')return 'Current weather and forecast layers. Forecast data is not presented as historical observation.';
 if(t==='NETWORK')return 'Public cell/network intelligence and infrastructure. A public cell estimate is never presented as live handset location.';
 if(t==='DEVICES')return 'Consent-based device tracking. A phone number alone never grants location access.';
 if(t==='EVENTS')return 'Live public event feeds with source and timestamp labels.';
 if(t==='SPACE')return 'Astronomy and space views already provided by the TrackMeNow map engine.';
 return 'Framework tab ready. The map remains the primary view and this panel is the only place for controls.';
}
function drawSearch(panel){
 var row=el('div',{class:'tm-row'}),input=el('input',{class:'tm-input',placeholder:'City, place, coordinates, device, Cell ID, aircraft…',id:'tmSearch'}),go=el('button',{class:'tm-action',type:'button'},'SEARCH');row.appendChild(input);row.appendChild(go);panel.appendChild(row);
 go.onclick=doSearch;input.onkeydown=function(e){if(e.key==='Enter')doSearch()};
}
function doSearch(){
 var q=(document.getElementById('tmSearch').value||'').trim();if(!q)return;
 if(window.tmFindObject){window.tmFindObject(q).catch(function(){})}
 else fetch(API+'/api/global/search?q='+encodeURIComponent(q)).then(function(r){return r.json()}).then(function(j){var x=j.results&&j.results[0];if(x&&window.map&&window.map.flyTo)window.map.flyTo({center:[x.lon,x.lat],zoom:10,duration:1000})}).catch(function(){});
}
function drawGps(panel){
 var c=el('div',{class:'tm-card'});c.appendChild(el('b',{},'LIVE GPS'));c.appendChild(el('p',{},'Browser GPS is permission-based. Start it only when you want this device tracked.'));var b=el('button',{class:'tm-action',type:'button'},'START GPS');c.appendChild(b);panel.appendChild(c);
 b.onclick=function(){if(!navigator.geolocation){b.textContent='GPS UNAVAILABLE';return}navigator.geolocation.getCurrentPosition(function(p){if(window.map&&window.map.flyTo)window.map.flyTo({center:[p.coords.longitude,p.coords.latitude],zoom:15,duration:1000});b.textContent='GPS: '+Math.round(p.coords.accuracy||0)+' m';},function(){b.textContent='PERMISSION DENIED'},{enableHighAccuracy:true,maximumAge:3000,timeout:15000})};
}
function drawVisuals(panel){
 var intro=el('div',{class:'tm-status'},'Visuals is a live/public-resource layer. TrackMeNow stores no camera, image, video or clip media.');panel.appendChild(intro);
 var row=el('div',{class:'tm-row'}),refresh=el('button',{class:'tm-action',type:'button'},'REFRESH SOURCES');row.appendChild(refresh);panel.appendChild(row);
 var grid=el('div',{class:'tm-grid'});panel.appendChild(grid);
 refresh.onclick=function(){loadVisuals(grid);};loadVisuals(grid);
}
function loadVisuals(grid){
 grid.innerHTML='';
 fetch(API+'/api/visuals?category='+encodeURIComponent(state.sub),{cache:'no-store'}).then(function(r){if(!r.ok)throw Error('backend');return r.json()}).then(function(j){renderVisualCards(grid,j.sources||[])})
 .catch(function(){renderVisualCards(grid,fallback.filter(function(x){return state.sub==='LIVE'||state.sub==='CAMERAS'||state.sub==='WEBCAMS'||state.sub==='IMAGES'||state.sub==='VIDEOS'||state.sub==='CLIPS'}));});
}
function renderVisualCards(grid,sources){
 if(!sources.length){var c=el('div',{class:'tm-card'});c.appendChild(el('b',{},'NO CURRENT PUBLIC SOURCE'));c.appendChild(el('p',{},'No configured/public source is available for this category right now. Nothing is being invented or stored.'));grid.appendChild(c);return}
 sources.forEach(function(s){var c=el('article',{class:'tm-card'});c.appendChild(el('b',{},(s.status||'SOURCE').toUpperCase()+' · '+(s.title||s.type||'Visual')));c.appendChild(el('p',{},[s.provider,s.location,s.timestamp].filter(Boolean).join(' · ')||s.description||'Public resource'));if(s.url){var b=el('button',{class:'tm-action',type:'button'},s.status==='LIVE'?'OPEN LIVE SOURCE':'OPEN SOURCE');b.onclick=function(){window.open(s.url,'_blank','noopener,noreferrer')};c.appendChild(b)}grid.appendChild(c)});
}
function start(){var link=el('link',{rel:'stylesheet',href:'./visuals.css?v=1'});document.head.appendChild(link);build();window.addEventListener('resize',function(){document.documentElement.style.setProperty('--tm-dock-h',(document.getElementById('tm-shell').offsetHeight||74)+'px')});setTimeout(function(){document.documentElement.style.setProperty('--tm-dock-h',(document.getElementById('tm-shell').offsetHeight||74)+'px')},0)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
