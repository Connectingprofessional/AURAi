/* TrackMeNow Google Maps live layer.
 * Google hybrid imagery with real movement observations, camera catalogue markers,
 * clustering, click-to-inspect, and consent-based browser GPS. No simulated entities.
 */
(function () {
  'use strict';
  var API = window.TM_API_BASE || 'https://wispy-bush-9aee.recreationeeraj.workers.dev';
  var key = function () { return String(window.TM_GOOGLE_MAPS_API_KEY || window.TM_GOOGLE_MAPS_3D_API_KEY || '').trim(); };
  var fallbackFrame = null;
  var overlay, mapNode, map, statusNode, info, clusterer, apiPromise, timer;
  var active = false, night = false, gpsWatch = null;
  var movementMarkers = new Map(), cameraMarkers = new Map(), gpsMarker = null;
  var enabled = { movement: true, cameras: true, gps: true };
  var markerLibPromise;
  function status(s) { if (statusNode) statusNode.textContent = s; }
  function ensureUI() {
    if (overlay) return;
    var css = document.createElement('style');
    css.textContent =
      '#tm-google-live{position:fixed;inset:0;z-index:10010;display:none;background:#03070b;color:#eaf6ff;font:12px system-ui,sans-serif}' +
      '#tm-google-live.active{display:block}#tm-google-live-map{position:absolute;inset:0 0 76px 0}' +
      '#tm-google-live-top{position:absolute;z-index:3;top:10px;left:10px;right:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;pointer-events:none}' +
      '#tm-google-live-top>*{pointer-events:auto}#tm-google-live-status{padding:7px 10px;border:1px solid #ffffff24;border-radius:7px;background:#06101ddd;color:#bce5f5;max-width:45vw}' +
      '.tm-gl-btn{border:1px solid #9cc7d955;border-radius:7px;background:#07121deF;color:#e9f7ff;padding:8px 10px;font-weight:800;font-size:10px;cursor:pointer}' +
      '.tm-gl-btn.on{border-color:#53d7b0;background:#12372f;color:#fff}#tm-google-live-close{margin-left:auto}' +
      '#tm-google-live-dock{position:absolute;z-index:3;bottom:0;left:0;right:0;min-height:58px;display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;padding:8px;background:#040a11f5;border-top:1px solid #ffffff20}' +
      '#tm-google-live-dock .tm-gl-btn{min-width:82px}@media(max-width:650px){#tm-google-live-top{top:6px;left:6px;right:6px}#tm-google-live-status{max-width:calc(100vw - 20px);order:3;flex-basis:100%}#tm-google-live-map{bottom:105px}#tm-google-live-dock{gap:4px;padding:5px}#tm-google-live-dock .tm-gl-btn{min-width:0;padding:8px 7px;font-size:9px}}';
    document.head.appendChild(css);
    overlay = document.createElement('section'); overlay.id = 'tm-google-live'; overlay.setAttribute('aria-label','Google Maps live Earth and intelligence segments');
    mapNode = document.createElement('div'); mapNode.id = 'tm-google-live-map';
    var top = document.createElement('div'); top.id = 'tm-google-live-top';
    statusNode = document.createElement('div'); statusNode.id = 'tm-google-live-status'; statusNode.textContent = 'Loading Google Maps…';
    var close = button('TRACKMENOW MAP', function(){ closeMap(); }); close.id = 'tm-google-live-close';
    top.append(statusNode, close);
    var dock = document.createElement('div'); dock.id = 'tm-google-live-dock';
    [['HYBRID',function(){setMapType('hybrid')}],['SATELLITE',function(){setMapType('satellite')}],['ROADMAP',function(){setMapType('roadmap')}],['TERRAIN',function(){setMapType('terrain')}],['MOVEMENT',function(){toggleLayer('movement')}],['CAMERAS',function(){toggleLayer('cameras')}],['STREET VIEW',function(){toggleStreetView()}],['LIVE GPS',function(){toggleGps()}],['NIGHT STYLE',function(){toggleNight()}],['RADAR',function(){nativeMode('RADAR')}],['WEATHER',function(){nativeMode('WEATHER')}],['FLAT MAP',function(){nativeMode('FLAT')}],['3D GLOBE',function(){nativeMode('3D')}]]
      .forEach(function(x){var b=button(x[0],x[1]);b.classList.toggle('on',x[0]==='HYBRID'||x[0]==='MOVEMENT'||x[0]==='CAMERAS');dock.appendChild(b);});
    overlay.append(mapNode,top,dock); document.body.appendChild(overlay);
    var open = button('GOOGLE MAP · LIVE',function(){openMap()}); open.id='tm-google-live-open';
    open.style.cssText='position:fixed;z-index:10005;right:14px;top:96px;min-height:36px;padding:0 12px;border:1px solid rgba(83,215,176,.55);border-radius:8px;background:rgba(5,12,20,.96);color:#e9fff8;font:800 10px system-ui;cursor:pointer';
    document.body.appendChild(open);
  }
  function button(label,fn){var b=document.createElement('button');b.type='button';b.className='tm-gl-btn';b.textContent=label;b.onclick=fn;return b;}
  function loadMaps(){
    if(window.google&&window.google.maps&&window.google.maps.Map)return Promise.resolve();
    if(!key())return Promise.reject(new Error('Google Maps JavaScript API key missing. Showing Google satellite-map fallback; configure a restricted key to enable live overlays and Street View.'));
    if(window.__tmGoogleMapsApiPromise)return window.__tmGoogleMapsApiPromise;
    apiPromise=new Promise(function(resolve,reject){
      var s=document.createElement('script');s.async=true;s.defer=true;
      s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key())+'&v=beta&loading=async&libraries=maps3d,marker';
      s.onload=resolve;s.onerror=function(){reject(new Error('Google Maps failed to load. Check API enablement, billing and HTTP referrer restrictions.'));};
      document.head.appendChild(s);
    });
    window.__tmGoogleMapsApiPromise=apiPromise;
    return apiPromise;
  }
  function loadClusterer(){
    if(window.markerClusterer&&window.markerClusterer.MarkerClusterer)return Promise.resolve(window.markerClusterer);
    if(markerLibPromise)return markerLibPromise;
    markerLibPromise=new Promise(function(resolve,reject){
      var s=document.createElement('script');s.src='https://unpkg.com/@googlemaps/markerclusterer/dist/index.min.js';s.async=true;
      s.onload=function(){window.markerClusterer&&window.markerClusterer.MarkerClusterer?resolve(window.markerClusterer):reject(new Error('Marker clustering library unavailable'));};
      s.onerror=function(){reject(new Error('Marker clustering library could not load'));};document.head.appendChild(s);
    });return markerLibPromise;
  }
  async function openMap(){
    ensureUI();
    if(window.TrackMeNowGoogleEarth&&window.TrackMeNowGoogleEarth.isActive&&window.TrackMeNowGoogleEarth.isActive())window.TrackMeNowGoogleEarth.close();
    active=true;overlay.classList.add('active');var old3d=document.getElementById('tm-google-earth-toggle');if(old3d)old3d.style.display='none';status('Connecting to Google Maps…');
    try{
      await loadMaps();
      if(!map){map=new google.maps.Map(mapNode,{center:{lat:20,lng:0},zoom:2,mapTypeId:'hybrid',tilt:0,heading:0,streetViewControl:true,fullscreenControl:false,mapTypeControl:false,gestureHandling:'greedy',clickableIcons:false});info=new google.maps.InfoWindow();map.addListener('idle',function(){refreshMovement();});}
      if(!clusterer){try{var cl=await loadClusterer();clusterer=new cl.MarkerClusterer({map:map,markers:[]});}catch(e){status('Google Maps ready · clustering fallback active');}}
      status('GOOGLE HYBRID · loading live movement and camera observations…');
      await Promise.allSettled([refreshMovement(),refreshCameras()]);
      if(timer)clearInterval(timer);timer=setInterval(function(){if(active){refreshMovement();refreshCameras();}},30000);
      status('GOOGLE HYBRID · movement refresh 30s · camera catalogue · click a marker for details');
    }catch(e){
      status(e.message||'Google Maps unavailable');
      // Keep the button useful even before a JavaScript API key is configured.
      // Google Maps URLs support an embedded map without enabling the JS API; advanced live layers remain unavailable.
      if(!key()){
        if(!fallbackFrame){fallbackFrame=document.createElement('iframe');fallbackFrame.title='Google satellite map fallback';fallbackFrame.loading='lazy';fallbackFrame.referrerPolicy='no-referrer-when-downgrade';fallbackFrame.allowFullscreen=true;fallbackFrame.style.cssText='position:absolute;inset:0 0 76px 0;width:100%;height:calc(100% - 76px);border:0;background:#03070b';}
        fallbackFrame.src='https://maps.google.com/maps?q=Earth&z=2&t=k&output=embed';
        if(!fallbackFrame.parentNode)overlay.appendChild(fallbackFrame);
        status('SATELLITE FALLBACK · Google Maps JavaScript API key is not configured. Live movement overlays and Street View require a restricted API key.');
      }
    }
  }
  function closeMap(){active=false;if(overlay)overlay.classList.remove('active');var old3d=document.getElementById('tm-google-earth-toggle');if(old3d)old3d.style.display='';if(timer)clearInterval(timer);timer=null;if(gpsWatch!==null&&navigator.geolocation){navigator.geolocation.clearWatch(gpsWatch);gpsWatch=null;}if(gpsMarker)gpsMarker.setMap(null);}
  function setMapType(t){if(map)map.setMapTypeId(t);else if(fallbackFrame){var mode=(t==='satellite'||t==='hybrid')?'k':(t==='terrain'?'p':'m');fallbackFrame.src='https://maps.google.com/maps?q=Earth&z=2&t='+mode+'&output=embed';}if(t==='hybrid'||t==='satellite')night=false;}
  function toggleStreetView(){
    if(!map||!window.google||!google.maps){status('Google Maps is not ready yet');return;}
    var panorama=map.getStreetView();
    if(panorama.getVisible()){panorama.setVisible(false);status('STREET VIEW closed · map restored');return;}
    var center=map.getCenter();if(!center){status('Choose a map location first');return;}
    status('Searching for Street View imagery near map center…');
    var service=new google.maps.StreetViewService();
    service.getPanorama({location:center,radius:1000,preference:google.maps.StreetViewPreference.NEAREST}).then(function(result){
      if(!result||!result.data||!result.data.location){status('No Street View imagery found within 1 km of this location. Try a nearby road or use Pegman.');return;}
      panorama.setPano(result.data.location.pano);panorama.setPov({heading:map.getHeading()||0,pitch:0});panorama.setVisible(true);
      status('STREET VIEW · '+(result.data.location.description||'Street-level panorama'));
    }).catch(function(){status('No Street View panorama found here. Try a nearby road or drag Pegman onto a highlighted street.');});
  }
  function toggleNight(){night=!night;if(map){map.setOptions({styles:night?[{elementType:'geometry',stylers:[{color:'#151b24'}]},{elementType:'labels.text.fill',stylers:[{color:'#8c9bb0'}]},{featureType:'road',elementType:'geometry',stylers:[{color:'#303b4b'}]}]:null});status(night?'NIGHT STYLE · Google imagery remains provider-controlled':'DAY STYLE · Google hybrid imagery');}}
  function syncClusterer(){if(!clusterer)return;var all=[];if(enabled.movement)movementMarkers.forEach(function(m){all.push(m);});if(enabled.cameras)cameraMarkers.forEach(function(m){all.push(m);});clusterer.clearMarkers();clusterer.addMarkers(all);}
  function toggleLayer(name){enabled[name]=!enabled[name];if(name==='movement')movementMarkers.forEach(function(m){m.setMap(enabled.movement?map:null);});if(name==='cameras')cameraMarkers.forEach(function(m){m.setMap(enabled.cameras?map:null);});syncClusterer();status(name.toUpperCase()+' '+(enabled[name]?'ON':'OFF'));}
  function boundsQuery(){if(!map)return '-180,-80,180,80';var b=map.getBounds();if(!b)return '-180,-80,180,80';var sw=b.getSouthWest(),ne=b.getNorthEast();return [sw.lng(),sw.lat(),ne.lng(),ne.lat()].join(',');}
  async function refreshMovement(){
    if(!map||!active)return;
    try{
      var url=API+'/api/movement?bbox='+encodeURIComponent(boundsQuery())+'&layers='+encodeURIComponent('flights,ships,rail,transit,metro,taxi,car,bike')+'&t='+Date.now();
      var r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('Movement feed HTTP '+r.status);
      var j=await r.json(),features=j.features||[],keep=new Set();
      features.forEach(function(f){
        var c=f.geometry&&f.geometry.coordinates,p=f.properties||{};if(!c||!Number.isFinite(+c[0])||!Number.isFinite(+c[1]))return;
        var id=String(f.id||p.id||p.icao24||p.mmsi||p.vehicle_id||p.callsign||[p.category,c[0],c[1]].join(':'));keep.add(id);
        var marker=movementMarkers.get(id),position={lat:+c[1],lng:+c[0]};
        if(!marker){marker=new google.maps.Marker({position:position,title:String(p.name||p.callsign||p.label||p.category||p.mode||'Live movement'),icon:iconFor(p),optimized:true});
          marker.addListener('click',function(){var html='<strong>'+esc(p.name||p.callsign||p.label||p.category||'Live movement')+'</strong><br>'+esc(p.category||p.mode||p.layer||'Movement')+'<br>'+esc(p.source||p.provider||'Source observation')+'<br>'+esc(p.observedAt||p.timestamp||j.generatedAt||'Observation time unavailable');info.setContent(html);info.open({map:map,anchor:marker});map.panTo(marker.getPosition());});movementMarkers.set(id,marker);
        }else marker.setPosition(position);
        marker.setMap(enabled.movement?map:null);
      });
      movementMarkers.forEach(function(m,id){if(!keep.has(id)){m.setMap(null);movementMarkers.delete(id);}});syncClusterer();
      status('GOOGLE HYBRID · '+movementMarkers.size+' movement objects · observed feed · refresh 30s');
    }catch(e){status('GOOGLE HYBRID · movement feed unavailable: '+e.message);}
  }
  function iconFor(p){var s=String(p.category||p.kind||p.mode||p.layer||'').toLowerCase(),path=google.maps.SymbolPath.CIRCLE;var color=/flight|aircraft|air/.test(s)?'#47d7ff':/ship|vessel/.test(s)?'#55b7ff':/rail|metro|train/.test(s)?'#c6a4ff':/taxi|car|bike/.test(s)?'#f7cf65':'#65e6a8';return {path:path,scale:5,fillColor:color,fillOpacity:1,strokeColor:'#071018',strokeWeight:1.5};}
  async function refreshCameras(){
    if(!map||!active)return;
    try{
      var r=await fetch(window.TM_CAMERA_CATALOGUE_URL||'https://raw.githubusercontent.com/connectingprofessional/trackmenow/live-data/cameras.json',{cache:'no-store'});if(!r.ok)throw new Error('Camera catalogue HTTP '+r.status);
      var data=await r.json(),list=Array.isArray(data)?data:(data.features||data.cameras||[]),keep=new Set();
      list.forEach(function(item,i){
        var p=item.properties||item,coords=item.geometry&&item.geometry.coordinates;
        var lat=Number(p.lat!=null?p.lat:p.latitude!=null?p.latitude:coords&&coords[1]),lng=Number(p.lon!=null?p.lon:p.lng!=null?p.lng:p.longitude!=null?p.longitude:coords&&coords[0]);
        if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
        var id=String(item.id||p.id||p.title||p.name||('camera-'+i));keep.add(id);var m=cameraMarkers.get(id);
        if(!m){m=new google.maps.Marker({position:{lat:lat,lng:lng},title:String(p.title||p.name||'Public camera'),icon:{path:google.maps.SymbolPath.CIRCLE,scale:4,fillColor:'#ff8c69',fillOpacity:1,strokeColor:'#fff',strokeWeight:1}});
          m.addListener('click',function(){var title=p.title||p.name||'Public camera',url=p.stream||p.url||p.src||p.link||p.playlist||'';info.setContent('<strong>'+esc(title)+'</strong><br>'+esc(p.provider||p.source||'Public camera catalogue')+(url?'<br><a target="_blank" rel="noopener noreferrer" href="'+esc(url)+'">Open camera source</a>':''));info.open({map:map,anchor:m});map.panTo(m.getPosition());});cameraMarkers.set(id,m);
        }else m.setPosition({lat:lat,lng:lng});
        m.setMap(enabled.cameras?map:null);
      });
      cameraMarkers.forEach(function(m,id){if(!keep.has(id)){m.setMap(null);cameraMarkers.delete(id);}});syncClusterer();
      status('GOOGLE HYBRID · '+movementMarkers.size+' movement objects · '+cameraMarkers.size+' camera points');
    }catch(e){status('Camera catalogue unavailable: '+e.message);}
  }
  function nativeMode(mode){closeMap();var e=window.TrackMeNowEngine;if(!e)return;if(mode==='RADAR')e.selectWeather('radar');else if(mode==='WEATHER')e.selectWeather('precip');else if(mode==='FLAT'){e.setScale('earth');e.setEarthMode('flat');}else if(mode==='3D'){e.setScale('earth');e.setEarthMode('globe');}else if(mode==='DAY / NIGHT')e.setDayNight(true);}
  function toggleGps(){
    if(gpsWatch!==null){navigator.geolocation.clearWatch(gpsWatch);gpsWatch=null;if(gpsMarker)gpsMarker.setMap(null);status('LIVE GPS stopped');return;}
    if(!navigator.geolocation){status('This browser does not provide GPS geolocation');return;}
    status('Requesting browser location permission…');
    gpsWatch=navigator.geolocation.watchPosition(function(p){var pos={lat:p.coords.latitude,lng:p.coords.longitude};
      if(!gpsMarker)gpsMarker=new google.maps.Marker({map:map,position:pos,title:'Your consented live GPS',icon:{path:google.maps.SymbolPath.CIRCLE,scale:7,fillColor:'#39ffb0',fillOpacity:1,strokeColor:'#fff',strokeWeight:2}});
      else gpsMarker.setPosition(pos);map.panTo(pos);map.setZoom(Math.max(map.getZoom(),14));status('LIVE GPS · ±'+Math.round(p.coords.accuracy)+'m · this device only');
    },function(e){gpsWatch=null;status('GPS unavailable: '+e.message);},{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
  }
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function init(){ensureUI();window.TrackMeNowGoogleLiveMap={open:openMap,close:closeMap,isActive:function(){return active;}};if(key())openMap();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();