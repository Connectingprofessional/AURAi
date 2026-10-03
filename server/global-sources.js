import express from 'express';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const router = express.Router();
const cache = new Map();
const gtfsUrls=(process.env.GTFS_REALTIME_URLS||'').split(',').map(function(s){return s.trim()}).filter(Boolean); if(process.env.DELHI_OTD_API_KEY) gtfsUrls.push('https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb?key='+encodeURIComponent(process.env.DELHI_OTD_API_KEY)); const gtfsIntervalMs=Math.max(10000,Number(process.env.GTFS_POLL_INTERVAL_MS||15000)); const gtfsCache=new Map(); const transitousCountries=(process.env.TRANSITOUS_COUNTRIES||'all').split(',').map(function(s){return s.trim().toLowerCase()}).filter(Boolean); let discoveredGtfs=false;
const aisUrl = process.env.AIS_API_URL || '';
const overpassUrl = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const cellKey = process.env.OPENCELLID_API_KEY || '';

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
  // Use a single global OpenSky state-vector request at world/zoomed-out
  // views; use ADSB.lol's local 250nm feed when the viewport is smaller.
  const span=Math.max(Math.abs(b.maxLat-b.minLat),Math.abs(b.maxLon-b.minLon));
  const useGlobal=span>35;
  if(useGlobal){
    try{
      const u='https://opensky-network.org/api/states/all';
      const r=await fetch(u,{headers:{'User-Agent':'TrackMeNow/1.0'}});
      if(!r.ok) throw Error('OpenSky HTTP '+r.status);
      const j=await r.json(), now=Date.now()/1000;
      return (j.states||[]).filter(function(s){
        return Number.isFinite(Number(s[5]))&&Number.isFinite(Number(s[6])) &&
          Number(s[5])>=b.minLon&&Number(s[5])<=b.maxLon&&Number(s[6])>=b.minLat&&Number(s[6])<=b.maxLat;
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
    }catch(e){
      // Fall through to ADSB.lol so a global OpenSky failure does not blank the map.
    }
  }
  const centerLat=(b.minLat+b.maxLat)/2;
  const centerLon=(b.minLon+b.maxLon)/2;
  const latSpan=Math.abs(b.maxLat-b.minLat);
  const lonSpan=Math.abs(b.maxLon-b.minLon)*Math.cos(centerLat*Math.PI/180);
  const radiusNm=Math.max(10,Math.min(250,Math.ceil(Math.sqrt(latSpan*latSpan+lonSpan*lonSpan)*60/2)));
  const u='https://api.adsb.lol/v2/point/'+encodeURIComponent(centerLat)+'/'+encodeURIComponent(centerLon)+'/'+radiusNm;
  const r=await fetch(u,{headers:{'User-Agent':'TrackMeNow/1.0','Accept':'application/json'}});
  if(!r.ok) throw Error('ADSB.lol HTTP '+r.status);
  const j=await r.json(), now=Date.now()/1000;
  return (j.ac||[]).filter(function(a){
    return Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon)) &&
      Number(a.lat)>=b.minLat&&Number(a.lat)<=b.maxLat&&Number(a.lon)>=b.minLon&&Number(a.lon)<=b.maxLon;
  }).map(function(a){
    return {type:'Feature',geometry:{type:'Point',coordinates:[Number(a.lon),Number(a.lat)]},properties:{
      category:'flight',source:'ADSB.lol ADS-B',status:Number(a.seen_pos||a.seen||999)<30?'LIVE':'RECENT',
      icao24:a.hex,callsign:(a.flight||'').trim(),registration:a.r||'',aircraft_type:a.t||'',
      country:a.own_op||'',altitude_m:Number.isFinite(Number(a.alt_baro))?Number(a.alt_baro)*0.3048:null,
      on_ground:a.alt_baro==='ground',speed_mps:Number.isFinite(Number(a.gs))?Number(a.gs)*0.514444:null,
      heading:Number.isFinite(Number(a.track))?Number(a.track):null,
      last_contact:Number.isFinite(Number(a.seen))?now-Number(a.seen):now
    }};
  });
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
async function transit(){ await discoverTransitous();
  var out=[],nowMs=Date.now();
  for(var i=0;i<gtfsUrls.length;i++){
    var u=gtfsUrls[i],c=gtfsCache.get(u);
    if(c&&nowMs-c.fetchedAt<gtfsIntervalMs){out.push.apply(out,c.features);continue}
    try{
      var r=await fetch(u,{headers:{'User-Agent':'TrackMeNow/1.0','Accept':'application/x-protobuf,application/octet-stream'}});
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
  return out;
}
async function geo(url,b,source){
  var r=await fetch(urlWithBox(url,b),{headers:{'User-Agent':'TrackMeNow/1.0'}});
  if(!r.ok) throw Error(source+' HTTP '+r.status);
  var j=await r.json();
  return (j.features||[]).map(function(f){return Object.assign({},f,{properties:Object.assign({},f.properties||{},{source:(f.properties&&f.properties.source)||source})})});
}
async function ships(b){
  if(!aisUrl) return [];
  return (await geo(aisUrl,b,'AIS')).map(function(f){f.properties.category='ship';return f});
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
async function cells(b){
  if(!cellKey) return {status:'api-key-required',source:'OpenCelliD',features:[]};
  var u='https://opencellid.org/cell/getInArea?key='+encodeURIComponent(cellKey)+'&BBOX='+encodeURIComponent([b.minLat,b.minLon,b.maxLat,b.maxLon].join(','))+'&format=json&limit=50';
  var r=await fetch(u,{headers:{'User-Agent':'TrackMeNow/1.0'}});
  if(!r.ok) throw Error('OpenCelliD HTTP '+r.status);
  var j=await r.json();
  if(j.error||j.stat==='err') throw Error(j.error||j.err||'OpenCelliD error');
  return {status:'live',source:'OpenCelliD',features:(j.cells||[]).map(function(c){return {type:'Feature',geometry:{type:'Point',coordinates:[Number(c.lon),Number(c.lat)]},properties:{category:'cell',source:'OpenCelliD',mcc:c.mcc,mnc:c.mnc,lac:c.lac,tac:c.tac,cellid:c.cellid,radio:c.radio,range_m:c.range,samples:c.samples,signal:c.averageSignalStrength}}})};
}

router.get('/movement',async function(req,res){
  var b=bbox(req.query.bbox);if(!b)return res.status(400).json({error:'invalid bbox'});
  var layers=String(req.query.layers||'flights,ships,public-transport,cameras,cells,infrastructure').split(',').map(function(x){return x.trim()});
  var features=[],sources=[];
  if(layers.includes('flights'))try{var f=await flights(b);features.push.apply(features,f);sources.push({layer:'flights',status:'live',source:'ADSB.lol ADS-B',count:f.length})}catch(e){sources.push({layer:'flights',status:'error',source:'ADSB.lol ADS-B',error:e.message})}
  if(layers.includes('ships'))try{var s=await ships(b);features.push.apply(features,s);sources.push({layer:'ships',status:aisUrl?'live':'api-key-or-feed-required',source:'AIS',count:s.length})}catch(e){sources.push({layer:'ships',status:'error',source:'AIS',error:e.message})}
  if(layers.includes('public-transport')){var t=await transit();features.push.apply(features,t);sources.push({layer:'public-transport',status:gtfsUrls.length&&t.length?'live':gtfsUrls.length?'no-current-vehicles':'feed-required',source:'GTFS-Realtime',count:t.length})}
  if(layers.includes('cameras')||layers.includes('infrastructure'))try{var a=await osmAssets(b);var aa=layers.includes('cameras')&&!layers.includes('infrastructure')?a.filter(function(x){return x.properties.category==='camera'}):a;features.push.apply(features,aa);sources.push({layer:'public-assets',status:'live',source:'OpenStreetMap/Overpass',count:aa.length})}catch(e){sources.push({layer:'public-assets',status:'error',source:'OpenStreetMap/Overpass',error:e.message})}
  if(layers.includes('cells'))try{var c=await cells(b);features.push.apply(features,c.features);sources.push({layer:'cells',status:c.status,source:c.source,count:c.features.length})}catch(e){sources.push({layer:'cells',status:'error',source:'OpenCelliD',error:e.message})}
  res.json({type:'FeatureCollection',features:features,sources:sources,generatedAt:new Date().toISOString()});
});
router.get('/cells',async function(req,res){var b=bbox(req.query.bbox);if(!b)return res.status(400).json({error:'invalid bbox'});try{res.json(await cells(b))}catch(e){res.status(502).json({error:e.message})}});
router.get('/assets',async function(req,res){var b=bbox(req.query.bbox);if(!b)return res.status(400).json({error:'invalid bbox'});try{res.json({source:'OpenStreetMap/Overpass',features:await osmAssets(b)})}catch(e){res.status(502).json({error:e.message})}});
router.get('/status',function(_,res){res.json({flights:'ADSB.lol-live',ships:aisUrl?'configured':'feed-required',publicTransport:gtfsUrls.length?'configured':'no-live-feed-configured',publicTransportFeeds:gtfsUrls.map(function(u){var c=gtfsCache.get(u);return {url:u,status:c&&c.status||'not-polled',vehicles:c?c.features.length:0,error:c&&c.error||null,lastPoll:c&&new Date(c.fetchedAt).toISOString()||null}}),publicAssets:'live',publicCells:cellKey?'configured':'api-key-required'})});

export default router;