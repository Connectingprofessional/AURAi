/* TrackMeNow camera layer
 * Camera map loader follows the working Oct-07 architecture:
 * viewport bbox -> Worker -> normalized FeatureCollection -> MapLibre.
 * No camera data is stored by TrackMeNow.
 */
(function(){
'use strict';

const API=(window.TM_API_BASE||'').replace(/\/$/,'');
const SOURCE_ID='tm-cameras';
const LAYER_ID='tm-cameras';
const HALO_ID='tm-cameras-halo';
let map=null, timer=null, seq=0;
const store=new Map();

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function bbox(){
 if(!map)return '';
 const b=map.getBounds();
 return [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',');
}
function cameraData(features){
 return {type:'FeatureCollection',features:features||[]};
}
function ensureLayers(){
 if(!map||!map.isStyleLoaded())return;
 if(!map.getSource(SOURCE_ID))map.addSource(SOURCE_ID,{type:'geojson',data:cameraData([])});
 if(!map.getLayer(HALO_ID))map.addLayer({
   id:HALO_ID,type:'circle',source:SOURCE_ID,
   paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,8,8,12,14,18],
     'circle-color':'#67d5ff','circle-opacity':.12,'circle-blur':.9}
 });
 if(!map.getLayer(LAYER_ID)){
   map.addLayer({
     id:LAYER_ID,type:'circle',source:SOURCE_ID,
     paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,2.5,8,4.5,14,7],
       'circle-color':'#67d5ff','circle-stroke-color':'#071018',
       'circle-stroke-width':1.5,'circle-opacity':.94}
   });
   map.on('mouseenter',LAYER_ID,()=>map.getCanvas().style.cursor='pointer');
   map.on('mouseleave',LAYER_ID,()=>map.getCanvas().style.cursor='');
   map.on('click',LAYER_ID,e=>{
     const f=e.features&&e.features[0],p=f&&f.properties;if(!p)return;
     const u=p.imageUrl||p.streamUrl||p.sourceUrl||'';
     const html='<b>'+esc(p.title||'PUBLIC CAMERA')+'</b>'+
       '<div style="opacity:.65;font-size:11px;margin-top:4px">'+esc(p.provider||'Public source')+'</div>'+
       '<div style="font-size:11px;margin-top:5px">'+esc(p.location||'')+'</div>'+
       '<div style="opacity:.6;font-size:10px;margin-top:5px">Observed '+esc(p.observedAt?new Date(p.observedAt).toLocaleString():'—')+'</div>'+
       (u?'<button id="tm-open-camera" style="margin-top:8px">OPEN SOURCE</button>':'');
     new maplibregl.Popup({closeButton:true,maxWidth:'300px'}).setLngLat(e.lngLat).setHTML(html).addTo(map);
     setTimeout(()=>{const b=document.getElementById('tm-open-camera');if(b)b.onclick=()=>window.open(u,'_blank','noopener,noreferrer');},0);
   });
 }
}
async function load(){
 if(!map)return 0;
 if(map.isStyleLoaded&&!map.isStyleLoaded()){map.once('load',load);return 0;}
 const bb=bbox();if(!bb)return 0;
 const my=++seq;
 try{
   const r=await fetch(API+'/api/cameras?bbox='+encodeURIComponent(bb),{cache:'no-store'});
   const j=await r.json().catch(()=>({}));
   if(!r.ok)throw new Error(j.error||('HTTP '+r.status));
   if(my!==seq)return 0;
   const incoming=Array.isArray(j.features)?j.features:[];
   const now=Date.now(),KEEP=15*60*1000;
   incoming.forEach(f=>{
     const p=f.properties||{};
     const id=String(f.id||p.id||p.cameraId||p.name||JSON.stringify(f.geometry));
     p.__tmLastSeen=now;p.entityId=id;f.id=id;f.properties=p;store.set(id,f);
   });
   const features=Array.from(store.values()).filter(f=>now-(Number(f.properties&&f.properties.__tmLastSeen)||0)<=KEEP);
   ensureLayers();
   const src=map.getSource(SOURCE_ID);
   if(src)src.setData(cameraData(features));
   if(map.getLayer(LAYER_ID))map.setLayoutProperty(LAYER_ID,'visibility',features.length?'visible':'none');
   if(map.getLayer(HALO_ID))map.setLayoutProperty(HALO_ID,'visibility',features.length?'visible':'none');
   const status=document.querySelector('#tm-panel .tm-global-feed-status');
   if(status)status.textContent='CAMERAS · '+features.length.toLocaleString()+' · '+((j.sources||[])[0]?.source||'public feed')+' · '+((j.sources||[])[0]?.status||'ACTIVE');
   return features.length;
 }catch(e){
   ensureLayers();
   const features=Array.from(store.values());
   if(map.getSource(SOURCE_ID))map.getSource(SOURCE_ID).setData(cameraData(features));
   if(map.getLayer(LAYER_ID))map.setLayoutProperty(LAYER_ID,'visibility',features.length?'visible':'none');
   return features.length;
 }
}
function schedule(delay){clearTimeout(timer);timer=setTimeout(load,delay==null?250:delay);}
function init(m){
 map=m||window.map;
 if(!map)return;
 if(!map.__tmCameraEventsBound){
   map.__tmCameraEventsBound=true;
   map.on('moveend',()=>schedule(450));
   map.on('idle',()=>schedule(0));
   map.on('styledata',()=>schedule(150));
   map.on('load',()=>schedule(150));
 }
 if(map.isStyleLoaded&&map.isStyleLoaded())schedule(150);
 else map.once('load',()=>schedule(150));
}
window.TrackMeNowCameras={init,load,schedule};
})();