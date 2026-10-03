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
  const span=Math.max(Math.abs(b.maxLat-b.minLat),Math.abs(b.maxLon-b.minLon));
  const useGlobal=span>35;
  if(useGlobal){
    try{
      const nowMs=Date.now();
      if(flightGlobalCache.features && nowMs-flightGlobalCache.at<15000){
        return flightGlobalCache.features.filter(function(f){const c=f.geometry.coordinates;return c[0]>=b.minLon&&c[0]<=b.maxLon&&c[1]>=b.minLat&&c[1]<=b.maxLat;});
      }
      if(flightGlobalCache.promise){
        await flightGlobalCache.promise;
      }else{
        flightGlobalCache.promise=(async function(){
          const r=await fetch('https://opensky-network.org/api/states/all',{headers:{'User-Agent':'TrackMeNow/1.0'}});
          if(!r.ok) throw Error('OpenSky HTTP '+r.status);
          const j=await r.json(),now=Date.now()/1000;
          flightGlobalCache.features=(j.states||[]).filter(function(s){
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
          flightGlobalCache.at=Date.now();
        })().finally(function(){flightGlobalCache.promise=null;});
      }
      await flightGlobalCache.promise;
      return (flightGlobalCache.features||[]).filter(function(f){const c=f.geometry.coordinates;return c[0]>=b.minLon&&c[0]<=b.maxLon&&c[1]>=b.minLat&&c[1]<=b.maxLat;});
    }catch(e){}
  }
  const centerLat=(b.minLat+b.maxLat)/2,centerLon=(b.minLon+b.maxLon)/2;
  const latSpan=Math.abs(b.maxLat-b.minLat),lonSpan=Math.abs(b.maxLon-b.minLon)*Math.cos(centerLat*Math.PI/180);
  const radiusNm=Math.max(10,Math.min(250,Math.ceil(Math.sqrt(latSpan*latSpan+lonSpan*lonSpan)*60/2)));
  const r=await fetch('https://api.adsb.lol/v2/point/'+encodeURIComponent(centerLat)+'/'+encodeURIComponent(centerLon)+'/'+radiusNm,{headers:{'User-Agent':'TrackMeNow/1.0','Accept':'application/json'}});
  if(!r.ok) throw Error('ADSB.lol HTTP '+r.status);
  const j=await r.json(),now=Date.now()/1000;
  return (j.ac||[]).filter(function(x){return Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lon))&&Number(x.lat)>=b.minLat&&Number(x.lat)<=b.maxLat&&Number(x.lon)>=b.minLon&&Number(x.lon)<=b.maxLon;}).map(function(x){
    return {type:'Feature',geometry:{type:'Point',coordinates:[Number(x.lon),Number(x.lat)]},properties:{
      category:'flight',source:'ADSB.lol ADS-B',status:Number(x.seen_pos||x.seen||999)<30?'LIVE':'RECENT',
      icao24:x.hex,callsign:(x.flight||'').trim(),registration:x.r||'',aircraft_type:x.t||'',country:x.own_op||'',
      altitude_m:Number.isFinite(Number(x.alt_baro))?Number(x.alt_baro)*0.3048:null,on_ground:x.alt_baro==='ground',
      speed_mps:Number.isFinite(Number(x.gs))?Number(x.gs)*0.514444:null,heading:Number.isFinite(Number(x.track))?Number(x.track):null,
      last_contact:Number.isFinite(Number(x.seen))?now-Number(x.seen):now
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
  if(layers.includes('public-transport')){var t=await transit();features.push.apply(features,t);var tx=[];try{tx=await taxis(b);features.push.apply(features,tx)}catch(e){}sources.push({layer:'public-transport',status:(gtfsUrls.length&&t.length)||tx.length?'live':gtfsUrls.length?'no-current-vehicles':'feed-required',source:'GTFS-Realtime'+(taxiUrl?' + taxi feed':''),count:t.length+tx.length})}
  if(layers.includes('cameras')||layers.includes('infrastructure'))try{var a=await osmAssets(b);var aa=layers.includes('cameras')&&!layers.includes('infrastructure')?a.filter(function(x){return x.properties.category==='camera'}):a;features.push.apply(features,aa);sources.push({layer:'public-assets',status:'live',source:'OpenStreetMap/Overpass',count:aa.length})}catch(e){sources.push({layer:'public-assets',status:'error',source:'OpenStreetMap/Overpass',error:e.message})}
  if(layers.includes('cells'))try{var c=await cells(b);features.push.apply(features,c.features);sources.push({layer:'cells',status:c.status,source:c.source,count:c.features.length})}catch(e){sources.push({layer:'cells',status:'error',source:'OpenCelliD',error:e.message})}
  res.json({type:'FeatureCollection',features:features,sources:sources,generatedAt:new Date().toISOString()});
});
router.get('/cells',async function(req,res){var b=bbox(req.query.bbox);if(!b)return res.status(400).json({error:'invalid bbox'});try{res.json(await cells(b))}catch(e){res.status(502).json({error:e.message})}});
router.get('/assets',async function(req,res){var b=bbox(req.query.bbox);if(!b)return res.status(400).json({error:'invalid bbox'});try{res.json({source:'OpenStreetMap/Overpass',features:await osmAssets(b)})}catch(e){res.status(502).json({error:e.message})}});
router.get('/status',function(_,res){res.json({flights:'ADSB.lol-live',ships:aisUrl?'configured':'feed-required',publicTransport:gtfsUrls.length?'configured':'no-live-feed-configured',publicTransportFeeds:gtfsUrls.map(function(u){var c=gtfsCache.get(u);return {url:u,status:c&&c.status||'not-polled',vehicles:c?c.features.length:0,error:c&&c.error||null,lastPoll:c&&new Date(c.fetchedAt).toISOString()||null}}),publicAssets:'live',publicCells:cellKey?'configured':'api-key-required',aisStream:aisStreamKey?'configured':'api-key-required',taxiFeed:taxiUrl?'configured':'feed-required'})});

export default router;