/* TrackMeNow API — Cloudflare Worker + D1.
 * Routes:  GET /health   GET /api/cell   and the consent-based device API under /api/devices
 * Secrets/bindings: OPENCELLID_API_KEY (secret), DB (D1), ALLOWED_ORIGINS, RETENTION_DAYS (vars).
 * Rules: a phone number alone never reveals a location. The phone must be registered by its own device (explicit
 * consent), the owner reads a one-time pairing code off that device, and only the viewer token issued by that code can
 * read that device's location. All tokens/codes are stored hashed. */

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(String(s))));
const token = (bytes = 24) => { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const code6 = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(100000 + (a[0] % 900000)); };
const nowIso = () => new Date().toISOString();

function normalizePhone(v) { /* same cleaning as the original Worker; rows stored with or without '+' keep working */
  const d = String(v || '').trim().replace(/[^\d+]/g, '');
  return /^\+?[0-9]{7,15}$/.test(d) ? d : null;
}
const phoneForms = (p) => { const bare = p.replace(/^\+/, ''); return [bare, '+' + bare]; };
const samePhone = (a, b) => a.replace(/^\+/, '') === b.replace(/^\+/, '');
const maskPhone = (p) => (p ? p.replace(/^\+?(\d{2})\d+(\d{3})$/, '+$1•••••$2') : '');
const bearer = (req) => { const h = req.headers.get('Authorization') || ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || 'https://connectingprofessional.github.io').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Admin-Token', 'Access-Control-Max-Age': '86400' };
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(req, env, body, status = 200, extra = {}) {
  if (body && typeof body === 'object' && !Array.isArray(body) && body.ok === undefined) body = { ok: status < 400, ...body };
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req, env), ...extra } });
}

/* fixed-window rate limit kept in D1 (per client IP and bucket) */
async function limited(env, req, bucket, max, windowSec) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown', k = bucket + ':' + ip, now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT n, window_start FROM rate_limits WHERE k = ?').bind(k).first();
  if (!row || now - row.window_start >= windowSec) {
    await env.DB.prepare('INSERT INTO rate_limits (k, n, window_start) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = 1, window_start = excluded.window_start').bind(k, now).run();
    return false;
  }
  await env.DB.prepare('UPDATE rate_limits SET n = n + 1 WHERE k = ?').bind(k).run();
  return row.n + 1 > max;
}

async function readBody(req) { try { return await req.json(); } catch (e) { return {}; } }
async function ensureAdminTables(env) {
  if (!env.DB) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS admin_logs (id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, event TEXT NOT NULL, ip TEXT, tab TEXT, sub TEXT, detail TEXT)').run();
}
async function adminSession(req, env) {
  const tok = req.headers.get('X-Admin-Token') || bearer(req);
  if (!tok || !env.DB) return false;
  await ensureAdminTables(env);
  const r = await env.DB.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').bind(await sha256(tok), nowIso()).first();
  return !!r;
}
const requestIp = (req) => req.headers.get('CF-Connecting-IP') || '';
async function adminLog(env, req, event, tab='', sub='', detail='') {
  await ensureAdminTables(env);
  await env.DB.prepare('INSERT INTO admin_logs(id,occurred_at,event,ip,tab,sub,detail) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),nowIso(),String(event||'ui-event').slice(0,80),requestIp(req),String(tab||'').slice(0,80),String(sub||'').slice(0,80),String(detail||'').slice(0,500)).run();
}

const deviceByDeviceToken = async (env, tok) => (tok ? env.DB.prepare('SELECT * FROM devices WHERE device_token_hash = ? AND revoked_at IS NULL').bind(await sha256(tok)).first() : null);
const deviceByViewerToken = async (env, tok) => (tok ? env.DB.prepare('SELECT * FROM devices WHERE viewer_token_hash = ? AND revoked_at IS NULL').bind(await sha256(tok)).first() : null);
async function latestPoint(env, id) {
  const p = await env.DB.prepare('SELECT * FROM telemetry WHERE device_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1').bind(id).first();
  return p ? pointOut(p) : null;
}
const pointOut = (p) => ({ telemetryId: p.id, lat: p.lat, lon: p.lon, accuracy: p.accuracy, altitude: p.altitude, speed: p.speed, heading: p.heading, recordedAt: p.recorded_at, timestamp: p.recorded_at, radio: p.radio_json ? JSON.parse(p.radio_json) : null, source: 'android-gps' });

/* ───────── OpenCelliD single-cell lookup (same route, response shape and 10-minute cache as the original Worker) ───────── */
const cellCache = new Map(), CELL_TTL = 10 * 60 * 1000, DISCLAIMER = 'PUBLIC CELL DATABASE — estimated cell position, not live phone location.';
const isInt = (v) => v !== null && v !== '' && Number.isInteger(Number(v));
async function cellLookup(req, env, url) {
  const q = url.searchParams, mcc = q.get('mcc'), mnc = q.get('mnc'), lac = q.get('lac'), cellid = q.get('cellid'), radio = q.get('radio');
  if (![mcc, mnc, lac, cellid].every(isInt)) return json(req, env, { ok: false, error: 'Required parameters: mcc, mnc, lac, cellid' }, 400);
  if (!env.OPENCELLID_API_KEY) return json(req, env, { ok: false, error: 'OpenCelliD API key is not configured on the server.' }, 500);
  const ck = [mcc, mnc, lac, cellid, radio || ''].join(':'), hit = cellCache.get(ck);
  if (hit && Date.now() - hit.t < CELL_TTL) return json(req, env, { ok: true, source: 'OpenCelliD', cached: true, data: hit.data, disclaimer: DISCLAIMER });
  const p = new URLSearchParams({ key: env.OPENCELLID_API_KEY, mcc: String(Number(mcc)), mnc: String(Number(mnc)), lac: String(Number(lac)), cellid: String(Number(cellid)), format: 'json' });
  if (radio) p.set('radio', radio.toUpperCase());
  let r, text;
  try { r = await fetch('https://opencellid.org/cell/get?' + p.toString(), { headers: { Accept: 'application/json' } }); text = await r.text(); }
  catch (e) { return json(req, env, { ok: false, error: 'Unable to connect to OpenCelliD.' }, 502); }
  let u; try { u = JSON.parse(text); } catch (e) { return json(req, env, { ok: false, error: 'OpenCelliD returned a non-JSON response.', upstreamStatus: r.status, responsePreview: text.slice(0, 200).replace(/key=[^&\s"]+/gi, 'key=***') }, 502); }
  if (!r.ok || u.error) return json(req, env, { ok: false, error: u.error || 'OpenCelliD request failed.', code: u.code ?? null, upstreamStatus: r.status }, r.status || 502);
  if (typeof u.lat !== 'number' || typeof u.lon !== 'number') return json(req, env, { ok: false, error: 'OpenCelliD returned no cell position.', upstream: u }, 404);
  const data = { mcc: u.mcc ?? Number(mcc), mnc: u.mnc ?? Number(mnc), lac: u.lac ?? Number(lac), cellid: u.cellid ?? Number(cellid), radio: u.radio ?? radio ?? null, latitude: u.lat, longitude: u.lon, range: u.range ?? null, samples: u.samples ?? null, changeable: u.changeable ?? null, averageSignal: u.averageSignalStrength ?? u.averageSignal ?? null, created: u.created ?? null, updated: u.updated ?? null, tac: u.tac ?? null, pci: u.pci ?? u.unit ?? null, rnc: u.rnc ?? null, cid: u.cid ?? null };
  cellCache.set(ck, { t: Date.now(), data });
  return json(req, env, { ok: true, source: 'OpenCelliD', cached: false, data, disclaimer: DISCLAIMER });
}

/* ───────── device API ───────── */
const devOut = (d) => ({ id: d.id, phone: d.phone, label: d.label });
async function devices(req, env, url, parts) {  const method = req.method, sub = parts[2] || '', id = parts[2] && parts[3] ? parts[2] : null, act = parts[3] || '';  const byPhone = (phone, activeOnly = true) => { const [a, b] = phoneForms(phone); return env.DB.prepare('SELECT * FROM devices WHERE phone IN (?, ?)' + (activeOnly ? ' AND revoked_at IS NULL' : '') + ' LIMIT 1').bind(a, b).first(); };

  if (method === 'POST' && sub === 'register') {
    if (await limited(env, req, 'register', 10, 3600)) return json(req, env, { error: 'Too many registrations. Try later.' }, 429);
    const b = await readBody(req), phone = normalizePhone(b.phone), label = String(b.label || '').trim().slice(0, 80);
    if (b.consent !== true) return json(req, env, { error: 'Explicit device-owner consent is required.' }, 400);
    if (!phone) return json(req, env, { error: 'Phone number is required.' }, 400);
    if (!label) return json(req, env, { error: 'Device label is required.' }, 400);
    if (await byPhone(phone)) return json(req, env, { error: 'An active device is already registered for this phone number.' }, 409);
    const [pa, pb] = phoneForms(phone);
    await env.DB.prepare('DELETE FROM telemetry WHERE device_id IN (SELECT id FROM devices WHERE phone IN (?, ?) AND revoked_at IS NOT NULL)').bind(pa, pb).run();
    await env.DB.prepare('DELETE FROM devices WHERE phone IN (?, ?) AND revoked_at IS NOT NULL').bind(pa, pb).run();
    const dev = { id: crypto.randomUUID(), tok: token(), code: code6(), at: nowIso() };
    const exp = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO devices (id, phone, label, device_token_hash, pairing_code_hash, pairing_expires_at, consented_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(dev.id, phone, label, await sha256(dev.tok), await sha256(dev.code), exp, dev.at, dev.at).run();
    return json(req, env, { device: { id: dev.id, phone, label }, deviceId: dev.id, deviceToken: dev.tok, pairingCode: dev.code, pairingExpiresAt: exp, consentedAt: dev.at, maskedPhone: maskPhone(phone), message: 'Device registered with explicit owner consent. Enter the pairing code on the TrackMeNow dashboard within 15 minutes.' }, 201);
  }

  if (method === 'POST' && sub === 'pair') { /* works with just the code (website) or phone + code (original contract) */
    if (await limited(env, req, 'pair', 8, 600)) return json(req, env, { error: 'Too many pairing attempts. Try again in a few minutes.' }, 429);
    const b = await readBody(req), c = String(b.pairingCode || '').trim(), phone = b.phone ? normalizePhone(b.phone) : null;
    if (!/^\d{6}$/.test(c)) return json(req, env, { error: 'Enter the 6-digit pairing code shown on the device.' }, 400);
    const d = await env.DB.prepare('SELECT * FROM devices WHERE pairing_code_hash = ? AND revoked_at IS NULL').bind(await sha256(c)).first();
    if (!d || (d.pairing_expires_at && d.pairing_expires_at < nowIso()) || (phone && !samePhone(phone, d.phone))) return json(req, env, { error: 'Pairing code not found, expired or already used.' }, 404);
    const viewer = token();
    await env.DB.prepare('UPDATE devices SET viewer_token_hash = ?, pairing_code_hash = NULL, pairing_expires_at = NULL WHERE id = ?').bind(await sha256(viewer), d.id).run();
    return json(req, env, { paired: true, device: devOut(d), deviceId: d.id, viewerToken: viewer, maskedPhone: maskPhone(d.phone), label: d.label, message: 'Device paired successfully.' });
  }

  if (method === 'GET' && sub === 'search') {
    if (await limited(env, req, 'search', 30, 600)) return json(req, env, { error: 'Too many requests.' }, 429);
    const phone = normalizePhone(url.searchParams.get('phone'));
    if (!phone) return json(req, env, { error: 'Enter a valid mobile number.' }, 400);
    if (!(await byPhone(phone))) return json(req, env, { found: false, message: 'No consented TrackMeNow device is registered for this number.' }, 404);
    return json(req, env, { found: true, maskedPhone: maskPhone(phone), consented: true, access: 'PAIRING_REQUIRED' });
  }

  if (method === 'GET' && sub === 'lookup') {
    if (await limited(env, req, 'lookup', 30, 600)) return json(req, env, { error: 'Too many lookups. Try again in a few minutes.' }, 429);
    const phone = normalizePhone(url.searchParams.get('phone'));
    if (!phone) return json(req, env, { error: 'Enter a valid mobile number.' }, 400);
    let viewer = await deviceByViewerToken(env, bearer(req));
    if (viewer && !samePhone(viewer.phone, phone)) return json(req, env, { found: false, error: 'This viewer token is not authorized for that number.' }, 403);
    if (!viewer) { /* testing switch: numbers listed in OPEN_LOOKUP_PHONES can be searched without the pairing code. Remove the variable to turn it off. */
      const open = String(env.OPEN_LOOKUP_PHONES || '').split(',').map(normalizePhone).filter(Boolean);
      if (!open.some((o) => samePhone(o, phone))) return json(req, env, { error: 'Viewer authorization required. Pair the device with its one-time code first.' }, 401);
      viewer = await byPhone(phone);
      if (!viewer) return json(req, env, { found: false, error: 'No consented TrackMeNow device is registered for this number.' }, 404);
    }
    const loc = await latestPoint(env, viewer.id);
    return json(req, env, { found: true, deviceId: viewer.id, maskedPhone: maskPhone(viewer.phone), label: viewer.label, location: loc, ...(loc ? {} : { message: 'Device is registered but has no GPS telemetry yet.' }) });
  }

  if (id && method === 'POST' && act === 'telemetry') { /* original status codes: 404 unknown, 403 revoked, 401 bad token */
    const dev = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first();
    if (!bearer(req)) return json(req, env, { error: 'Bearer device token is required.' }, 401);
    if (!dev) return json(req, env, { error: 'Device not found.' }, 404);
    if (dev.revoked_at) return json(req, env, { error: 'Device has been revoked.' }, 403);
    if ((await sha256(bearer(req))) !== dev.device_token_hash) return json(req, env, { error: 'Invalid device token.' }, 401);
    if (await limited(env, req, 'telemetry:' + id, 120, 60)) return json(req, env, { error: 'Sending too fast.' }, 429);
    const t = await readBody(req), lat = Number(t.lat), lon = Number(t.lon);
    if (t.lat == null || t.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return json(req, env, { error: 'Valid latitude and longitude are required.' }, 400);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return json(req, env, { error: 'Latitude or longitude is outside valid range.' }, 400);
    const when = t.recordedAt || t.timestamp, ts = when && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : nowIso();
    const res = await env.DB.prepare('INSERT INTO telemetry (device_id, recorded_at, lat, lon, accuracy, altitude, speed, heading, radio_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, ts, lat, lon, num(t.accuracy), num(t.altitude), num(t.speed), num(t.heading), t.radio != null ? JSON.stringify(t.radio).slice(0, 2000) : null).run();
    const cutoff = new Date(Date.now() - (Number(env.RETENTION_DAYS) || 7) * 86400000).toISOString();
    await env.DB.prepare('DELETE FROM telemetry WHERE device_id = ? AND recorded_at < ?').bind(id, cutoff).run();
    return json(req, env, { stored: true, telemetryId: (res.meta && res.meta.last_row_id) ?? null, deviceId: id, recordedAt: ts, location: { lat, lon, accuracy: num(t.accuracy) }, receivedAt: nowIso(), message: 'Telemetry stored successfully.' }, 201);
  }

  if (id && method === 'GET' && (act === 'latest' || act === 'history')) { /* now requires the viewer token from pairing */
    const v = await deviceByViewerToken(env, bearer(req));
    if (!v || v.id !== id) return json(req, env, { error: 'Pair this device before viewing telemetry.' }, 401);
    if (act === 'latest') { const loc = await latestPoint(env, v.id); return json(req, env, { device: devOut(v), deviceId: v.id, label: v.label, maskedPhone: maskPhone(v.phone), location: loc, latest: loc, ...(loc ? {} : { message: 'No telemetry has been recorded yet.' }) }); }
    const limit = Math.min(Math.max(Math.floor(Number(url.searchParams.get('limit') || 100)) || 100, 1), 500);
    const rows = await env.DB.prepare('SELECT * FROM telemetry WHERE device_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?').bind(v.id, limit).all();
    const history = (rows.results || []).map(pointOut);
    return json(req, env, { device: devOut(v), deviceId: v.id, count: history.length, limit, history });
  }

  if (id && method === 'POST' && act === 'regenerate-pairing') { /* owner (device token) issues a fresh code, which also drops any viewer */
    const d = await deviceByDeviceToken(env, bearer(req)), b = await readBody(req);
    if (!d || d.id !== id) return json(req, env, { error: 'Invalid device token.' }, 401);
    if (b.consent !== true) return json(req, env, { error: 'Explicit device-owner consent is required.' }, 403);
    const code = code6(), exp = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE devices SET pairing_code_hash = ?, pairing_expires_at = ?, viewer_token_hash = NULL WHERE id = ?').bind(await sha256(code), exp, id).run();
    return json(req, env, { deviceId: id, pairingCode: code, pairingExpiresAt: exp, maskedPhone: maskPhone(d.phone), label: d.label });
  }

  if (id && method === 'POST' && act === 'revoke') {
    const d = await deviceByDeviceToken(env, bearer(req));
    if (!d || d.id !== id) return json(req, env, { error: 'Invalid device token.' }, 401);
    await env.DB.prepare('UPDATE devices SET revoked_at = ?, viewer_token_hash = NULL, pairing_code_hash = NULL, device_token_hash = ? WHERE id = ?').bind(nowIso(), await sha256(token()), id).run();
    await env.DB.prepare('DELETE FROM telemetry WHERE device_id = ?').bind(id).run();
    return json(req, env, { revoked: true });
  }
  return json(req, env, { error: 'Route not found' }, 404);}

/* Public camera feed adapter. Consumes only explicitly configured public GeoJSON sources. */
const cameraCache = new Map();
const CAMERA_TTL = 15000;
function cameraBbox(v){const a=String(v||'').split(',').map(Number);if(a.length!==4||a.some(x=>!Number.isFinite(x)))return null;const [minLon,minLat,maxLon,maxLat]=a;if(minLon < -180||maxLon>180||minLat < -90||maxLat>90||minLon>=maxLon||minLat>=maxLat)return null;return {minLon,minLat,maxLon,maxLat};}
async function movementCameras(b,env){
 const configured=String(env.CAMERA_GEOJSON_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const urls=configured.length?configured:['https://opensurveillancedb.org/api/cameras?bbox='+encodeURIComponent([b.minLon,b.minLat,b.maxLon,b.maxLat].join(','))];
 const out=[],errors=[];
 for(const sourceUrl of urls.slice(0,20)){try{
   const r=await fetch(sourceUrl,{headers:{Accept:'application/geo+json,application/json'}});if(!r.ok)throw new Error('HTTP '+r.status);
   const j=await r.json();
   for(const f of (Array.isArray(j?.features)?j.features:[])){
     const c=f?.geometry?.coordinates||[],lon=Number(c[0]),lat=Number(c[1]);
     if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<b.minLon||lon>b.maxLon||lat<b.minLat||lat>b.maxLat)continue;
     const p=f.properties||{};
     out.push({type:'Feature',id:String(f.id||p.id||crypto.randomUUID()),geometry:{type:'Point',coordinates:[lon,lat]},properties:{type:'camera',category:'camera',layer:'cameras',title:String(p.title||p.name||p.label||p.address||'Public camera'),provider:String(p.provider||p.source||'OpenSurveillanceDB public catalog'),location:String(p.location||p.address||p.road||p.city||''),imageUrl:String(p.imageUrl||p.image_url||p.snapshot||p.image||''),streamUrl:String(p.streamUrl||p.stream_url||p.stream||''),sourceUrl:String(p.sourceUrl||p.source_url||p.url||sourceUrl),observedAt:String(p.observedAt||p.observed_at||p.timestamp||p.updated_at||nowIso()),status:String(p.status||'PUBLIC'),license:String(p.license||'')}});
   }
 }catch(e){errors.push(sourceUrl+' · '+(e.message||e));}}
 const latest=out.reduce((m,f)=>{const t=Date.parse(f.properties.observedAt);return Number.isFinite(t)&&t>m?t:m},0);
 return {features:out.slice(0,20000),sources:[{source:configured.length?'Configured public camera GeoJSON':'OpenSurveillanceDB public camera catalog',layer:'cameras',status:out.length?'live':'no-current-cameras',count:out.length,observedAt:latest?new Date(latest).toISOString():null,error:out.length?undefined:(errors.slice(0,3).join(' | ')||'No camera observations returned')}]};
}
async function cameras(req,env,url){
 const b=cameraBbox(url.searchParams.get('bbox'));if(!b)return json(req,env,{ok:false,error:'Valid bbox is required'},400);
 const key=[b.minLon,b.minLat,b.maxLon,b.maxLat].join('|'),hit=cameraCache.get(key);if(hit&&Date.now()-hit.t<CAMERA_TTL)return json(req,env,hit.data);
 const r=await movementCameras(b,env),data={type:'FeatureCollection',features:r.features||[],sources:r.sources||[],generatedAt:nowIso(),architecture:'public camera feed to Worker to map; no media storage'};
 cameraCache.set(key,{t:Date.now(),data});return json(req,env,data);
}

async function ensureCallTables(env){
 if(!env.DB)return;
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS call_rooms (room_id TEXT PRIMARY KEY, peer_a TEXT, peer_b TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS call_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, from_peer TEXT NOT NULL, to_peer TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)').run();
}
async function callApi(req,env,url){
 if(!env.DB)return json(req,env,{error:'D1 database binding is required for calling.'},503);
 await ensureCallTables(env);
 const room=String(url.searchParams.get('room')||'').trim().slice(0,80);
 const peer=String(url.searchParams.get('peer')||'').trim().slice(0,80);
 if(req.method==='POST'&&url.pathname==='/api/call/join'){
   const b=await readBody(req),rid=String(b.room||room||'default-room').trim().slice(0,80),pid=peer||token(9),now=nowIso();
   let r=await env.DB.prepare('SELECT * FROM call_rooms WHERE room_id=?').bind(rid).first();
   let initiator=false,remotePeerId=null;
   if(!r){await env.DB.prepare('INSERT INTO call_rooms(room_id,peer_a,peer_b,created_at,updated_at) VALUES(?,?,?,?,?)').bind(rid,pid,null,now,now).run();}
   else if(!r.peer_b&&r.peer_a!==pid){await env.DB.prepare('UPDATE call_rooms SET peer_b=?,updated_at=? WHERE room_id=?').bind(pid,now,rid).run();r={...r,peer_b:pid};initiator=true;remotePeerId=r.peer_a;}
   else {remotePeerId=r.peer_a===pid?r.peer_b:r.peer_a;}
   return json(req,env,{ok:true,room:rid,peerId:pid,remotePeerId,initiator});
 }
 if(req.method==='POST'&&url.pathname==='/api/call/signal'){
   const b=await readBody(req),rid=String(b.room||room),from=String(b.from||peer),to=String(b.to||''),type=String(b.type||''),payload=b.payload;
   if(!rid||!from||!to||!type||payload===undefined)return json(req,env,{error:'room, from, to, type and payload are required'},400);
   await env.DB.prepare('INSERT INTO call_signals(room_id,from_peer,to_peer,type,payload,created_at) VALUES(?,?,?,?,?,?)').bind(rid,from,to,type,JSON.stringify(payload),nowIso()).run();
   return json(req,env,{ok:true});
 }
 if(req.method==='GET'&&url.pathname==='/api/call/poll'){
   if(!room||!peer)return json(req,env,{error:'room and peer are required'},400);
   const rows=await env.DB.prepare('SELECT id,from_peer,type,payload FROM call_signals WHERE room_id=? AND to_peer=? ORDER BY id ASC LIMIT 50').bind(room,peer).all();
   const ids=(rows.results||[]).map(x=>x.id);
   if(ids.length)await env.DB.prepare('DELETE FROM call_signals WHERE room_id=? AND to_peer=? AND id<=?').bind(room,peer,Math.max(...ids)).run();
   return json(req,env,{ok:true,signals:(rows.results||[]).map(x=>({id:x.id,from:x.from_peer,type:x.type,payload:JSON.parse(x.payload)}))});
 }
 if(req.method==='POST'&&url.pathname==='/api/call/leave'){
   const b=await readBody(req),rid=String(b.room||room),pid=String(b.peer||peer);
   if(rid&&pid){const r=await env.DB.prepare('SELECT * FROM call_rooms WHERE room_id=?').bind(rid).first();if(r){const other=r.peer_a===pid?r.peer_b:r.peer_a;if(r.peer_a===pid)await env.DB.prepare('UPDATE call_rooms SET peer_a=?,updated_at=? WHERE room_id=?').bind(r.peer_b,null,nowIso(),rid).run();else if(r.peer_b===pid)await env.DB.prepare('UPDATE call_rooms SET peer_b=NULL,updated_at=? WHERE room_id=?').bind(nowIso(),rid).run();await env.DB.prepare('DELETE FROM call_signals WHERE room_id=? AND (from_peer=? OR to_peer=?)').bind(rid,pid,pid).run();if(!other)await env.DB.prepare('DELETE FROM call_rooms WHERE room_id=?').bind(rid).run();}}
   return json(req,env,{ok:true});
 }
 return null;
}

/* Transport secrets
/* Transport secrets are synced from GitHub Actions before deployment. */
/* ───────── live transport movement API ─────────
 * This path reads current observations directly from upstream services.
 * It never advances a vehicle between observations. */
const movementCache = new Map();
const MOVEMENT_TTL = 10000;
function movementBbox(v) {
  const a = String(v || '').split(',').map(Number);
  if (a.length !== 4 || a.some(x => !Number.isFinite(x))) return null;
  const [minLon,minLat,maxLon,maxLat]=a;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90 || minLon >= maxLon || minLat >= maxLat) return null;
  return {minLon,minLat,maxLon,maxLat};
}
function movementFeature(id, lon, lat, props={}) {
  if (![lon,lat].every(Number.isFinite) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { type:'Feature', id:String(id || crypto.randomUUID()), geometry:{type:'Point',coordinates:[lon,lat]}, properties:props };
}
async function movementFlights(b, env) {
  const q=new URLSearchParams({lamin:String(b.minLat),lomin:String(b.minLon),lamax:String(b.maxLat),lomax:String(b.maxLon)});
  try {
    const r=await fetch('https://opensky-network.org/api/states/all?'+q,{headers:{Accept:'application/json'}});
    if(!r.ok) throw new Error('OpenSky HTTP '+r.status);
    const j=await r.json(), out=[];
    for(const s of (j.states||[])){
      const lat=Number(s[6]),lon=Number(s[5]); if(!Number.isFinite(lat)||!Number.isFinite(lon)||s[8]) continue;
      const f=movementFeature(s[0],lon,lat,{kind:'air',category:'air',layer:'flights',callsign:String(s[1]||'').trim(),icao24:s[0],heading:num(s[10]),speed:num(s[9]),altitude:num(s[7]),observedAt:j.time?new Date(Number(j.time)*1000).toISOString():nowIso(),source:'OpenSky ADS-B',sourceStatus:'live'});
      if(f) out.push(f);
    }
    if(out.length) return {features:out,source:'OpenSky ADS-B',status:'live',observedAt:nowIso()};
    throw new Error('OpenSky returned no aircraft in bbox');
  } catch(e) {
    if(!env.AVIATIONSTACK_API_KEY) return {features:[],source:'OpenSky ADS-B',status:'error',error:e.message};
    try {
      const p=new URLSearchParams({access_key:env.AVIATIONSTACK_API_KEY,flight_status:'active',limit:'1000'});
      const r=await fetch('https://api.aviationstack.com/v1/flights?'+p); if(!r.ok) throw new Error('Aviationstack HTTP '+r.status);
      const j=await r.json(),out=[];
      for(const f of (j.data||[])){const l=f.live||{},lat=Number(l.latitude),lon=Number(l.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const x=movementFeature(f.flight?.icao||f.flight?.iata||f.flight?.number,lon,lat,{kind:'air',layer:'flights',callsign:String(f.flight?.iata||f.flight?.number||'').trim(),heading:num(l.direction),speed:num(l.speed_horizontal),altitude:num(l.altitude),observedAt:nowIso(),source:'Aviationstack',sourceStatus:'live'});if(x)out.push(x);}
      return {features:out,source:'Aviationstack',status:out.length?'live':'no-current-vehicles',observedAt:nowIso(),error:out.length?undefined:'No positioned aircraft returned'};
    } catch(x) { return {features:[],source:'Aviationstack',status:'error',error:x.message}; }
  }
}
async function movementShips(b, env) {
  if(!env.AISSTREAM_API_KEY) return {features:[],source:'AISstream.io',status:'feed-required',error:'AISSTREAM_API_KEY is not configured on the Worker'};
  const url=env.AIS_WS_URL||'wss://stream.aisstream.io/v0/stream';
  return await new Promise(resolve=>{
    let done=false; const ships=new Map(), finish=(result)=>{if(done)return;done=true;try{ws.close();}catch(e){};resolve(result)};
    let ws; try{ws=new WebSocket(url)}catch(e){return resolve({features:[],source:'AISstream.io',status:'error',error:e.message})}
    const timer=setTimeout(()=>finish({features:[...ships.values()],source:'AISstream.io',status:ships.size?'live':'no-current-vehicles',observedAt:nowIso()}),3000);
    ws.addEventListener('open',()=>ws.send(JSON.stringify({APIKey:env.AISSTREAM_API_KEY,BoundingBoxes:[[[b.minLat,b.minLon],[b.maxLat,b.maxLon]]],FilterMessageTypes:['PositionReport','StandardClassBPositionReport']})));
    ws.addEventListener('message',async ev=>{try{let raw=ev.data;if(raw instanceof ArrayBuffer)raw=new TextDecoder().decode(new Uint8Array(raw));else if(raw instanceof Uint8Array)raw=new TextDecoder().decode(raw);else if(typeof raw!=='string')raw=String(raw);const e=JSON.parse(raw),m=e.Message?.PositionReport||e.Message?.StandardClassBPositionReport,md=e.MetaData||{};if(!m)return;const lat=Number(m.Latitude??md.latitude),lon=Number(m.Longitude??md.longitude),id=String(m.UserID??md.MMSI??'');if(!id)return;const observed=m.Timestamp!=null?new Date(Number(m.Timestamp)*1000).toISOString():nowIso();const f=movementFeature(id,lon,lat,{kind:'ship',category:'ship',layer:'ships',name:String(md.ShipName||'').trim(),heading:num(m.TrueHeading!=null?m.TrueHeading:m.Cog),speed:num(m.Sog),mmsi:id,observedAt:observed,source:'AISstream.io',sourceStatus:'live'});if(f)ships.set(id,f)}catch(e){}}); 
    ws.addEventListener('error',ev=>{clearTimeout(timer);finish({features:[],source:'AISstream.io',status:'error',error:'AIS stream connection failed'})});
  });
}
function pbReadVarint(a,i){let v=0,n=0;while(i<a.length&&n<10){const b=a[i++];v+=Number(b&127)*2**(7*n);if(!(b&128))return [v,i];n++;}return [null,i]}
function pbFields(a,cb){let i=0;while(i<a.length){const [key,ni]=pbReadVarint(a,i);if(key===null)break;i=ni;const field=Math.floor(key/8),wire=key%8;let value=null;if(wire===0){[value,i]=pbReadVarint(a,i)}else if(wire===1){if(i+8>a.length)break;value=new DataView(a.buffer,a.byteOffset+i,8).getFloat64(0,true);i+=8}else if(wire===2){const [len,pi]=pbReadVarint(a,i);if(len===null||pi+len>a.length)break;value=a.subarray(pi,pi+len);i=pi+len}else if(wire===5){if(i+4>a.length)break;value=new DataView(a.buffer,a.byteOffset+i,4).getFloat32(0,true);i+=4}else if(wire===3){let depth=1;while(i<a.length&&depth){const [k,p]=pbReadVarint(a,i);if(k===null)break;i=p;const w=k%8;if(w===3)depth++;else if(w===4)depth--;else if(w===0){[,i]=pbReadVarint(a,i)}else if(w===1)i+=8;else if(w===2){const [l,p2]=pbReadVarint(a,i);i=p2+(l||0)}else if(w===5)i+=4}}else if(w===4)break;else break;cb(field,wire,value)}
}
const td=new TextDecoder();
function pbText(v){return v instanceof Uint8Array?td.decode(v):String(v??'')}
function gtfsVehicles(buf, feedMeta={}) {
  const out=[];
  pbFields(buf,(f,w,v)=>{
    if(f!==2||w!==2)return;
    let entity=v,id='',pos=null,ts=null,vid='',route='';
    pbFields(entity,(ef,ew,ev)=>{
      if(ef===1&&ew===2)id=pbText(ev);
      if(ef===4&&ew===2)pbFields(ev,(vf,vw,vv)=>{
        if(vf===2&&vw===2)pbFields(vv,(pf,pw,pv)=>{if(pf===1)p.lat=Number(pv);if(pf===2)p.lon=Number(pv);if(pf===3)p.bearing=Number(pv);if(pf===5)p.speed=Number(pv);});
        if(vf===5&&vw===0)ts=Number(vv);
        if(vf===8&&vw===2)pbFields(vv,(df,dw,dv)=>{if(df===1)vid=pbText(dv);});        if(vf===1&&vw===2)pbFields(vv,(tf,tw,tv)=>{if(tf===5)route=pbText(tv);});
      });
    });    if(pos&&Number.isFinite(pos.lat)&&Number.isFinite(pos.lon)){
      const rail=!!feedMeta.rail,kind=rail?'rail':'transit',layer=rail?'rail':'transit';
      const ftr=movementFeature(vid||id,pos.lon,pos.lat,{kind,category:kind,mode:kind,layer,vehicleId:vid||id,route,heading:num(pos.bearing),speed:num(pos.speed),observedAt:ts?new Date(ts*1000).toISOString():nowIso(),source:'GTFS-Realtime',sourceStatus:'live',feed:feedMeta.label||''});
      if(ftr)out.push(ftr);
    }
  });
  return out;
}
async function movementTransit(env){
  let feeds=String(env.GTFS_RT_URLS||'').split(',').map(s=>s.trim()).filter(Boolean).map(url=>({url,label:'Configured GTFS-Realtime',rail:/rail|metro|subway|tram|train/i.test(url)}));
  if(!feeds.length&&env.MOBILITY_DB_REFRESH_TOKEN){
    try{
      const r=await fetch('https://api.mobilitydatabase.org/v1/tokens',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:env.MOBILITY_DB_REFRESH_TOKEN})});
      if(!r.ok)throw new Error('Mobility Database token HTTP '+r.status);
      const t=await r.json(),access=t.access_token;
      if(access){
        const lr=await fetch('https://api.mobilitydatabase.org/v1/gtfs_rt_feeds?entity_types=vp&status=active&limit=50',{headers:{Authorization:'Bearer '+access,Accept:'application/json'}});
        if(!lr.ok)throw new Error('Mobility Database feeds HTTP '+lr.status);
        const body=await lr.json(),list=Array.isArray(body)?body:(body.data||body.results||[]);
        feeds=list.map(f=>{
          const si=f.source_info||{},urls=si.urls||{},url=urls.direct_download_url||si.producer_url||'';
          const label=String(f.name||f.feed_name||f.provider||'GTFS-Realtime');
          return {url,label,rail:/rail|metro|subway|tram|train/i.test(label)};
        }).filter(f=>f.url).slice(0,30);
      }
    }catch(e){return {features:[],source:'Mobility Database / GTFS-Realtime',status:'error',error:e.message};}
  }
  if(!feeds.length)return {features:[],source:'GTFS-Realtime',status:'feed-required',error:'No GTFS realtime feed is configured'};
  const all=[],feedErrors=[];
  await Promise.all(feeds.map(async feed=>{try{const r=await fetch(feed.url,{headers:{Accept:'application/x-protobuf,application/octet-stream'}});if(!r.ok){feedErrors.push(feed.label+' HTTP '+r.status);return;}all.push(...gtfsVehicles(new Uint8Array(await r.arrayBuffer()),feed));}catch(e){feedErrors.push(feed.label+': '+(e.message||e));}}));
  const features=all.slice(0,10000);
  const latest=(arr)=>arr.reduce((m,f)=>{const t=Date.parse(f.properties?.observedAt||'');return Number.isFinite(t)&&t>m?t:m;},0);
  const transit=features.filter(f=>f.properties?.kind==='transit');
  const rail=features.filter(f=>f.properties?.kind==='rail');
  const srcName='GTFS-Realtime'+(env.MOBILITY_DB_REFRESH_TOKEN?' via Mobility Database':'');
  const sources=[
    {source:srcName,status:transit.length?'live':'no-current-vehicles',layer:'transit',count:transit.length,observedAt:latest(transit)?new Date(latest(transit)).toISOString():null,feeds:feeds.filter(f=>!f.rail).length,error:transit.length?undefined:('No current bus/public-transit vehicle positions returned'+(feedErrors.length?' · '+feedErrors.slice(0,2).join(' | '):''))},
    {source:srcName,status:rail.length?'live':'no-current-vehicles',layer:'rail',count:rail.length,observedAt:latest(rail)?new Date(latest(rail)).toISOString():null,feeds:feeds.filter(f=>f.rail).length,error:rail.length?undefined:('No current railway/metro vehicle positions returned'+(feedErrors.length?' · '+feedErrors.slice(0,2).join(' | '):''))}
  ];
  return {features,sources,source:srcName,status:features.length?'live':'no-current-vehicles',observedAt:latest(features)?new Date(latest(features)).toISOString():null,feeds:feeds.length,error:features.length?undefined:(feedErrors.slice(0,3).join(' | ')||'No current vehicle positions returned')};
}
async function movement(req,env,url){
  const b=movementBbox(url.searchParams.get('bbox'));if(!b)return json(req,env,{ok:false,error:'Valid bbox=minLon,minLat,maxLon,maxLat is required'},400);
  const requestedLayers=String(url.searchParams.get('layers')||'flights,ships,public-transport').split(',').map(s=>s.trim()).filter(Boolean);
  const layers=[...new Set(requestedLayers.map(function(x){return x==='public-transport'?'transit':x;}))];
  const key=[b.minLon,b.minLat,b.maxLon,b.maxLat,layers.sort().join(',')].join('|'),hit=movementCache.get(key);
  if(hit&&Date.now()-hit.t<MOVEMENT_TTL)return json(req,env,hit.data);
  const jobs=[];
  if(layers.includes('flights'))jobs.push(movementFlights(b,env));
  if(layers.includes('ships'))jobs.push(movementShips(b,env));
  if(layers.includes('transit')||layers.includes('public-transport'))jobs.push(movementTransit(env));
  const results=await Promise.all(jobs),features=[],sources=[];
  const latestObserved=(arr)=>arr.reduce((m,f)=>{const t=Date.parse(f.properties?.observedAt||'');return Number.isFinite(t)&&t>m?t:m;},0);
  for(const r of results){
    const rf=r.features||[];
    const rs=r.sources||[{
      source:r.source,status:r.status,layer:(rf[0]?.properties?.layer)||((r.source||'').includes('OpenSky')?'flights':(r.source||'').includes('AIS')?'ships':'public-transport'),
      count:rf.length,observedAt:(r.observedAt||latestObserved(rf))?(r.observedAt||new Date(latestObserved(rf)).toISOString()):null,
      ...(r.error?{error:r.error}:{} )
    }];
    for(const ss of rs){
      const s={...ss};
      if(!s.observedAt && rf.length){const subset=rf.filter(f=>!s.layer||f.properties?.layer===s.layer||f.properties?.kind===s.layer);const t=latestObserved(subset);if(t)s.observedAt=new Date(t).toISOString();}
      sources.push(s);
    }
    const allowed=rf.filter(f=>{
      const layer=String(f.properties?.layer||'').toLowerCase(),kind=String(f.properties?.kind||f.properties?.category||'').toLowerCase();
      if(layer==='flights') return layers.includes('flights');
      if(layer==='ships') return layers.includes('ships');
      if(kind==='rail'||layer==='rail') return layers.includes('rail');
      if(kind==='transit'||layer==='transit'||layer==='public-transport') return layers.includes('transit') || layers.includes('public-transport');
      return true;
    });
    features.push(...allowed);
  }
  const data={type:'FeatureCollection',features,sources,generatedAt:nowIso(),architecture:'real-source → Cloudflare Worker → map; no dead reckoning'};
  movementCache.set(key,{t:Date.now(),data});return json(req,env,data);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    const url = new URL(req.url), parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/health' || url.pathname === '/') return json(req, env, { ok: true, service: 'TrackMeNow API', provider: 'OpenCelliD', cell: !!env.OPENCELLID_API_KEY, devices: !!env.DB, transport: { movement: true, ais: !!env.AISSTREAM_API_KEY, mobilityDatabase: !!env.MOBILITY_DB_REFRESH_TOKEN, aviationstack: !!env.AVIATIONSTACK_API_KEY }, cameras: !!env.CAMERA_GEOJSON_URLS });
      if (url.pathname === '/api/db-test') {
        if (!env.DB) return json(req, env, { ok: false, database: 'binding-missing', error: 'D1 binding DB is not available.' }, 500);
        const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('devices', 'telemetry', 'rate_limits') ORDER BY name").all();
        const t = new Set((r.results || []).map((x) => x.name));
        let migrated = false; try { await env.DB.prepare('SELECT pairing_expires_at FROM devices LIMIT 1').first(); migrated = true; } catch (e) {}
        return json(req, env, { ok: true, database: 'connected', tables: { devices: t.has('devices'), telemetry: t.has('telemetry'), rate_limits: t.has('rate_limits') }, pairingExpiryColumn: migrated });
      }
      if (!['GET', 'POST'].includes(req.method)) return json(req, env, { ok: false, error: 'Method not allowed' }, 405);
      if (url.pathname === '/api/visitor' && req.method === 'POST') {
        try { const b=await readBody(req); await adminLog(env,req,b.event||'page-visit',b.tab||'',b.sub||'',b.detail||b.screen||''); return json(req,env,{ok:true}); } catch(e) { return json(req,env,{ok:false,error:'audit logging failed'},500); }
      }
      if (url.pathname === '/api/admin/login' && req.method === 'POST') {        const b=await readBody(req);
        if(!env.ADMIN_USER || !env.ADMIN_PASSWORD) return json(req,env,{error:'Admin credentials are not configured on the Worker.'},503);
        if(String(b.username||'')!==String(env.ADMIN_USER)||String(b.password||'')!==String(env.ADMIN_PASSWORD)) return json(req,env,{error:'Invalid admin credentials.'},401);
        await ensureAdminTables(env);        const t=token(), exp=new Date(Date.now()+8*60*60*1000).toISOString();
        await env.DB.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)').bind(await sha256(t),exp).run();
        return json(req,env,{ok:true,token:t,expiresAt:exp});
      }
      if (url.pathname === '/api/admin/logs' && req.method === 'GET') {
        if(!(await adminSession(req,env))) return json(req,env,{error:'Admin authorization required.'},401);
        await ensureAdminTables(env); const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||200),1),1000);
        const r=await env.DB.prepare('SELECT * FROM admin_logs ORDER BY occurred_at DESC LIMIT ?').bind(limit).all();
        return json(req,env,{source:'D1',rows:r.results||[]});
      }
      if (url.pathname === '/api/admin/summary' && req.method === 'GET') {
        if(!(await adminSession(req,env))) return json(req,env,{error:'Admin authorization required.'},401);
        await ensureAdminTables(env);
        const r=await env.DB.prepare("SELECT substr(occurred_at,1,10) day,count(*) total,sum(CASE WHEN event='page-visit' THEN 1 ELSE 0 END) visits,sum(CASE WHEN event='search' THEN 1 ELSE 0 END) searches,count(DISTINCT ip) unique_ips FROM admin_logs GROUP BY substr(occurred_at,1,10) ORDER BY day DESC LIMIT 30").all();
        return json(req,env,{source:'D1',days:r.results||[]});
      }
      if (url.pathname === '/api/admin/feed-report' && req.method === 'GET') {
        if(!(await adminSession(req,env))) return json(req,env,{error:'Admin authorization required.'},401);
        return json(req,env,{ok:true,feeds:{visuals:!!env.VISUALS_PUBLIC_SOURCE_URLS,cell:!!env.OPENCELLID_API_KEY,devices:!!env.DB},generatedAt:nowIso()});
      }
      if (url.pathname === '/api/admin/log-event' && req.method === 'POST') {
        if(!(await adminSession(req,env))) return json(req,env,{error:'Admin authorization required.'},401);
        const b=await readBody(req); await adminLog(env,req,b.event||'ui-event',b.tab,b.sub,b.detail); return json(req,env,{ok:true});
      }
      if (url.pathname === '/api/visuals' && req.method === 'GET') {
        const allowed = ['LIVE','CAMERAS','WEBCAMS','IMAGES','VIDEOS','CLIPS','SOURCE HISTORY'];
        const category = allowed.includes(String(url.searchParams.get('category') || 'LIVE').toUpperCase())
          ? String(url.searchParams.get('category') || 'LIVE').toUpperCase() : 'LIVE';
        const defaults = [
          {title:'NOAA Earth Real-Time',provider:'NOAA NESDIS',url:'https://www.nesdis.noaa.gov/imagery/satellite-maps/earth-real-time'},
          {title:'Copernicus Sentinel',provider:'European Union / Copernicus',url:'https://sentinels.copernicus.eu/'},
          {title:'NASA GIBS',provider:'NASA Earthdata',url:'https://worldview.earthdata.nasa.gov/'},
          {title:'Public Camera Atlas',provider:'OpenSurveillanceDB',url:'https://opensurveillancedb.org/'}
        ];
        const configured = String(env.VISUALS_PUBLIC_SOURCE_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
        const sources = category === 'SOURCE HISTORY' ? [] : (configured.length ? configured.map((source, i) => ({
          id:'configured-'+i,type:'public',status:category==='LIVE'?'LIVE':'SOURCE',title:'Configured public visual source',provider:'TrackMeNow public source adapter',url:source,category
        })) : defaults.map((s,i)=>({...s,id:'default-'+i,type:'public',status:'PUBLIC',category})));
        return json(req, env, {
          ok: true, storage: 'none',
          policy: 'TrackMeNow does not store or copy public visual media.',
          category, sources,
          labels: ['LIVE','RECORDED','ARCHIVED','USER SHARED','SOURCE OFFLINE']
        });
      }
      if (url.pathname.startsWith('/api/call/')) { const cr=await callApi(req,env,url); if(cr)return cr; }
      if (url.pathname === '/api/movement' && req.method === 'GET') return await movement(req, env, url);
      if (url.pathname === '/api/cameras' && req.method === 'GET') return await cameras(req, env, url);
      if (url.pathname === '/api/cell' && req.method === 'GET') return await cellLookup(req, env, url);
      if (parts[0] === 'api' && parts[1] === 'devices') {
        if (!env.DB) return json(req, env, { error: 'D1 database binding "DB" is not configured on the Worker.' }, 503);
        return await devices(req, env, url, parts);
      }
      return json(req, env, { error: 'Not found' }, 404);
    } catch (e) {
      return json(req, env, { error: 'Server error' }, 500);
    }
  }
};