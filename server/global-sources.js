import express from 'express';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import WebSocket from 'ws';

const router = express.Router();
const cache = new Map();
const gtfsUrls=(process.env.GTFS_REALTIME_URLS||'').split(',').map(function(s){return s.trim()}).filter(Boolean); if(process.env.DELHI_OTD_API_KEY) gtfsUrls.push('https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb?key='+encodeURIComponent(process.env.DELHI_OTD_API_KEY)); const gtfsIntervalMs=Math.max(10000,Number(process.env.GTFS_POLL_INTERVAL_MS||15000)); const gtfsCache=new Map(); const transitousCountries=(process.env.TRANSITOUS_COUNTRIES||'all').split(',').map(function(s){return s.trim().toLowerCase()}).filter(Boolean); let discoveredGtfs=false;
const aisUrl = process.env.AIS_API_URL || '';
const aisStreamKey = process.env.AISSTREAM_API_KEY || '';
const taxiUrl = process.env.TAXI_GEOJSON_URL || '';
const overpassUrl = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const cellKey = process.env.OPENCELLID_API_KEY || '';
const mdbToken = process.env.MOBILITY_DB_REFRESH_TOKEN || process.env.MOBILITY_DATABASE_REFRESH_TOKEN || '';
const mdbState = { done: false, feeds: 0, error: null };
const flightGlobalCache={at:0,features:null,promise:null};
const shipStream={socket:null,bboxKey:'',connected:false,retryMs:1000,positions:new Map(),lastAt:0};

function bbox(q){
  var a=String(q||'').split(',').map(Number);
  if(a.length!==4 || a.some(function(x){return !Number.isFinite(x)})) return null;
  return {minLon:Math.max(-180,Math.min(180,a[0])),minLat:Math.max(-90,Math.min(90,a[1])),maxLon:Math.max(-180,Math.min(180,a[2])),maxLat:Math.max(-90,Math.min(90,a[3]))};
}
function urlWithBox(url,b){
  return url.replaceAll('{minLon}',String(b.minLon)).replaceAll('{minLat}',String(b.minLat)).replaceAll('{maxLon}',String(b.maxLon)).replaceAll('{maxLat}',String(b.maxLat)).replaceAll('{bbox}',[b.minLon,b.minLat,b.maxLon,b.maxLat].join(','));
}
function cached(k,ms){var x=cache.get(k);return x && Date.now()-x.t<ms?x.v:null}
function put(k,v){cache.set(k,{t:Date.now(),v:v});return v}

async function flights(b){
  const key=[b.minLon.toFixed(2),b.minLat.toFixed(2),b.maxLon.toFixed(2),b.maxLat.toFixed(2)].join(',');
  const cacheKey='opensky:'+key;
  const hit=cached(cacheKey,12000);
  if(hit)return hit;
  const u='https://opensky-network.org/api/states/all?lamin='+encodeURIComponent(b.minLat)+'&lomin='+encodeURIComponent(b.minLon)+'&lamax='+encodeURIComponent(b.maxLat)+'&lomax='+encodeURIComponent(b.maxLon);
  const r=await fetch(u,{headers:{'User-Agent':'TrackMeNow/1.0'}});
  if(!r.ok)throw Error('OpenSky HTTP '+r.status);
  const j=await r.json(),now=Date.now()/1000;
  const features=(j.states||[]).filter(function(s){
    return Number.isFinite(Number(s[5]))&&Number.isFinite(Number(s[6]));
  }).map(function(s){
    return {type:'Feature',geometry:{type:'Point',coordinates:[Number(s[5]),Number(s[6])]},properties:{
      category:'flight',source:'OpenSky ADS-B',status:Number(s[4])&&now-Number(s[4])<45?'LIVE':'RECENT',
      icao24:s[0],callsign:(s[1]||'').trim(),country:s[2],
      altitude_m:Number.isFinite(Number(s[7]))?Number(s[7]):null,on_ground:!!s[8],
      speed_mps:Number.isFinite(Number(s[9]))?Number(s[9]):null,
      heading:Number.isFinite(Number(s[10]))?Number(s[10]):null,
      vertical_rate_mps:Number.isFinite(Number(s[11]))?Number(s[11]):null,
      last_contact:s[4]||now
    }};
  });
  return put(cacheKey,features);
}
function transitMode(v){
  var x=((v.vehicle&&v.vehicle.label)||'')+' '+((v.vehicle&&v.vehicle.id)||'')+' '+((v.trip&&v.trip.routeId)||'');
  x=x.toLowerCase();
  if(/taxi|cab|uber|lyft|ola/.test(x)) return 'taxi';
  if(/metro|subway|underground/.test(x)) return 'metro';
  if(/tram|streetcar|light.?rail/.test(x)) return 'tram';
  if(/train|rail|express/.test(x)) return 'train';
  if(/ferry|boat|water/.test(x)) return 'ferry';
  return 'bus';
}
async function discoverTransitous(){
  if(discoveredGtfs)return;
  discoveredGtfs=true;
  if(!transitousCountries.length||transitousCountries.includes('off'))return;
  var countries=transitousCountries.includes('all')?['in','us','gb','de','fr','it','es','nl','be','ch','at','se','no','dk','fi','pl','cz','au','nz','jp','kr','sg','th','ae','za','br','mx','ca']:transitousCountries;
  for(var i=0;i<countries.length;i++)try{
    var rr=await fetch('https://raw.githubusercontent.com/public-transport/transitous/main/feeds/'+countries[i]+'.json',{headers:{'User-Agent':'TrackMeNow/1.0'}});
    if(!rr.ok)continue;
    var manifest=await rr.json();
    for(var src of(manifest.sources||[]))if(src.spec==='gtfs-rt'&&src.url&&!gtfsUrls.includes(src.url))gtfsUrls.push(src.url);
  }catch(e){}
}
/* Mobility Database (mobilitydatabase.org): find open GTFS-Realtime vehicle-position feeds worldwide.
 * Needs MOBILITY_DB_REFRESH_TOKEN (from the account page). Only active feeds that need no auth are used. */
async function discoverMobilityDb(){
  if(!mdbToken||mdbState.done||Date.now()<(mdbState.retryAt||0))return;
  mdbState.done=true;
  try{
    var tr=await fetch('https://api.mobilitydatabase.org/v1/tokens',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'TrackMeNow/1.0'},body:JSON.stringify({refresh_token:mdbToken})});
    if(!tr.ok)throw Error('token request HTTP '+tr.status);
    var access=(await tr.json()).access_token; if(!access)throw Error('no access_token in response');
    var found=[],maxFeeds=Number(process.env.MOBILITY_DB_MAX_FEEDS||150);
    for(var offset=0;offset<4000&&found.length<maxFeeds;offset+=1000){
      var r=await fetch('https://api.mobilitydatabase.org/v1/gtfs_rt_feeds?entity_types=vp&limit=1000&offset='+offset,{headers:{'Authorization':'Bearer '+access,'User-Agent':'TrackMeNow/1.0'}});
      if(!r.ok)throw Error('feed list HTTP '+r.status);
      var list=await r.json(); if(!Array.isArray(list))break;
      for(var f of list){
        var si=f.source_info||{};
        if(f.status!=='active'||!si.producer_url||(si.authentication_type&&si.authentication_type!==0))continue;
        if(!gtfsUrls.includes(si.producer_url)&&!found.includes(si.producer_url))found.push(si.producer_url);
        if(found.length>=maxFeeds)break;
      }
      if(list.length<1000)break;
    }
    found.forEach(function(u){gtfsUrls.push(u)});
    mdbState.feeds=found.length;
  }catch(e){mdbState.error=e.message;mdbState.done=false;mdbState.retryAt=Date.now()+600000}
}
async function transit(){ await discoverTransitous(); await discoverMobilityDb();
  var out=[],nowMs=Date.now();
  async function one(u){
    var c=gtfsCache.get(u);
    if(c&&nowMs-c.fetchedAt<gtfsIntervalMs){out.push.apply(out,c.features);return}
    try{
      var r=await fetch(u,{headers:{'User-Agent':'TrackMeNow/1.0','Accept':'application/x-protobuf,application/octet-stream'},signal:AbortSignal.timeout(6000)});
      if(!r.ok)throw Error('HTTP '+r.status);
      var feed=GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await r.arrayBuffer()));
      var now=Math.floor(Date.now()/1000),features=[];
      for(var e of(feed.entity||[])){
        var v=e.vehicle,p=v&&v.position;if(!p||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude))continue;
        var ts=Number(v.timestamp||feed.header&&feed.header.timestamp||0);if(ts&&now-ts>180)continue;
        var mode=transitMode(v);
        features.push({type:'Feature',geometry:{type:'Point',coordinates:[p.longitude,p.latitude]},properties:{category:'public-transport',mode:mode,source:'GTFS-Realtime',status:'LIVE',feed:u,vehicle_id:v.vehicle&&v.vehicle.id||e.id,label:v.vehicle&&v.vehicle.label||'',trip_id:v.trip&&v.trip.tripId||'',route_id:v.trip&&v.trip.routeId||'',headsign:v.trip&&v.trip.tripHeadsign||'',speed_mps:p.speed,bearing:p.bearing,timestamp:ts||now}});
      }
      gtfsCache.set(u,{fetchedAt:nowMs,features:features,status:'live',error:null});out.push.apply(out,features);
    }catch(err){gtfsCache.set(u,{fetchedAt:nowMs,features:[],status:'error',error:err.message})}
  }
  /* poll feeds in parallel (12 at a time) so hundreds of feeds fit inside the request time limit */
  var queue=gtfsUrls.slice(),workers=[];
  for(var w=0;w<12;w++)workers.push((async function(){while(queue.length)await one(queue.shift())})());
  await Promise.all(workers);
  return out;
}
async function geo(url,b,source){
  var r=await fetch(urlWithBox(url,b),{headers:{'User-Agent':'TrackMeNow/1.0'}});
  if(!r.ok) throw Error(source+' HTTP '+r.status);
  var j=await r.json();
  return (j.features||[]).map(function(f){return Object.assign({},f,{properties:Object.assign({},f.properties||{},{source:(f.properties&&f.properties.source)||source})})});
}
function ensureShipStream(b){
  if(!aisStreamKey)return;
  const key=[b.minLat.toFixed(2),b.minLon.toFixed(2),b.maxLat.toFixed(2),b.maxLon.toFixed(2)].join(',');
  if(shipStream.socket&&shipStream.connected&&shipStream.bboxKey===key)return;
  if(shipStream.socket){try{shipStream.socket.close()}catch(e){}}
  shipStream.bboxKey=key;shipStream.connected=false;
  const ws=new WebSocket('wss://stream.aisstream.io/v0/stream',{perMessageDeflate:true});
  shipStream.socket=ws;
  ws.on('open',function(){
    shipStream.connected=true;shipStream.retryMs=1000;
    ws.send(JSON.stringify({APIKey:aisStreamKey,BoundingBoxes:[[[b.minLat,b.minLon],[b.maxLat,b.maxLon]]],FilterMessageTypes:['PositionReport']}));
  });
  ws.on('message',function(raw){
    try{
      const e=JSON.parse(Buffer.from(raw).toString('utf8')); if(e.MessageType!=='PositionReport')return;
      const m=e.Message&&e.Message.PositionReport||{},md=e.MetaData||{};
      const lat=Number(m.Latitude!=null?m.Latitude:md.Latitude),lon=Number(m.Longitude!=null?m.Longitude:md.Longitude),mmsi=String(m.UserID!=null?m.UserID:(md.MMSI||''));
      if(!mmsi||!Number.isFinite(lat)||!Number.isFinite(lon))return;
      shipStream.positions.set(mmsi,{lat,lon,mmsi,name:md.ShipName||'',sog:Number(m.Sog),cog:Number(m.Cog),timestamp:Number(m.Timestamp)||Math.floor(Date.now()/1000),seenAt:Date.now()});
    }catch(e){}
  });
  ws.on('close',function(){
    shipStream.connected=false;
    if(shipStream.socket!==ws)return;
    const wait=shipStream.retryMs;shipStream.retryMs=Math.min(15000,shipStream.retryMs*2);
    setTimeout(function(){if(aisStreamKey&&shipStream.bboxKey===key){shipStream.socket=null;ensureShipStream(b)}},wait);
  });
  ws.on('error',function(){});
}
async function ships(b){
  if(aisUrl)return (await geo(aisUrl,b,'AIS')).map(function(f){f.properties.category='ship';return f});
  if(!aisStreamKey)return [];
  ensureShipStream(b);
  const now=Date.now(),out=[];
  for(const p of shipStream.positions.values()){
    if(now-p.seenAt>180000||p.lon<b.minLon||p.lon>b.maxLon||p.lat<b.minLat||p.lat>b.maxLat)continue;
    out.push({type:'Feature',geometry:{type:'Point',coordinates:[p.lon,p.lat]},properties:{category:'ship',source:'AIS Stream',status:now-p.seenAt<90000?'LIVE':'RECENT',mmsi:p.mmsi,name:p.name,speed_mps:Number.isFinite(p.sog)?p.sog*0.514444:null,heading:Number.isFinite(p.cog)?p.cog:null,timestamp:p.timestamp}});
  }
  return out;
}
async function taxis(b){
  if(!taxiUrl)return [];
  return (await geo(taxiUrl,b,'Taxi live feed')).map(function(f){f.properties.category='public-transport';f.properties.mode='taxi';f.properties.status=f.properties.status||'LIVE';return f});
}
async function osmAssets(b){
  var k='osm:'+b.minLon.toFixed(3)+','+b.minLat.toFixed(3)+','+b.maxLon.toFixed(3)+','+b.maxLat.toFixed(3);
  var c=cached(k,120000);if(c)return c;
  var q='[out:json][timeout:25];('+
    'nwr["man_made"="surveillance"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["contact:webcam"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["highway"="bus_stop"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["amenity"~"bus_station|taxi|ferry_terminal"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["railway"~"station|halt|tram_stop|subway_entrance"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["aeroway"~"aerodrome|helipad"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["man_made"="mast"]["tower:type"="communication"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["man_made"="tower"]["tower:type"="communication"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    ');out center tags;';
  var r=await fetch(overpassUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'TrackMeNow/1.0'},body:'data='+encodeURIComponent(q)});
  if(!r.ok) throw Error('Overpass HTTP '+r.status);
  var j=await r.json();
  var out=(j.elements||[]).map(function(e){
    var t=e.tags||{},lon=e.lon!=null?e.lon:e.center&&e.center.lon,lat=e.lat!=null?e.lat:e.center&&e.center.lat;
    var cat='infrastructure';
    if(t.man_made==='surveillance'||t['contact:webcam'])cat='camera';
    else if(t.highway==='bus_stop'||t.amenity==='bus_station')cat='bus-stop';
    else if(t.amenity==='taxi')cat='taxi-stand';
    else if(t.amenity==='ferry_terminal')cat='ferry-terminal';
    else if(t.railway)cat='rail-infrastructure';
    else if(t.aeroway)cat='airport';
    else if(t['tower:type']==='communication')cat='cell-tower';
    return {type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{category:cat,source:'OpenStreetMap',osm_id:e.id,name:t.name||t.ref||cat,operator:t.operator||'',live_url:t['contact:webcam']||t.webcam||''}};
  }).filter(function(f){return Number.isFinite(f.geometry.coordinates[0])&&Number.isFinite(f.geometry.coordinates[1])});
  return put(k,out);
}
async function intelligenceAssets(b){
  var k='intel:'+b.minLon.toFixed(3)+','+b.minLat.toFixed(3)+','+b.maxLon.toFixed(3)+','+b.maxLat.toFixed(3);
  var c=cached(k,300000);if(c)return c;
  var q='[out:json][timeout:35];('+
    'nwr["power"="plant"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["power"="generator"]['+'generator:source'+']('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["telecom"="data_center"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["building"="data_center"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["waterway"="dam"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["waterway"="weir"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["harbour"="yes"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["man_made"="pier"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["railway"~"station|halt|yard|junction|subway_entrance|tram_stop"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["power"~"substation|line|cable|tower|pole"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["man_made"="communication_line"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["man_made"="mine"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["man_made"="mineshaft"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["landuse"="quarry"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["industrial"="data_centre"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["office"="company"]["headquarters"="yes"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["office"="government"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["government"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["government"="administrative"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["amenity"="hospital"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["office"="diplomatic"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["amenity"="embassy"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'nwr["military"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    ');out center tags;';
  var r=await fetch(overpassUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'TrackMeNow/1.0'},body:'data='+encodeURIComponent(q)});
  if(!r.ok) throw Error('Overpass intelligence HTTP '+r.status);
  var j=await r.json(),out=[];
  for(var e of(j.elements||[])){
    var t=e.tags||{},lon=e.lon!=null?e.lon:e.center&&e.center.lon,lat=e.lat!=null?e.lat:e.center&&e.center.lat;
    if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;
    var category='poi',sub='';
    if(t.power==='plant'||t.power==='generator'){category='power';sub=t['plant:source']||t['generator:source']||'other'}
    else if(t.telecom==='data_center'||t.building==='data_center'||t.industrial==='data_centre'){category='datacenter';sub=t.operator||'other'}
    else if(t.waterway==='dam'||t.waterway==='weir'){category='dam';sub=t.waterway}
    else if(t.harbour==='yes'||t.amenity==='ferry_terminal'||t.man_made==='pier'){category='network';sub='ports'}
    else if(t.railway){category='network';sub='railway'}
    else if(t.power){category='network';sub=t.power}
    else if(t.man_made==='communication_line'){category='network';sub='cables'}
    else if(t.man_made==='mine'||t.man_made==='mineshaft'||t.landuse==='quarry'){category='resource';sub=t.resource||t.landuse||'mining'}
    else if(t.office==='company'&&t.headquarters==='yes'){category='hq';sub=t.office}
    else if(t.office==='government'||t.government){category='government';sub=t.government||'government'}
    else if(t.amenity==='hospital'){category='poi';sub='hospital'}
    else if(t.office==='diplomatic'||t.amenity==='embassy'){category='poi';sub='embassy'}
    else if(t.military){category='poi';sub='military'}
    out.push({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{category:category,subtype:sub,source:'OpenStreetMap',osm_id:e.id,name:t.name||t.ref||category,operator:t.operator||'',owner:t.owner||'',plant_source:t['plant:source']||t['generator:source']||'',capacity:t['plant:output:electricity']||t['generator:output:electricity']||'',network:t.network||''}});
  }
  return put(k,out);
}

async function submarineCables(b){
  const k='submarine-cables:'+b.minLon.toFixed(2)+','+b.minLat.toFixed(2)+','+b.maxLon.toFixed(2)+','+b.maxLat.toFixed(2);
  const hit=cached(k,600000);if(hit)return hit;
  const q='[out:json][timeout:30];('+
    'way["submarine"="yes"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'way["seamark:type"="cable_submarine"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    'way["location"="underwater"]["communication"="line"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');'+
    ');out geom tags;';
  const r=await fetch(overpassUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'TrackMeNow/1.0'},body:'data='+encodeURIComponent(q)});
  if(!r.ok)throw Error('Overpass submarine cables HTTP '+r.status);
  const j=await r.json(),out=[];
  for(const e of(j.elements||[])){
    const g=(e.geometry||[]).map(function(p){return [Number(p.lon),Number(p.lat)]}).filter(function(p){return Number.isFinite(p[0])&&Number.isFinite(p[1])});
    if(g.length<2)continue;
    const t=e.tags||{};
    out.push({type:'Feature',geometry:{type:'LineString',coordinates:g},properties:{category:'cable',subtype:'submarine',source:'OpenStreetMap/Overpass',osm_id:e.id,name:t.name||t.ref||'Submarine cable',operator:t.operator||'',ref:t.ref||''}});
  }
  return put(k,out);
}

async function cells(b){
  if(!cellKey) return {status:'api-key-required',source:'OpenCelliD',features:[]};
  var u='https://opencellid.org/cell/getInArea?key='+encodeURIComponent(cellKey)+'&BBOX='+encodeURIComponent([b.minLat,b.minLon,b.maxLat,b.maxLon].join(','))+'&format=json&limit=50';
  var r=await fetch(u,{headers:{'User-Agent':'TrackMeNow/1.0'}});
  if(!r.ok) throw Error('OpenCelliD HTTP '+r.status);
  var j=await r.json();
  if(j.error||j.stat==='err') throw Error(j.error||j.err||'OpenCelliD error');
  return {status:'live',source:'OpenCelliD',features:(j.cells||[]).map(function(c){return {type:'Feature',geometry:{type:'Point',coordinates:[Number(c.lon),Number(c.lat)]},properties:{category:'cell',source:'OpenCelliD',mcc:c.mcc,mnc:c.mnc,lac:c.lac,tac:c.tac,cellid:c.cellid,radio:c.radio,range_m:c.range,samples:c.samples,signal:c.averageSignalStrength}}})};
}

async function liveEvents(){
  const out=[],sources=[];
  try{
    const r=await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',{headers:{'User-Agent':'TrackMeNow/1.0'}});
    if(!r.ok)throw Error('USGS HTTP '+r.status);
    const j=await r.json();
    for(const f of (j.features||[])){
      const c=f.geometry&&f.geometry.coordinates||[];
      if(!Number.isFinite(Number(c[0]))||!Number.isFinite(Number(c[1])))continue;
      const p=f.properties||{};
      out.push({type:'Feature',geometry:{type:'Point',coordinates:[Number(c[0]),Number(c[1])]},properties:{category:'event',eventType:'quake',source:'USGS Earthquake Hazards Program',status:'LIVE FEED',name:p.place||'Earthquake',magnitude:p.mag,time:p.time,url:p.url,ts:p.time}});
    }
    sources.push({type:'quake',source:'USGS',status:'live',count:out.length});
  }catch(e){sources.push({type:'quake',source:'USGS',status:'error',error:e.message})}
  return {features:out,sources};
}
router.get('/events',async function(req,res){try{res.json(await liveEvents())}catch(e){res.status(502).json({error:e.message})}});
router.get('/health',function(req,res){res.json({ok:true,service:'trackmenow-global',sources:{flights:'OpenSky ADS-B',ships:aisUrl?'configured':'feed-required',transport:gtfsUrls.length?'configured':'feed-required',osm:'available',cells:cellKey?'configured':'api-key-required',mobilityDatabase:mdbToken?'configured':'api-key-required'}})});
router.get('/movement',async function(req,res){
  var b=bbox(req.query.bbox);if(!b)return res.status(400).json({error:'invalid bbox'});
  var layers=String(req.query.layers||'flights,ships,public-transport,cameras,cells,infrastructure').split(',').map(function(x){return x.trim()});
  var zoom=Math.max(0,Math.min(22,Number(req.query.zoom||0)));
  var features=[],sources=[];
  async function run(layer,fn,meta){
    try{var v=await Promise.race([fn(),new Promise(function(_,rej){setTimeout(function(){rej(Error('source timeout'))},9000)})]);if(Array.isArray(v))features.push.apply(features,v);else if(v&&Array.isArray(v.features))features.push.apply(features,v.features);sources.push(Object.assign({},meta,{status:'live',count:Array.isArray(v)?v.length:(v&&v.features?v.features.length:0)}))}
    catch(e){sources.push(Object.assign({},meta,{status:'error',error:e.message}))}
  }
  var tasks=[];
  if(layers.includes('flights'))tasks.push(run('flights',function(){return flights(b)},{layer:'flights',source:'OpenSky ADS-B'}));
  if(layers.includes('ships'))tasks.push(run('ships',function(){return ships(b)},{layer:'ships',source:'AIS',configured:!!aisUrl}));
  if(layers.includes('public-transport'))tasks.push(run('public-transport',async function(){var t=await transit(),tx=[];try{tx=await taxis(b)}catch(e){}return {features:t.concat(tx),_count:t.length+tx.length,_status:(gtfsUrls.length&&t.length)||tx.length?'live':gtfsUrls.length?'no-current-vehicles':'feed-required'}},{layer:'public-transport',source:'GTFS-Realtime'+(taxiUrl?' + taxi feed':'')}));
  // Expensive global OSM/Overpass queries are deliberately zoom-gated so a world view cannot block every live feed.
  if((layers.includes('cameras')||layers.includes('infrastructure'))&&zoom>=4)tasks.push(run('public-assets',async function(){var a=await osmAssets(b);return layers.includes('cameras')&&!layers.includes('infrastructure')?a.filter(function(x){return x.properties.category==='camera'}):a},{layer:'public-assets',source:'OpenStreetMap/Overpass'}));
  else if(layers.includes('cameras')||layers.includes('infrastructure'))sources.push({layer:'public-assets',status:'zoom-in-required',source:'OpenStreetMap/Overpass',count:0});
  if(layers.includes('intelligence')&&zoom>=4)tasks.push(run('intelligence',async function(){var ia=await intelligenceAssets(b),cables=[];try{cables=await submarineCables(b)}catch(e){}return ia.concat(cables)},{layer:'intelligence',source:'OpenStreetMap/Overpass · ODbL'}));
  else if(layers.includes('intelligence'))sources.push({layer:'intelligence',status:'zoom-in-required',source:'OpenStreetMap/Overpass · ODbL',count:0});
  if(layers.includes('cells')&&zoom>=7)tasks.push(run('cells',async function(){var x=await cells(b);return x.features},{layer:'cells',source:'OpenCelliD'}));
  else if(layers.includes('cells'))sources.push({layer:'cells',status:'zoom-in-required',source:'OpenCelliD',count:0});
  await Promise.all(tasks);
  res.json({type:'FeatureCollection',features:features,sources:sources,generatedAt:new Date().toISOString()});
});
router.get('/search',async function(req,res){
  const q=String(req.query.q||'').trim();
  if(!q)return res.status(400).json({error:'q is required'});
  const out=[];
  const coord=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(coord) out.push({type:'coordinate',lat:Number(coord[1]),lon:Number(coord[2]),label:q});
  try{
    const nr=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q='+encodeURIComponent(q),{headers:{'User-Agent':'TrackMeNow/1.0'}});
    if(nr.ok){const places=await nr.json();for(const p of places)out.push({type:'place',lat:Number(p.lat),lon:Number(p.lon),label:p.display_name,osm_type:p.osm_type,osm_id:p.osm_id});}
  }catch(e){}
  const safeQ=encodeURIComponent(q.toUpperCase());
  const aircraftUrls=[
    'https://api.adsb.lol/v2/callsign/'+safeQ,
    'https://api.adsb.lol/v2/icao/'+safeQ,
    'https://api.adsb.lol/v2/reg/'+safeQ
  ];
  for(const u of aircraftUrls){try{
    const r=await fetch(u,{headers:{'User-Agent':'TrackMeNow/1.0'}});if(!r.ok)continue;
    const j=await r.json();for(const a of (j.ac||[])){
      if(Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon)))out.push({type:'aircraft',lat:Number(a.lat),lon:Number(a.lon),label:(a.flight||a.hex||q).trim(),icao24:a.hex,callsign:(a.flight||'').trim(),registration:a.r,altitude_m:a.alt_baro,speed_mps:Number.isFinite(Number(a.gs))?Number(a.gs)*0.514444:null,heading:a.track,source:'ADSB.lol'});
    }
  }catch(e){}}
  const unique=[];const seen=new Set();for(const x of out){const k=[x.type,x.lat,x.lon,x.label].join('|');if(!seen.has(k)){seen.add(k);unique.push(x)}}
  res.json({query:q,results:unique.slice(0,20)});
});

router.get('/cells',async function(req,res){var b=bbox(req.query.bbox);if(!b)return res.status(400).json({error:'invalid bbox'});try{res.json(await cells(b))}catch(e){res.status(502).json({error:e.message})}});
router.get('/assets',async function(req,res){var b=bbox(req.query.bbox);if(!b)return res.status(400).json({error:'invalid bbox'});try{res.json({source:'OpenStreetMap/Overpass',features:await osmAssets(b)})}catch(e){res.status(502).json({error:e.message})}});
router.get('/status',function(_,res){res.json({infrastructure:'OpenStreetMap/Overpass',flights:'ADSB.lol-live',ships:aisUrl?'configured':'feed-required',publicTransport:gtfsUrls.length?'configured':'no-live-feed-configured',publicTransportFeeds:gtfsUrls.map(function(u){var c=gtfsCache.get(u);return {url:u,status:c&&c.status||'not-polled',vehicles:c?c.features.length:0,error:c&&c.error||null,lastPoll:c&&new Date(c.fetchedAt).toISOString()||null}}),publicAssets:'live',publicCells:cellKey?'configured':'api-key-required',aisStream:aisStreamKey?'configured':'api-key-required',mobilityDatabase:mdbToken?(mdbState.error?'error: '+mdbState.error:mdbState.feeds?'configured · '+mdbState.feeds+' feeds':'configured · not yet queried'):'api-key-required',taxiFeed:taxiUrl?'configured':'feed-required'})});


router.get('/visuals',function(req,res){
  const category=String(req.query.category||'LIVE').toUpperCase();
  const allowed=['LIVE','CAMERAS','WEBCAMS','IMAGES','VIDEOS','CLIPS','SOURCE HISTORY'];
  const selected=allowed.includes(category)?category:'LIVE';
  const sources=selected==='SOURCE HISTORY'?[]:String(process.env.VISUALS_PUBLIC_SOURCE_URLS||'').split(',').map(function(s){return s.trim()}).filter(Boolean).map(function(url,i){
    return {id:'configured-'+i,type:'public',status:selected==='LIVE'?'LIVE':'SOURCE',title:'Configured public visual source',provider:'TrackMeNow public source adapter',url:url,category:selected};
  });
  res.set('Cache-Control','no-store');
  res.json({ok:true,storage:'none',policy:'TrackMeNow does not store or copy public visual media.',category:selected,sources:sources,labels:['LIVE','RECORDED','ARCHIVED','USER SHARED','SOURCE OFFLINE']});
});
router.get('/visuals/health',function(_,res){
  const count=String(process.env.VISUALS_PUBLIC_SOURCE_URLS||'').split(',').map(function(s){return s.trim()}).filter(Boolean).length;
  res.json({ok:true,service:'trackmenow-visuals',storage:'none',configuredSources:count});
});

export default router;