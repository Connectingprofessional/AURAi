import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import pg from 'pg';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import globalSourcesRouter from './global-sources.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
app.use(cors());
app.use(express.json({ limit: '2mb' }));
// Serve MapLibre Global Intelligence UI (root) — Leaflet frontend removed
const ROOT = path.join(__dirname, '..');
app.use(express.static(ROOT, {
  index: 'index.html',
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js')) res.setHeader('Cache-Control', 'public, max-age=300');
  }
}));
app.use('/api/global', globalSourcesRouter);
app.get('/api/cell',async(req,res)=>{
  const key=process.env.OPENCELLID_API_KEY;
  const mcc=Number(req.query.mcc),mnc=Number(req.query.mnc),lac=Number(req.query.lac),cellid=Number(req.query.cellid);
  const radio=String(req.query.radio||'').trim().toUpperCase();
  if(!key) return res.status(503).json({error:'OpenCelliD API is not configured on the server'});
  if(![mcc,mnc,lac,cellid].every(Number.isInteger)) return res.status(400).json({error:'mcc,mnc,lac,cellid are required integers'});
  const p=new URLSearchParams({key,mcc:String(mcc),mnc:String(mnc),lac:String(lac),cellid:String(cellid),format:'json'});
  if(['GSM','UMTS','LTE','NBIOT','NR','CDMA'].includes(radio)) p.set('radio',radio);
  try{
    const r=await fetch('https://opencellid.org/cell/get?'+p.toString(),{headers:{'User-Agent':'TrackMeNow/0.2'}});
    const j=await r.json();
    if(!r.ok) return res.status(r.status).json({error:'OpenCelliD HTTP '+r.status});
    if(!j || j.stat==='fail' || !Number.isFinite(Number(j.lat)) || !Number.isFinite(Number(j.lon))) return res.status(404).json(j||{error:'cell not found'});
    res.set('Cache-Control','public,max-age=300');
    res.json(j);
  }catch(e){ res.status(502).json({error:'OpenCelliD lookup failed',detail:e.message}); }
});
app.get('/api/ads', (req,res)=>{
  const apiKey=process.env.APPLIXIR_API_KEY||null;
  if(!apiKey)return res.status(404).json({error:'rewarded ads not configured'});
  res.json({api_key:apiKey});
});


const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const sessions = new Map();
const feedCache = new Map();
const gtfsUrls = (process.env.GTFS_REALTIME_URLS || '').split(',').map(s=>s.trim()).filter(Boolean);
const cameraUrls = (process.env.CAMERA_GEOJSON_URLS || '').split(',').map(s=>s.trim()).filter(Boolean);

async function db(sql, params=[]) { if (!pool) return null; return pool.query(sql, params); }
async function initDb() {
  if (!pool) return;
  await db(`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db(`CREATE TABLE IF NOT EXISTS tracking_sessions (id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'active',created_at timestamptz NOT NULL DEFAULT now(),stopped_at timestamptz)`);
  await db(`CREATE TABLE IF NOT EXISTS location_points (id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES tracking_sessions(id) ON DELETE CASCADE,recorded_at timestamptz NOT NULL,position geography(Point,4326) NOT NULL,accuracy_m double precision,altitude_m double precision,heading_deg double precision,speed_mps double precision,source text NOT NULL DEFAULT 'browser-gps')`);
  await db(`CREATE INDEX IF NOT EXISTS location_points_session_time_idx ON location_points(session_id,recorded_at DESC)`);
}
function broadcast(message) {
  const payload=JSON.stringify(message);
  for(const client of wss.clients) if(client.readyState===WebSocket.OPEN) client.send(payload);
}
function bboxParams(q) {
  const [minLon,minLat,maxLon,maxLat]=String(q||'').split(',').map(Number);
  if (![minLon,minLat,maxLon,maxLat].every(Number.isFinite)) return null;
  return {minLon:Math.max(-180,Math.min(180,minLon)),minLat:Math.max(-90,Math.min(90,minLat)),maxLon:Math.max(-180,Math.min(180,maxLon)),maxLat:Math.max(-90,Math.min(90,maxLat))};
}
async function getFlights(b) {
  const url=`https://opensky-network.org/api/states/all?lamin=${b.minLat}&lomin=${b.minLon}&lamax=${b.maxLat}&lomax=${b.maxLon}`;
  const r=await fetch(url,{headers:{'User-Agent':'TrackMeNow/0.2'}});
  if(!r.ok) throw new Error(`OpenSky HTTP ${r.status}`);
  const j=await r.json();
  return {type:'FeatureCollection',features:(j.states||[]).filter(s=>Number.isFinite(s[5])&&Number.isFinite(s[6])).map(s=>({type:'Feature',geometry:{type:'Point',coordinates:[s[5],s[6]]},properties:{category:'flight',source:'OpenSky ADS-B',icao24:s[0],callsign:(s[1]||'').trim(),country:s[2],altitude_m:s[7],on_ground:s[8],velocity_mps:s[9],heading:s[10],vertical_rate_mps:s[11],last_contact:s[4]}}))};
}
async function getGtfs() {
  const features=[];
  for(const url of gtfsUrls) {
    const cached=feedCache.get(url);
    try {
      const r=await fetch(url,{headers:{'User-Agent':'TrackMeNow/0.2'}});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const bytes=new Uint8Array(await r.arrayBuffer());
      const feed=GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(bytes);
      const now=Date.now()/1000;
      for(const e of feed.entity||[]) {
        const v=e.vehicle;
        const p=v?.position;
        if(p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
          const ts=Number(v.timestamp||feed.header?.timestamp||0);
          if(!ts || now-ts<=90) features.push({type:'Feature',geometry:{type:'Point',coordinates:[p.longitude,p.latitude]},properties:{category:'transit',mode:'transit',source:url,vehicle_id:v.vehicle?.id||e.id,label:v.vehicle?.label||'',trip_id:v.trip?.tripId||'',speed_mps:p.speed,bearing:p.bearing,timestamp:ts}});
        }
      }
      feedCache.set(url,{ok:true,updatedAt:new Date().toISOString()});
    } catch(e) {
      feedCache.set(url,{ok:false,error:e.message,updatedAt:new Date().toISOString(),previous:cached?.updatedAt||null});
    }
  }
  return {type:'FeatureCollection',features};
}
async function getCameras(b) {
  const features=[];
  for(const url of cameraUrls) {
    try {
      const r=await fetch(url,{headers:{'User-Agent':'TrackMeNow/0.2'}});
      if(!r.ok) continue;
      const gj=await r.json();
      for(const f of (gj.features||[])) {
        const c=f.geometry?.coordinates;
        if(f.geometry?.type==='Point' && Array.isArray(c) && c.length>=2 && c[0]>=b.minLon&&c[0]<=b.maxLon&&c[1]>=b.minLat&&c[1]<=b.maxLat)
          features.push({...f,properties:{...(f.properties||{}),category:'camera',source:url}});
      }
    } catch {}
  }
  return {type:'FeatureCollection',features};
}
async function movementData(b, layers) {
  const out={type:'FeatureCollection',features:[],sources:[],generatedAt:new Date().toISOString()};
  if(layers.includes('flights')) { try { const x=await getFlights(b); out.features.push(...x.features); out.sources.push({layer:'flights',source:'OpenSky ADS-B',status:'live'}); } catch(e) { out.sources.push({layer:'flights',source:'OpenSky ADS-B',status:'error',error:e.message}); } }
  if(layers.some(x=>['bus','rail'].includes(x)) && gtfsUrls.length) {
    const x=await getGtfs(); out.features.push(...x.features.filter(f=>layers.includes(f.properties.mode==='transit'?'bus':'transit'))); out.sources.push({layer:'transit',source:'GTFS-Realtime',status: x.features.length?'live':'no-current-vehicles'});
  }
  if(layers.includes('cameras') && cameraUrls.length) { const x=await getCameras(b); out.features.push(...x.features); out.sources.push({layer:'cameras',source:'configured public GeoJSON feeds',status:'live'}); }
  if(layers.includes('ships')) out.sources.push({layer:'ships',source:'AIS',status:process.env.AIS_API_URL?'adapter-configured':'not-configured'});
  if(layers.includes('road')) out.sources.push({layer:'road',source:'authorized/public traffic feed',status:process.env.TRAFFIC_GEOJSON_URL?'adapter-configured':'not-configured'});
  if(layers.includes('cells')) out.sources.push({layer:'cells',source:'public cell database',status:process.env.CELL_FEED_URL?'adapter-configured':'not-configured'});
  return out;
}


// ───────── Consent-based mobile devices ─────────
// A phone number is an account/device identifier only. It never grants location access.
// Location/radio telemetry is accepted only from a device token created by that device.
// A dashboard must use the one-time pairing code displayed on the consenting device.
const devices = new Map();

function normalizePhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/[^0-9+]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(digits)) return null;
  return digits.startsWith('+') ? digits : '+' + digits;
}
function maskPhone(phone) {
  return phone ? phone.replace(/(\+\d{2})\d+(\d{3})$/, '$1•••••$2') : '';
}
function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function randomPairingCode() {
  return String(crypto.randomInt(100000, 1000000));
}
function bearer(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
function findDeviceByToken(token, field) {
  if (!token) return null;
  for (const d of devices.values()) if (d[field] === token) return d;
  return null;
}

app.post('/api/devices/register', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const consent = req.body?.consent === true;
  const label = String(req.body?.label || 'My TrackMeNow device').trim().slice(0, 80);
  if (!phone) return res.status(400).json({ error: 'A valid mobile number is required.' });
  if (!consent) return res.status(403).json({ error: 'Explicit device-owner consent is required.' });

  let existing = [...devices.values()].find(d => d.phone === phone);
  if (existing) return res.status(409).json({ error: 'This number is already registered on this test server.', deviceId: existing.id });

  const d = {
    id: crypto.randomUUID(),
    phone,
    label,
    deviceToken: randomToken(),
    pairingCode: randomPairingCode(),
    viewerToken: null,
    consentAt: new Date().toISOString(),
    latest: null,
    history: []
  };
  devices.set(d.id, d);
  res.status(201).json({
    deviceId: d.id,
    deviceToken: d.deviceToken,
    pairingCode: d.pairingCode,
    maskedPhone: maskPhone(d.phone),
    message: 'Device registered with owner consent. Enter the pairing code on the TrackMeNow dashboard to authorize viewing.'
  });
});

app.post('/api/devices/pair', (req, res) => {
  const code = String(req.body?.pairingCode || '').trim();
  const d = [...devices.values()].find(x => x.pairingCode === code);
  if (!d) return res.status(404).json({ error: 'Pairing code not found or already used.' });
  d.viewerToken = randomToken();
  d.pairingCode = null;
  res.json({ deviceId: d.id, viewerToken: d.viewerToken, maskedPhone: maskPhone(d.phone), label: d.label });
});

app.get('/api/devices/search', (req, res) => {
  const phone = normalizePhone(req.query?.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid mobile number.' });
  const d = [...devices.values()].find(x => x.phone === phone);
  if (!d) return res.status(404).json({ found: false, message: 'No consented TrackMeNow device is registered for this number.' });
  res.json({
    found: true,
    deviceId: d.id,
    maskedPhone: maskPhone(d.phone),
    label: d.label,
    consented: true,
    access: 'PAIRING_REQUIRED'
  });
});

// Temporary local-development lookup: phone search resolves the latest
// consented GPS point without requiring Cloudflare. Do not use this route
// for production; viewer authentication must be enforced before deployment.
app.get('/api/devices/lookup', (req, res) => {
  const phone = normalizePhone(req.query?.phone);
  if (!phone) return res.status(400).json({ error: 'Enter a valid mobile number.' });

  const d = [...devices.values()].find(x => x.phone === phone);
  if (!d) return res.status(404).json({
    found: false,
    message: 'No consented TrackMeNow device is registered for this number.'
  });

  if (!d.latest) return res.json({
    found: true,
    deviceId: d.id,
    maskedPhone: maskPhone(d.phone),
    label: d.label,
    location: null,
    message: 'Device is registered but has no GPS telemetry yet.'
  });

  res.json({
    found: true,
    deviceId: d.id,
    maskedPhone: maskPhone(d.phone),
    label: d.label,
    location: d.latest
  });
});

app.post('/api/devices/:id/telemetry', (req, res) => {
  const d = devices.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device not found.' });
  if (bearer(req) !== d.deviceToken) return res.status(401).json({ error: 'Invalid device token.' });

  const t = req.body || {};
  const lat = Number(t.lat), lon = Number(t.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
    return res.status(400).json({ error: 'Valid GPS coordinates are required.' });

  const point = {
    timestamp: t.timestamp || new Date().toISOString(),
    lat, lon,
    accuracy: Number.isFinite(Number(t.accuracy)) ? Number(t.accuracy) : null,
    altitude: Number.isFinite(Number(t.altitude)) ? Number(t.altitude) : null,
    speed: Number.isFinite(Number(t.speed)) ? Number(t.speed) : null,
    heading: Number.isFinite(Number(t.heading)) ? Number(t.heading) : null,
    source: 'android-gps',
    radio: t.radio && typeof t.radio === 'object' ? t.radio : null
  };
  d.latest = point;
  d.history.push(point);
  if (d.history.length > 1000) d.history.splice(0, d.history.length - 1000);
  broadcast({ type: 'device-telemetry', deviceId: d.id, point });
  res.status(201).json({ ok: true, receivedAt: new Date().toISOString() });
});

app.get('/api/devices/:id/latest', (req, res) => {
  const d = devices.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device not found.' });
  if (bearer(req) !== d.viewerToken) return res.status(401).json({ error: 'Pair this device before viewing telemetry.' });
  res.json({ deviceId: d.id, label: d.label, maskedPhone: maskPhone(d.phone), latest: d.latest });
});

app.get('/api/devices/:id/history', (req, res) => {
  const d = devices.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device not found.' });
  if (bearer(req) !== d.viewerToken) return res.status(401).json({ error: 'Pair this device before viewing telemetry.' });
  res.json({ deviceId: d.id, history: d.history });
});

app.post('/api/devices/:id/revoke', (req, res) => {
  const d = devices.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Device not found.' });
  if (bearer(req) !== d.deviceToken) return res.status(401).json({ error: 'Invalid device token.' });
  d.viewerToken = null;
  d.deviceToken = randomToken();
  d.pairingCode = null;
  d.latest = null;
  res.json({ ok: true, revoked: true });
});

app.get('/health',async(_,res)=>res.json({ok:true,service:'trackmenow-api',database:!!pool,feeds:{gtfs:gtfsUrls.length,cameras:cameraUrls.length,ais:!!process.env.AIS_API_URL,traffic:!!process.env.TRAFFIC_GEOJSON_URL}}));
app.get('/api/movement',async(req,res)=>{ const b=bboxParams(req.query.bbox); if(!b) return res.status(400).json({error:'bbox must be minLon,minLat,maxLon,maxLat'}); const layers=String(req.query.layers||'flights,ships,rail,bus,road,cameras').split(',').map(s=>s.trim()).filter(Boolean); res.json(await movementData(b,layers)); });
app.get('/api/sources',(_,res)=>res.json({gtfs:gtfsUrls.map(url=>({url})),cameras:cameraUrls.map(url=>({url})),ais:!!process.env.AIS_API_URL,traffic:!!process.env.TRAFFIC_GEOJSON_URL,cell:!!process.env.CELL_FEED_URL}));
app.post('/api/sessions',async(_,res)=>{const id=crypto.randomUUID(); sessions.set(id,{id,status:'active',createdAt:new Date().toISOString(),points:[]}); if(pool) await db('INSERT INTO tracking_sessions(id) VALUES($1)',[id]); res.status(201).json(sessions.get(id));});
const geofences = new Map();
function haversineMeters(aLat,aLon,bLat,bLon){const R=6371000,rad=Math.PI/180,dLat=(bLat-aLat)*rad,dLon=(bLon-aLon)*rad;const x=Math.sin(dLat/2)**2+Math.cos(aLat*rad)*Math.cos(bLat*rad)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
app.get('/api/geofences',(_,res)=>res.json([...geofences.values()]));
app.post('/api/geofences',async(req,res)=>{const g={id:crypto.randomUUID(),sessionId:req.body.sessionId||null,name:String(req.body.name||'Geofence'),lat:Number(req.body.lat),lon:Number(req.body.lon),radius_m:Number(req.body.radius_m)};if(!Number.isFinite(g.lat)||!Number.isFinite(g.lon)||!Number.isFinite(g.radius_m)||g.radius_m<=0)return res.status(400).json({error:'invalid geofence'});geofences.set(g.id,g);res.status(201).json(g);});
app.delete('/api/geofences/:id',(req,res)=>{if(!geofences.delete(req.params.id))return res.status(404).json({error:'not found'});res.status(204).end()});
app.post('/api/sessions/:id/location',async(req,res)=>{const item=sessions.get(req.params.id)||{id:req.params.id,status:'active',points:[]}; sessions.set(item.id,item); if(item.status!=='active') return res.status(409).json({error:'session is stopped'}); const p={id:crypto.randomUUID(),lat:Number(req.body.lat),lon:Number(req.body.lon),accuracy:req.body.accuracy==null?null:Number(req.body.accuracy),altitude:req.body.altitude==null?null:Number(req.body.altitude),heading:req.body.heading==null?null:Number(req.body.heading),speed:req.body.speed==null?null:Number(req.body.speed),source:req.body.source||'browser-gps',timestamp:req.body.timestamp||new Date().toISOString()}; if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon)) return res.status(400).json({error:'invalid coordinates'}); item.points.push(p); for(const g of geofences.values()){if(!g.sessionId||g.sessionId===item.id){const d=haversineMeters(p.lat,p.lon,g.lat,g.lon);const inside=d<=g.radius_m;item.geofenceState=item.geofenceState||{};if(item.geofenceState[g.id]!==inside){item.geofenceState[g.id]=inside;broadcast({type:inside?'geofence-enter':'geofence-exit',sessionId:item.id,geofence:g,distance_m:d,point:p});}}} if(pool) await db('INSERT INTO location_points(id,session_id,recorded_at,position,accuracy_m,altitude_m,heading_deg,speed_mps,source) VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6,$7,$8,$9,$10)',[p.id,item.id,p.timestamp,p.lon,p.lat,p.accuracy,p.altitude,p.heading,p.speed,p.source]); broadcast({type:'location',sessionId:item.id,point:p}); res.status(201).json(p);});
app.get('/api/sessions/:id/history',async(req,res)=>{if(pool){const r=await db('SELECT id,session_id,recorded_at,ST_Y(position::geometry) lat,ST_X(position::geometry) lon,accuracy_m accuracy,altitude_m altitude,heading_deg heading,speed_mps speed,source FROM location_points WHERE session_id=$1 ORDER BY recorded_at',[req.params.id]); return res.json(r.rows);} res.json(sessions.get(req.params.id)?.points||[]);});
app.post('/api/sessions/:id/stop',async(req,res)=>{const item=sessions.get(req.params.id); if(!item) return res.status(404).json({error:'session not found'}); item.status='stopped'; item.stoppedAt=new Date().toISOString(); if(pool) await db('UPDATE tracking_sessions SET status=$1,stopped_at=$2 WHERE id=$3',['stopped',item.stoppedAt,item.id]); broadcast({type:'session-stopped',sessionId:item.id}); res.json(item);});
const wsRooms=new Map();
wss.on('connection',(socket,req)=>{
 const u=new URL(req.url,'http://localhost'),room=u.searchParams.get('room')||'default',role=u.searchParams.get('role')||'viewer',peerId=crypto.randomUUID();
 socket._room=room;socket._peerId=peerId;socket._role=role;if(!wsRooms.has(room))wsRooms.set(room,new Map());wsRooms.get(room).set(peerId,socket);
 socket.send(JSON.stringify({type:'ready',service:'trackmenow',peerId,room,role}));
 if(role==='viewer')for(const [id,p] of wsRooms.get(room))if(id!==peerId&&p._role==='broadcaster'&&p.readyState===WebSocket.OPEN)p.send(JSON.stringify({type:'viewer-join',peerId}));
 socket.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}const peers=wsRooms.get(room)||new Map();if(m.to){const target=peers.get(m.to);if(target?.readyState===WebSocket.OPEN)target.send(JSON.stringify({...m,from:peerId}))}else for(const [id,p] of peers)if(id!==peerId&&p.readyState===WebSocket.OPEN)p.send(JSON.stringify({...m,from:peerId}))});
 socket.on('close',()=>{const peers=wsRooms.get(room);if(!peers)return;peers.delete(peerId);if(!peers.size)wsRooms.delete(room)});
});
app.use((_,res)=>res.sendFile(path.join(ROOT,'index.html')));
const port=process.env.PORT||8787;
initDb().then(()=>server.listen(port,()=>console.log(`TrackMeNow listening on ${port}`))).catch(err=>{console.error(err);process.exit(1);});
