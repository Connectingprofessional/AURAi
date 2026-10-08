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

/* Every outbound call to a third-party service is wrapped with this. Without it, one slow or
 * dead upstream (OpenSky, Mobility Database, Overpass, …) can hang the whole request — which is
 * exactly what made the transport tab look empty: the Worker was waiting forever on a source
 * instead of falling back or returning what it already had. Default budget: 7s. */
async function fetchT(url, opts = {}, ms = 7000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(timer); }
}

/* At a zoomed-out view (the map's own default on load), MapLibre's getBounds() on a
 * Mercator/globe projection routinely reports longitudes outside ±180 (e.g. west=-200,
 * east=200) as the viewport wraps the world. A parser that rejects that outright produces
 * "Valid bbox is required" at the app's own starting zoom. Normalize the wrap instead of
 * rejecting it, and only fall back to a full-world box if it's nonsensical even then. */
function parseBbox(v) {
  const a = String(v || '').split(',').map(Number);
  if (a.length !== 4 || a.some(x => !Number.isFinite(x))) return null;
  let [minLon, minLat, maxLon, maxLat] = a;
  minLat = Math.max(-85.0511, Math.min(85.0511, minLat));
  maxLat = Math.max(-85.0511, Math.min(85.0511, maxLat));
  while (minLon < -180) { minLon += 360; maxLon += 360; }
  while (minLon > 180) { minLon -= 360; maxLon -= 360; }
  if (maxLon - minLon > 359.9) { minLon = -180; maxLon = 180; }
  maxLon = Math.min(180, maxLon); /* clamp rather than reject if the wrapped box still overruns */
  if (minLon >= maxLon || minLat >= maxLat) { minLon = -180; maxLon = 180; minLat = -85.0511; maxLat = 85.0511; }
  return { minLon, minLat, maxLon, maxLat };
}

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
async function ensureAdminOtpTables(env) {
  if (!env.DB) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS admin_otp_challenges (id TEXT PRIMARY KEY, username TEXT NOT NULL, phone_hash TEXT NOT NULL, otp_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT, created_at TEXT NOT NULL)').run();
}
async function sendAdminOtp(env, otp) {
  const phone = String(env.ADMIN_OTP_PHONE || '9650084311').trim();
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) {
    const body = new URLSearchParams({To: phone.startsWith('+') ? phone : '+91'+phone.replace(/\D/g,''), From:String(env.TWILIO_FROM), Body:'TrackMeNow admin login OTP: '+otp+'. Expires in 10 minutes. Do not share it.'});
    const auth = btoa(String(env.TWILIO_ACCOUNT_SID)+':'+String(env.TWILIO_AUTH_TOKEN));
    const r = await fetchT('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(env.TWILIO_ACCOUNT_SID)+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},body},10000);
    if(!r.ok) throw new Error('SMS provider rejected the OTP');
    return {sent:true,provider:'twilio'};
  }
  if (env.ADMIN_OTP_WEBHOOK_URL) {
    const r = await fetchT(String(env.ADMIN_OTP_WEBHOOK_URL),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:phone,message:'TrackMeNow admin login OTP: '+otp+'. Expires in 10 minutes.'})},10000);
    if(!r.ok) throw new Error('OTP webhook rejected the request');
    return {sent:true,provider:'webhook'};
  }
  throw new Error('Admin SMS provider is not configured.');
}
async function ensureAdminTables(env) {
  if (!env.DB) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS admin_logs (id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, event TEXT NOT NULL, ip TEXT, tab TEXT, sub TEXT, detail TEXT)').run();
  const cols = ['user_agent TEXT','referer TEXT','city TEXT','region TEXT','country TEXT'];
  for (const col of cols) { try { await env.DB.prepare('ALTER TABLE admin_logs ADD COLUMN '+col).run(); } catch (e) {} }
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
  await env.DB.prepare('INSERT INTO admin_logs(id,occurred_at,event,ip,tab,sub,detail,user_agent,referer,city,region,country) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(
      crypto.randomUUID(), nowIso(), String(event||'ui-event').slice(0,80), requestIp(req),
      String(tab||'').slice(0,80), String(sub||'').slice(0,80), String(detail||'').slice(0,500),
      String(req.headers.get('User-Agent')||'').slice(0,500),
      String(req.headers.get('Referer')||'').slice(0,500),
      String(req.cf?.city||'').slice(0,120), String(req.cf?.region||'').slice(0,120), String(req.cf?.country||'').slice(0,20)
    ).run();
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
  try { r = await fetchT('https://opencellid.org/cell/get?' + p.toString(), { headers: { Accept: 'application/json' } }); text = await r.text(); }
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

/* Public camera feed adapter. Consumes only explicitly configured public GeoJSON sources. */const cameraCache = new Map();
const CAMERA_TTL = 15000;
function cameraBbox(v){return parseBbox(v);}
async function osmCameraCatalog(b,env){
  const tiles=splitMovementBbox(b,35).slice(0,24), features=[], seen=new Set(), errors=[];
  const endpoint=String(env.CAMERA_OVERPASS_URL||'https://overpass-api.de/api/interpreter');
  const queryFor=t=>'[out:json][timeout:18];(node[man_made=surveillance]('+t.minLat+','+t.minLon+','+t.maxLat+','+t.maxLon+');way[man_made=surveillance]('+t.minLat+','+t.minLon+','+t.maxLat+','+t.maxLon+');node[contact:webcam]('+t.minLat+','+t.minLon+','+t.maxLat+','+t.maxLon+'););out center tags;';
  for(let i=0;i<tiles.length;i+=4){
    const batch=await Promise.all(tiles.slice(i,i+4).map(async t=>{
      try{
        const r=await fetchT(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:'data='+encodeURIComponent(queryFor(t))},9000);
        if(!r.ok)throw new Error('HTTP '+r.status);
        return await r.json();
      }catch(e){errors.push(e.message||String(e));return {elements:[]};}
    }));
    for(const body of batch) for(const n of (body.elements||[])){
      const p=n.tags||{}, lat=Number(n.lat??n.center?.lat), lon=Number(n.lon??n.center?.lon);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
      const id='osm-camera-'+n.type+'-'+n.id;
      if(seen.has(id))continue; seen.add(id);
      features.push({type:'Feature',id,geometry:{type:'Point',coordinates:[lon,lat]},properties:{
        type:'camera',category:'camera',layer:'cameras',title:String(p.name||p.ref||'Public camera'),
        provider:'OpenStreetMap / Overpass',location:String(p.addr_city||p.city||p.address||''),
        imageUrl:String(p.image||p.image_url||''),streamUrl:String(p.webcam||p.url||p.contact_webcam||''),
        sourceUrl:String(p.website||p.url||'https://www.openstreetmap.org/'),observedAt:nowIso(),
        status:'PUBLIC CATALOGUE',catalogue:true
      }});
      if(features.length>=20000)break;
    }
    if(features.length>=20000)break;
  }
  return {features,sources:[{source:'OpenStreetMap / Overpass',layer:'cameras',status:features.length?'catalogue':'empty',count:features.length,observedAt:features.length?nowIso():null,error:features.length?undefined:(errors[0]||'No public camera catalogue records in this viewport')}],partial:errors.length>0};
}
async function movementCameras(b,env){
 const configured=String(env.CAMERA_GEOJSON_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const apiConfigured=String(env.CAMERA_API_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
 const urls=[...configured,...apiConfigured],out=[],errors=[];
 for(const sourceUrl of urls.slice(0,20)){try{
   const r=await fetchT(sourceUrl,{headers:{Accept:'application/geo+json,application/json'}},8000);if(!r.ok)throw new Error('HTTP '+r.status);
   const j=await r.json();
   const records=Array.isArray(j?.features)?j.features:(Array.isArray(j?.cameras)?j.cameras:(Array.isArray(j?.data?.cameras)?j.data.cameras:(Array.isArray(j?.data)?j.data:[])));
   for(const f of records){
     const p=f?.properties||f||{},coords=f?.geometry?.coordinates||[];
     const lon=Number(coords[0] ?? p.lon ?? p.lng ?? p.longitude ?? p.Longitude),lat=Number(coords[1] ?? p.lat ?? p.latitude ?? p.Latitude);
     if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<b.minLon||lon>b.maxLon||lat<b.minLat||lat>b.maxLat)continue;
     const id=String(f.id||p.id||p.ID||('camera-'+crypto.randomUUID()));
     out.push({type:'Feature',id,geometry:{type:'Point',coordinates:[lon,lat]},properties:{type:'camera',category:'camera',layer:'cameras',title:String(p.title||p.name||p.label||p.address||p.Name||'Public camera'),provider:String(p.provider||p.source||p.Provider||'Official public camera source'),location:String(p.location||p.address||p.road||p.city||p.RoadwayName||''),imageUrl:String(p.imageUrl||p.image_url||p.snapshot||p.image||p.ImageUrl||''),streamUrl:String(p.streamUrl||p.stream_url||p.stream||p.VideoUrl||p.video_url||''),sourceUrl:String(p.sourceUrl||p.source_url||p.url||p.Url||sourceUrl),observedAt:String(p.observedAt||p.observed_at||p.timestamp||p.updated_at||nowIso()),status:String(p.status||'PUBLIC')}});
   }
 }catch(e){errors.push(sourceUrl+' · '+(e.message||e));}}
 if(out.length)return {features:out.slice(0,20000),sources:[{source:'Configured public camera feeds',layer:'cameras',status:'live',count:out.length,observedAt:nowIso()}]};
 const cat=await osmCameraCatalog(b,env);
 if(cat.features?.length)return cat;
 return {features:[],sources:[{source:'OpenStreetMap / Overpass',layer:'cameras',status:'empty',count:0,observedAt:null,error:errors[0]||cat.sources?.[0]?.error||'No public camera records returned'}]};
}
async function cameras(req,env,url){
 const b=cameraBbox(url.searchParams.get('bbox'));if(!b)return json(req,env,{ok:false,error:'Valid bbox is required'},400);
 const key=[b.minLon,b.minLat,b.maxLon,b.maxLat].join('|'),hit=cameraCache.get(key);if(hit&&Date.now()-hit.t<CAMERA_TTL)return json(req,env,hit.data);
 let r=await movementCameras(b,env);
 if(!(r.features||[]).length){
   try{
     const cat=await osmCameraCatalog(b,env);
     r={features:cat.features||[],sources:[{source:cat.source,layer:'cameras',status:cat.status,count:(cat.features||[]).length,error:cat.status==='zoom-in-required'?'Zoom in to load regional camera catalogue':undefined}]};
   }catch(e){
     r={features:[],sources:[{source:'TrackMeNow camera catalogue',layer:'cameras',status:'error',count:0,error:e.message}]};
   }
 }
 const data={type:'FeatureCollection',features:r.features||[],sources:r.sources||[],generatedAt:nowIso(),architecture:'TrackMeNow public camera feeds with OpenStreetMap camera catalogue fallback; no media storage'};
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
   if(rid&&pid){const r=await env.DB.prepare('SELECT * FROM call_rooms WHERE room_id=?').bind(rid).first();if(r){const other=r.peer_a===pid?r.peer_b:r.peer_a;if(r.peer_a===pid)await env.DB.prepare('UPDATE call_rooms SET peer_a=?,peer_b=NULL,updated_at=? WHERE room_id=?').bind(r.peer_b,nowIso(),rid).run();else if(r.peer_b===pid)await env.DB.prepare('UPDATE call_rooms SET peer_b=NULL,updated_at=? WHERE room_id=?').bind(nowIso(),rid).run();await env.DB.prepare('DELETE FROM call_signals WHERE room_id=? AND (from_peer=? OR to_peer=?)').bind(rid,pid,pid).run();if(!other)await env.DB.prepare('DELETE FROM call_rooms WHERE room_id=?').bind(rid).run();}}
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
  return parseBbox(v);
}
function splitMovementBbox(b, maxSpan=45) {
  const out=[];
  const lonSpan=b.maxLon-b.minLon, latSpan=b.maxLat-b.minLat;
  const nx=Math.max(1,Math.ceil(lonSpan/maxSpan)), ny=Math.max(1,Math.ceil(latSpan/maxSpan));
  for(let y=0;y<ny;y++) for(let x=0;x<nx;x++){
    const minLon=b.minLon+lonSpan*x/nx, maxLon=b.minLon+lonSpan*(x+1)/nx;
    const minLat=b.minLat+latSpan*y/ny, maxLat=b.minLat+latSpan*(y+1)/ny;
    out.push({minLon,minLat,maxLon,maxLat});
  }
  return out.slice(0,64);
}
function movementFeature(id, lon, lat, props={}) {
  if (![lon,lat].every(Number.isFinite) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { type:'Feature', id:String(id || crypto.randomUUID()), geometry:{type:'Point',coordinates:[lon,lat]}, properties:props };
}
async function movementFlightsSingle(b, env) {
  const q=new URLSearchParams({lamin:String(b.minLat),lomin:String(b.minLon),lamax:String(b.maxLat),lomax:String(b.maxLon)});
  try {
    const r=await fetchT('https://opensky-network.org/api/states/all?'+q,{headers:{Accept:'application/json'}},5000);
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
    // Public ADS-B fallback. This is still real observed aircraft data; it is
    // not interpolated and is only used when OpenSky is unavailable.
    try {
      const clat=(b.minLat+b.maxLat)/2, clon=(b.minLon+b.maxLon)/2;
      const km=Math.min(250,Math.max(25,Math.ceil(Math.max(b.maxLat-b.minLat,b.maxLon-b.minLon)*111/2)));
      const rr=await fetchT('https://api.adsb.lol/v2/point/'+encodeURIComponent(clat)+'/'+encodeURIComponent(clon)+'/'+encodeURIComponent(km),{headers:{Accept:'application/json'}},5000);
      if(rr.ok){
        const aj=await rr.json(), ao=[];
        for(const s of (aj.ac||[])){
          const lat=Number(s.lat),lon=Number(s.lon);
          if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<b.minLat||lat>b.maxLat||lon<b.minLon||lon>b.maxLon) continue;
          const f=movementFeature(s.hex||s.icao||s.r||crypto.randomUUID(),lon,lat,{kind:'air',category:'air',layer:'flights',callsign:String(s.flight||s.call||'').trim(),icao24:String(s.hex||''),heading:num(s.track),speed:num(s.gs),altitude:num(s.alt_baro),observedAt:s.now?new Date(Number(s.now)*1000).toISOString():nowIso(),source:'ADSB.lol',sourceStatus:'live'});
          if(f)ao.push(f);
        }
        if(ao.length) return {features:ao,source:'ADSB.lol',status:'live',observedAt:nowIso()};
      }
    }catch(fallbackError){}
    if(!env.AVIATIONSTACK_API_KEY) return {features:[],source:'OpenSky ADS-B / ADSB.lol',status:'error',error:e.message};    try {
      const p=new URLSearchParams({access_key:env.AVIATIONSTACK_API_KEY,flight_status:'active',limit:'1000'});
      const r=await fetchT('https://api.aviationstack.com/v1/flights?'+p); if(!r.ok) throw new Error('Aviationstack HTTP '+r.status);
      const j=await r.json(),out=[];
      for(const f of (j.data||[])){const l=f.live||{},lat=Number(l.latitude),lon=Number(l.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const x=movementFeature(f.flight?.icao||f.flight?.iata||f.flight?.number,lon,lat,{kind:'air',layer:'flights',callsign:String(f.flight?.iata||f.flight?.number||'').trim(),heading:num(l.direction),speed:num(l.speed_horizontal),altitude:num(l.altitude),observedAt:nowIso(),source:'Aviationstack',sourceStatus:'live'});if(x)out.push(x);}
      return {features:out,source:'Aviationstack',status:out.length?'live':'no-current-vehicles',observedAt:nowIso(),error:out.length?undefined:'No positioned aircraft returned'};
    } catch(x) { return {features:[],source:'Aviationstack',status:'error',error:x.message}; }
  }
}
async function movementFlights(b, env) {
  const tiles=splitMovementBbox(b,45);
  const results=await Promise.all(tiles.map(t=>movementFlightsSingle(t,env)));
  const seen=new Set(),features=[],sources=[];
  for(const r of results){
    for(const f of (r.features||[])){
      const id=String(f.id||f.properties?.icao24||'');
      if(id&&!seen.has(id)){seen.add(id);features.push(f);}
    }
    if(r.source)sources.push({...r,count:(r.features||[]).length});
  }
  const live=features.length>0;
  return {features:features.slice(0,20000),source:'OpenSky ADS-B / ADSB.lol',status:live?'live':'no-current-vehicles',observedAt:nowIso(),
    sources:[{source:'OpenSky ADS-B / ADSB.lol',layer:'flights',status:live?'live':'no-current-vehicles',count:features.length,observedAt:nowIso(),tiles:tiles.length}],
    error:live?undefined:'No current aircraft positions returned from the public ADS-B sources'};
}

async function movementShipsSingle(b, env) {
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
        if(vf===2&&vw===2){pos=pos||{};pbFields(vv,(pf,pw,pv)=>{if(pf===1)pos.lat=Number(pv);if(pf===2)pos.lon=Number(pv);if(pf===3)pos.bearing=Number(pv);if(pf===5)pos.speed=Number(pv);});}
        if(vf===5&&vw===0)ts=Number(vv);
        if(vf===8&&vw===2)pbFields(vv,(df,dw,dv)=>{if(df===1)vid=pbText(dv);});        if(vf===1&&vw===2)pbFields(vv,(tf,tw,tv)=>{if(tf===5)route=pbText(tv);});
      });
    });    if(pos&&Number.isFinite(pos.lat)&&Number.isFinite(pos.lon)){
      const kind=String(feedMeta.kind||'').toLowerCase() || (feedMeta.rail?'rail':'transit');
      const layer=kind==='metro'?'metro':(kind==='rail'?'rail':'transit');
      const ftr=movementFeature(vid||id,pos.lon,pos.lat,{kind,category:kind,mode:kind,layer,vehicleId:vid||id,route,heading:num(pos.bearing),speed:num(pos.speed),observedAt:ts?new Date(ts*1000).toISOString():nowIso(),source:'GTFS-Realtime',sourceStatus:'live',feed:feedMeta.label||''});
      if(ftr)out.push(ftr);
    }
  });
  return out;
}
async function movementShips(b, env) {
  const tiles=splitMovementBbox(b,45);
  const results=await Promise.all(tiles.map(t=>movementShipsSingle(t,env)));
  const seen=new Set(),features=[];
  for(const r of results) for(const f of (r.features||[])){
    const id=String(f.id||f.properties?.mmsi||'');
    if(id&&!seen.has(id)){seen.add(id);features.push(f);}
  }
  return {features:features.slice(0,20000),source:'AISstream.io',status:features.length?'live':'no-current-vehicles',observedAt:nowIso(),
    sources:[{source:'AISstream.io',layer:'ships',status:features.length?'live':'no-current-vehicles',count:features.length,observedAt:nowIso(),tiles:tiles.length}],
    error:features.length?undefined:'No current ship positions returned from AISstream.io'};
}

async function movementMobility(env, kind) {
  const raw = kind === 'taxi' ? env.TAXI_VEHICLE_URLS : env.GBFS_VEHICLE_URLS;
  const urls = String(raw || '').split(',').map(s=>s.trim()).filter(Boolean).slice(0,30);
  if(!urls.length) return {features:[],source:kind==='taxi'?'Taxi public/authorized GBFS':'GBFS vehicle_status',status:'feed-required',error:'No real-time '+kind+' vehicle feed is configured'};
  const features=[], errors=[];
  await Promise.all(urls.map(async (u)=>{
    try{
      const r=await fetchT(u,{headers:{Accept:'application/json'}});
      if(!r.ok) throw new Error('HTTP '+r.status);
      const j=await r.json(), list=Array.isArray(j?.data?.vehicles)?j.data.vehicles:(Array.isArray(j?.vehicles)?j.vehicles:[]);
      for(const v of list){
        const lat=Number(v.lat??v.latitude), lon=Number(v.lon??v.longitude);
        if(!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
        const id=String(v.vehicle_id||v.id||crypto.randomUUID());
        const type=String(v.vehicle_type_id||v.vehicle_type||v.type||'').toLowerCase();
        const mode=kind==='taxi'?'taxi':(/car|auto|scooter|moped/i.test(type)?'car':/bike|bicycle/i.test(type)?'bike':'transit');
        const f=movementFeature(id,lon,lat,{kind:mode,category:mode,mode,layer:mode,vehicleId:id,heading:num(v.bearing),speed:num(v.speed),route:String(v.route_id||v.route||''),observedAt:v.last_reported?new Date(Number(v.last_reported)*1000).toISOString():nowIso(),source:'GBFS vehicle_status',sourceStatus:'live',feed:u});
        if(f) features.push(f);
      }
    }catch(e){errors.push(u+' · '+(e.message||e));}
  }));
  return {features:features.slice(0,10000),source:kind==='taxi'?'Taxi public/authorized GBFS':'GBFS vehicle_status',status:features.length?'live':'no-current-vehicles',observedAt:nowIso(),error:features.length?undefined:(errors.slice(0,3).join(' | ')||'No current vehicle positions returned')};
}

/* Reference-derived global transit/environment discovery. We reproduce public functionality, not proprietary site code. */
const OVERPASS_URLS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
const REF_SOURCES=[
 {id:'travic',name:'TRAVIC',capabilities:['global-transit-discovery','vehicle-visualization','station-search'],policy:'behavior-reference'},
 {id:'geops',name:'GeoP GeOps Mobility',capabilities:['global-transit-realtime','route-and-stop-discovery','vehicle-visualization'],policy:'public-service-reference'},
 {id:'trackmymetro',name:'TrackMyMetro',capabilities:['metro-network-search','station-search','route-planning'],policy:'india-metro-reference'},
 {id:'routemetro',name:'RouteMetro',capabilities:['metro-route-map','fare-route-workflow'],policy:'metro-reference'},
 {id:'yometro',name:'YoMetro',capabilities:['metro-network-directory','station-search','route-planning'],policy:'metro-reference'},
 {id:'globalnaturewatch',name:'Global Nature Watch',capabilities:['forest-change','nature-monitoring','environmental-layers'],policy:'environment-reference'},
 {id:'uber',name:'Uber',capabilities:['ride-request-workflow'],policy:'handoff-only-no-scraping'},
 {id:'landcarbonlab',name:'Land Carbon Lab',capabilities:['land-change','carbon','land-use-data'],policy:'environment-reference'},
 {id:'noaa-earth-realtime',name:'NOAA Earth Real-Time',capabilities:['live-satellite-imagery','clouds','storms','weather-earth'],policy:'public-imagery-reference'},
 {id:'google-earth',name:'Google Earth',capabilities:['3d-globe','terrain','earth-exploration'],policy:'behavior-reference'},
 {id:'copernicus-sentinel',name:'Copernicus Sentinel',capabilities:['earth-observation','satellite-imagery','catalog-discovery'],policy:'open-data-reference'},
 {id:'argos',name:'ARGOS',capabilities:['global-map','live-object-layers','source-inspection','camera-and-transport-discovery'],policy:'behavior-reference'}
];
function referenceRegistry(){return REF_SOURCES.map(x=>({...x,implemented:true,embedding:false}));}
function overpassQuery(b){
 const q='[out:json][timeout:20];(node["public_transport"~"station|stop_position"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+');node["railway"~"station|halt|tram_stop|subway_entrance"]('+b.minLat+','+b.minLon+','+b.maxLat+','+b.maxLon+'););out body;';
 return q;
}
async function transitDiscovery(req,env,url){
 const b=movementBbox(url.searchParams.get('bbox')||'-180,-85,180,85');
 if(!b)return json(req,env,{ok:false,error:'Valid bbox is required'},400);
 const mode=String(url.searchParams.get('mode')||'all').toLowerCase();
 const key=[b.minLon,b.minLat,b.maxLon,b.maxLat,mode].join('|');
 const cache=globalThis.__tmTransitDiscovery||(globalThis.__tmTransitDiscovery=new Map());
 const hit=cache.get(key);if(hit&&Date.now()-hit.t<60000)return json(req,env,hit.data);
 let body=null,last='';
 for(const endpoint of OVERPASS_URLS){try{
   const r=await fetchT(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:'data='+encodeURIComponent(overpassQuery(b))});
   if(!r.ok)throw new Error('HTTP '+r.status);
   body=await r.json();break;
 }catch(e){last=e.message||String(e);}}
 if(!body)return json(req,env,{ok:false,error:'Transit station discovery unavailable',detail:last},502);
 const features=[];
 for(const n of (body.elements||[])){
   const p=n.tags||{},rail=String(p.railway||'').toLowerCase(),pt=String(p.public_transport||'').toLowerCase();
   const isMetro=/subway|station|tram/.test(rail+pt)||/metro|subway|rapid transit|rrts/i.test(String(p.name||'')+' '+String(p.operator||''));
   const kind=isMetro?'metro':(/rail|train|station|halt/.test(rail)?'rail':(/bus|stop_position|platform/.test(pt+rail)?'bus':'transit'));
   if(mode!=='all'&&mode!=='transit'&&kind!==mode)continue;
   if(!Number.isFinite(Number(n.lat))||!Number.isFinite(Number(n.lon)))continue;
   features.push({type:'Feature',id:'osm-'+n.id,geometry:{type:'Point',coordinates:[Number(n.lon),Number(n.lat)]},properties:{kind,category:kind,layer:'transit-stations',name:String(p.name||'Unnamed stop'),network:String(p.network||p.operator||''),operator:String(p.operator||''),ref:String(p.ref||''),railway:String(p.railway||''),publicTransport:String(p.public_transport||''),source:'OpenStreetMap / Overpass',sourceStatus:'live-query',observedAt:nowIso()}});
 }
 const data={ok:true,type:'FeatureCollection',features:features.slice(0,15000),generatedAt:nowIso(),source:'OpenStreetMap / Overpass',sourceStatus:'live-query',references:['TRAVIC','GeoP GeOps Mobility','TrackMyMetro','RouteMetro','YoMetro']};
 cache.set(key,{t:Date.now(),data});
 return json(req,env,data);
}
async function environmentCatalog(req,env,url){
 const sources=[
  {id:'gnw',name:'Global Nature Watch',status:'catalog',url:'https://data.globalforestwatch.org/api/search/v1/collections'},
  {id:'lcl',name:'Land Carbon Lab',status:'catalog',url:'https://datasets.wri.org/teams/land-carbon-lab'},
  {id:'noaa',name:'NOAA Earth Real-Time',status:'live-imagery',url:'https://www.nesdis.noaa.gov/imagery/satellite-maps/earth-real-time'},
  {id:'copernicus',name:'Copernicus Sentinel',status:'open-earth-observation',url:'https://dataspace.copernicus.eu/'}
 ];
 let gnw=null;try{const r=await fetchT(sources[0].url,{headers:{Accept:'application/json'}});if(r.ok)gnw=await r.json();}catch(e){}
 return json(req,env,{ok:true,generatedAt:nowIso(),sources,gnwCatalogAvailable:!!gnw,policy:'TrackMeNow renders licensed/public data through its own layers and does not embed the reference websites.'});
}
const mobilityFeedListCache={t:0,feeds:null};
const MOBILITY_FEED_LIST_TTL=10*60*1000; /* feed list rarely changes; avoid a token+list round trip on every request */
async function movementTransit(env){
  let feeds=String(env.GTFS_RT_URLS||'').split(',').map(s=>s.trim()).filter(Boolean).map(url=>{
    const label=url;
    const kind=/metro|subway/i.test(label)?'metro':(/rail|train|tram/i.test(label)?'rail':'transit');
    return {url,label,kind,rail:kind!=='transit'};
  });
  if(env.DELHI_OTD_API_KEY){
    feeds.push({url:'https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb?key='+encodeURIComponent(String(env.DELHI_OTD_API_KEY)),label:'Delhi Open Transit Data',kind:'transit',rail:false});
  }
  if(!feeds.length&&env.MOBILITY_DB_REFRESH_TOKEN){
    if(mobilityFeedListCache.feeds&&Date.now()-mobilityFeedListCache.t<MOBILITY_FEED_LIST_TTL){
      feeds=mobilityFeedListCache.feeds;
    } else try{
      const r=await fetchT('https://api.mobilitydatabase.org/v1/tokens',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:env.MOBILITY_DB_REFRESH_TOKEN})},4000);
      if(!r.ok)throw new Error('Mobility Database token HTTP '+r.status);
      const t=await r.json(),access=t.access_token;
      if(access){
        const lr=await fetchT('https://api.mobilitydatabase.org/v1/gtfs_rt_feeds?entity_types=vp&status=active&limit=50',{headers:{Authorization:'Bearer '+access,Accept:'application/json'}},4000);
        if(!lr.ok)throw new Error('Mobility Database feeds HTTP '+lr.status);
        const body=await lr.json(),list=Array.isArray(body)?body:(body.data||body.results||[]);
        feeds=list.map(f=>{
          const si=f.source_info||{},urls=si.urls||{},url=urls.direct_download_url||si.producer_url||'';
          const label=String(f.name||f.feed_name||f.provider||'GTFS-Realtime');
          const kind=/metro|subway/i.test(label)?'metro':(/rail|train|tram/i.test(label)?'rail':'transit');
          return {url,label,kind,rail:kind!=='transit'};
        }).filter(f=>f.url).slice(0,30);
        mobilityFeedListCache.feeds=feeds; mobilityFeedListCache.t=Date.now();
      }
    }catch(e){
      if(mobilityFeedListCache.feeds){feeds=mobilityFeedListCache.feeds;} /* serve the stale list rather than nothing */
      else return {features:[],source:'Mobility Database / GTFS-Realtime',status:'error',error:e.message};
    }
  }
  if(!feeds.length)return {features:[],source:'GTFS-Realtime',status:'feed-required',error:'No GTFS realtime feed is configured'};
  const all=[],feedErrors=[];
  await Promise.all(feeds.map(async feed=>{try{const r=await fetchT(feed.url,{headers:{Accept:'application/x-protobuf,application/octet-stream'}},6000);if(!r.ok){feedErrors.push(feed.label+' HTTP '+r.status);return;}all.push(...gtfsVehicles(new Uint8Array(await r.arrayBuffer()),feed));}catch(e){feedErrors.push(feed.label+': '+(e.message||e));}}));
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
async function transitStatus(req,env){
  const gtfs=String(env.GTFS_RT_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const rail=String(env.RAIL_GTFS_RT_URLS||'').split(',').map(s=>s.trim()).filter(Boolean);
  return json(req,env,{ok:true,generatedAt:nowIso(),modes:{
    bus:{realtime:!!env.DELHI_OTD_API_KEY||!!env.GTFS_RT_URLS||!!env.MOBILITY_DB_REFRESH_TOKEN,source:env.DELHI_OTD_API_KEY?'Delhi Open Transit Data':(env.GTFS_RT_URLS||env.MOBILITY_DB_REFRESH_TOKEN?'GTFS-Realtime / Mobility Database':'feed-required')},
    metro:{realtime:gtfs.some(u=>/metro|subway/i.test(u)),source:gtfs.find(u=>/metro|subway/i.test(u))||'feed-required',network:'OpenStreetMap / Overpass for stations'},
    railway:{realtime:rail.length>0,source:rail.length?'Configured railway GTFS-Realtime':'feed-required',network:'OpenStreetMap / Overpass for stations'},
    taxi:{realtime:!!env.TAXI_VEHICLE_URLS,source:env.TAXI_VEHICLE_URLS?'Authorized/public GBFS':'feed-required'},
    bike:{realtime:!!env.GBFS_VEHICLE_URLS,source:env.GBFS_VEHICLE_URLS?'GBFS vehicle_status':'feed-required'},
    car:{realtime:!!env.GBFS_VEHICLE_URLS,source:env.GBFS_VEHICLE_URLS?'GBFS vehicle_status':'feed-required'}
  },policy:'No synthetic vehicle positions. Static network/station data may still be available through Overpass.'});
}
async function movement(req,env,url){
  const b=movementBbox(url.searchParams.get('bbox'));if(!b)return json(req,env,{ok:false,error:'Valid bbox=minLon,minLat,maxLon,maxLat is required'},400);
  const requestedLayers=String(url.searchParams.get('layers')||'flights,ships,public-transport').split(',').map(s=>s.trim()).filter(Boolean);
  const layers=[...new Set(requestedLayers.map(function(x){return x==='public-transport'?'transit':x;}))];
  const key=[b.minLon,b.minLat,b.maxLon,b.maxLat,layers.sort().join(',')].join('|'),hit=movementCache.get(key);
  if(hit&&Date.now()-hit.t<MOVEMENT_TTL)return json(req,env,hit.data);
  /* Each job gets a hard deadline. If a single upstream (OpenSky, Mobility Database, a GTFS feed…)
   * hangs instead of erroring, it must not take the whole response — and therefore every other
   * layer — down with it. That silent full-request hang is what made the transport tab look dead. */
  const withDeadline=(p,label,ms=9000)=>Promise.race([
    p,
    new Promise(res=>setTimeout(()=>res({features:[],source:label,status:'error',error:label+' timed out'}),ms))
  ]).catch(e=>({features:[],source:label,status:'error',error:e.message||String(e)}));
  const jobs=[];
  if(layers.includes('flights'))jobs.push(withDeadline(movementFlights(b,env),'flights'));
  if(layers.includes('ships'))jobs.push(withDeadline(movementShips(b,env),'AISstream.io'));
  if(layers.includes('transit')||layers.includes('public-transport')||layers.includes('rail'))jobs.push(withDeadline(movementTransit(env),'GTFS-Realtime',16000));
  if(layers.includes('taxi'))jobs.push(withDeadline(movementMobility(env,'taxi'),'taxi'));
  if(layers.includes('bike')||layers.includes('bikes'))jobs.push(withDeadline(movementMobility(env,'bike'),'bike'));
  if(layers.includes('car')||layers.includes('cars'))jobs.push(withDeadline(movementMobility(env,'car'),'car'));
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
      const s={...ss};      if(!s.observedAt && rf.length){const subset=rf.filter(f=>!s.layer||f.properties?.layer===s.layer||f.properties?.kind===s.layer);const t=latestObserved(subset);if(t)s.observedAt=new Date(t).toISOString();}
      sources.push(s);
    }
    const allowed=rf.filter(f=>{
      const layer=String(f.properties?.layer||'').toLowerCase(),kind=String(f.properties?.kind||f.properties?.category||'').toLowerCase();
      if(layer==='flights') return layers.includes('flights');
      if(layer==='ships') return layers.includes('ships');
      if(kind==='rail'||layer==='rail') return layers.includes('rail');
      if(kind==='metro'||layer==='metro') return layers.includes('metro');
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
      if (url.pathname === '/health' || url.pathname === '/') return json(req, env, { ok: true, service: 'TrackMeNow API', provider: 'OpenCelliD', cell: !!env.OPENCELLID_API_KEY, devices: !!env.DB, transport: { movement: true, ais: !!env.AISSTREAM_API_KEY, mobilityDatabase: !!env.MOBILITY_DB_REFRESH_TOKEN, aviationstack: !!env.AVIATIONSTACK_API_KEY, gbfs: String(env.GBFS_VEHICLE_URLS||'').split(',').filter(Boolean).length > 0, taxi: String(env.TAXI_VEHICLE_URLS||'').split(',').filter(Boolean).length > 0 }, cameras: true, cameraCatalog: String(env.CAMERA_GEOJSON_URLS||'').split(',').filter(Boolean).length ? 'configured-live-feed' : 'osm-overpass-catalogue-fallback', communication: !!env.DB, space: { iss: true, satellites: !!env.N2YO_API_KEY }, earthObservation: true });
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
      if (url.pathname === '/api/admin/request-otp' && req.method === 'POST') {
        const b=await readBody(req), username=String(b.username||'').trim();
        if(username!=='admin') return json(req,env,{error:'Invalid admin username.'},401);
        if(!env.DB) return json(req,env,{error:'Admin database is not configured.'},503);
        if(await limited(env,req,'admin-otp',5,600)) return json(req,env,{error:'Too many OTP requests. Try again later.'},429);
        await ensureAdminTables(env); await ensureAdminOtpTables(env);
        const otp=String(Math.floor(100000+Math.random()*900000)), id=crypto.randomUUID(), exp=new Date(Date.now()+10*60*1000).toISOString();
        await env.DB.prepare('INSERT INTO admin_otp_challenges(id,username,phone_hash,otp_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(id,'admin',await sha256(String(env.ADMIN_OTP_PHONE||'9650084311')),await sha256(otp),exp,nowIso()).run();
        try { const delivery=await sendAdminOtp(env,otp); await adminLog(env,req,'admin-otp-request','ADMIN','LOGIN','OTP requested; delivery='+delivery.provider); return json(req,env,{ok:true,challengeId:id,expiresAt:exp,maskedPhone:'******4311'}); }
        catch(e){ await env.DB.prepare('DELETE FROM admin_otp_challenges WHERE id=?').bind(id).run(); return json(req,env,{error:'OTP delivery is not configured on the Worker.'},503); }
      }
      if (url.pathname === '/api/admin/login' && req.method === 'POST') {
        const b=await readBody(req), username=String(b.username||'').trim(), otp=String(b.otp||'').trim(), challengeId=String(b.challengeId||'').trim();
        if(username!=='admin'||!/^[0-9]{6}$/.test(otp)||!challengeId) return json(req,env,{error:'Username, OTP and challenge are required.'},400);
        await ensureAdminTables(env); await ensureAdminOtpTables(env);
        const ch=await env.DB.prepare('SELECT * FROM admin_otp_challenges WHERE id=? AND username=? AND used_at IS NULL').bind(challengeId,'admin').first();
        if(!ch||ch.expires_at<=nowIso()||ch.attempts>=5||await sha256(otp)!==ch.otp_hash){ if(ch) await env.DB.prepare('UPDATE admin_otp_challenges SET attempts=attempts+1 WHERE id=?').bind(challengeId).run(); return json(req,env,{error:'Invalid or expired OTP.'},401); }
        await env.DB.prepare('UPDATE admin_otp_challenges SET used_at=? WHERE id=?').bind(nowIso(),challengeId).run();
        const t=token(), exp=new Date(Date.now()+8*60*60*1000).toISOString();
        await env.DB.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)').bind(await sha256(t),exp).run();
        await adminLog(env,req,'admin-login','ADMIN','LOGIN','Successful OTP login');
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
      if (url.pathname === '/api/integrations/ip/my' && req.method === 'GET') { /* Cloudflare already knows the visitor's own IP geo — no key, no third party */
        const cf = req.cf || {};
        if (cf.latitude == null) return json(req, env, { error: 'Location for this IP is not available from Cloudflare.' }, 404);
        return json(req, env, { ip: req.headers.get('CF-Connecting-IP') || null, latitude: Number(cf.latitude), longitude: Number(cf.longitude), city: cf.city || null, region: cf.region || null, country: cf.country || null, postalCode: cf.postalCode || null, timezone: cf.timezone || null, source: 'cloudflare' });
      }
      if (url.pathname === '/api/integrations/ip/lookup' && req.method === 'GET') { /* arbitrary IP: ipapi.co, free tier, no key required */
        const ip = String(url.searchParams.get('ip') || '').trim();
        if (!/^[0-9a-fA-F.:]{3,45}$/.test(ip)) return json(req, env, { error: 'A valid IP address is required.' }, 400);
        if (await limited(env, req, 'iplookup', 20, 600)) return json(req, env, { error: 'Too many lookups. Try again in a few minutes.' }, 429);
        let r, j;
        try { r = await fetchT('https://ipapi.co/' + encodeURIComponent(ip) + '/json/', { headers: { 'User-Agent': 'TrackMeNow/1.0' } }); j = await r.json(); }
        catch (e) { return json(req, env, { error: 'IP lookup service unreachable.' }, 502); }
        if (!r.ok || j.error || j.latitude == null) return json(req, env, { error: j.reason || 'No location found for that IP.' }, 404);
        return json(req, env, { ip: j.ip || ip, latitude: Number(j.latitude), longitude: Number(j.longitude), city: j.city || null, region: j.region || null, country: j.country_name || null, postalCode: j.postal || null, timezone: j.timezone || null, source: 'ipapi.co' });
      }
      if (url.pathname === '/api/visuals' && req.method === 'GET') {
        const allowed = ['LIVE','CAMERAS','WEBCAMS','IMAGES','VIDEOS','CLIPS','SOURCE HISTORY'];
        const category = allowed.includes(String(url.searchParams.get('category') || 'LIVE').toUpperCase())
          ? String(url.searchParams.get('category') || 'LIVE').toUpperCase() : 'LIVE';
        const configured = String(env.VISUALS_PUBLIC_SOURCE_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
        const sources = category === 'SOURCE HISTORY' ? [] : configured.map((source, i) => ({
          id:'configured-'+i,type:'public',status:category==='LIVE'?'LIVE':'SOURCE',title:'Configured public visual source',provider:'TrackMeNow public source adapter',url:source,category
        }));
        return json(req, env, {
          ok: true, storage: 'none',
          policy: 'TrackMeNow does not store or copy public visual media.',
          category, sources,
          labels: ['LIVE','RECORDED','ARCHIVED','USER SHARED','SOURCE OFFLINE']
        });
      }
      if (url.pathname.startsWith('/api/call/')) { const cr=await callApi(req,env,url); if(cr)return cr; }
      if (url.pathname === '/api/sources' && req.method === 'GET') {
        const b=movementBbox(url.searchParams.get('bbox')||'-180,-85,180,85');
        if(!b) return json(req,env,{ok:false,error:'Valid bbox is required'},400);
        const q=new URLSearchParams({bbox:[b.minLon,b.minLat,b.maxLon,b.maxLat].join(','),layers:'flights,ships,transit,rail,taxi,bike,car'});
        const movementUrl=new URL('https://example.com/api/movement?'+q.toString());
        const mv=await movement(req,env,movementUrl);
        return json(req,env,{ok:true,generatedAt:nowIso(),bbox:[b.minLon,b.minLat,b.maxLon,b.maxLat],sources:mv.sources||[],counts:(mv.features||[]).reduce((a,f)=>{const k=f.properties?.kind||f.properties?.layer||'other';a[k]=(a[k]||0)+1;return a;},{}),configuration:{camera:String(env.CAMERA_GEOJSON_URLS||'').split(',').filter(Boolean).length>0?'configured':'catalog-only',gbfs:String(env.GBFS_VEHICLE_URLS||'').split(',').filter(Boolean).length>0,taxi:String(env.TAXI_VEHICLE_URLS||'').split(',').filter(Boolean).length>0}});
      }
      if (url.pathname === '/api/space/iss' && req.method === 'GET') {
        try { const r=await fetchT('https://api.wheretheiss.at/v1/satellites/25544',{headers:{Accept:'application/json'}}); if(!r.ok) throw new Error('ISS HTTP '+r.status); const j=await r.json(); return json(req,env,{ok:true,source:'Where The ISS / public ISS telemetry',observedAt:nowIso(),feature:{type:'Feature',geometry:{type:'Point',coordinates:[Number(j.longitude),Number(j.latitude)]},properties:{kind:'space-station',name:'ISS',altitude:Number(j.altitude),velocity:Number(j.velocity),visibility:j.visibility,source:'Where The ISS',sourceStatus:'live'}}}); } catch(e){ return json(req,env,{ok:false,error:e.message},502); }
      }
      if (url.pathname === '/api/space/satellites' && req.method === 'GET') {
        /*
         * N2YO "above" uses a SEARCH RADIUS in degrees (0-90), not seconds.
         * Keep the API key server-side and never expose it to the browser.
         */
        if(!env.N2YO_API_KEY) return json(req,env,{
          ok:false,
          status:'feed-required',
          source:'N2YO',
          error:'Satellite feed is not configured on the TrackMeNow Worker.',
          code:'N2YO_API_KEY_MISSING',
          issAvailable:true
        },503);
        const lat=Number(url.searchParams.get('lat')||28.6139),
              lon=Number(url.searchParams.get('lon')||77.2090),
              alt=Number(url.searchParams.get('alt')||0),
              category=Number(url.searchParams.get('category')||0),
              radiusRaw=url.searchParams.get('radius') ?? url.searchParams.get('seconds') ?? '90',
              radius=Math.min(90,Math.max(0,Number(radiusRaw)));
        if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180||!Number.isFinite(alt)||!Number.isFinite(category)||!Number.isFinite(radius)){
          return json(req,env,{ok:false,status:'bad-request',source:'N2YO',error:'Invalid satellite observer or search-radius parameters.'},400);
        }
        const u='https://api.n2yo.com/rest/v1/satellite/above/'+encodeURIComponent(lat)+'/'+encodeURIComponent(lon)+'/'+encodeURIComponent(alt)+'/'+encodeURIComponent(radius)+'/'+encodeURIComponent(category)+'?apiKey='+encodeURIComponent(env.N2YO_API_KEY);
        try{
          const r=await fetchT(u,{headers:{Accept:'application/json'}});
          const j=await r.json().catch(()=>({}));
          if(!r.ok) throw new Error(j.error||('N2YO HTTP '+r.status));
          return json(req,env,{
            ok:true,
            status:'live',
            source:'N2YO',
            observedAt:nowIso(),
            observer:{lat,lon,alt},
            searchRadius:radius,
            category,
            satellites:j.above||[],
            info:j.info||null
          });
        }catch(e){
          return json(req,env,{ok:false,status:'upstream-error',source:'N2YO',error:e.message,issAvailable:true},502);
        }
      }
      if (url.pathname === '/api/earth-observation' && req.method === 'GET') {
        return json(req,env,{ok:true,source:'NASA GIBS / Copernicus public Earth observation',layers:[{id:'viirs-true-color',provider:'NASA GIBS',status:'public-near-real-time',url:'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/'},{id:'viirs-fires',provider:'NASA GIBS',status:'public-near-real-time',url:'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/'},{id:'sentinel',provider:'Copernicus Sentinel',status:'public-data',url:'https://dataspace.copernicus.eu/'}],policy:'TrackMeNow uses the source data through its own map layers; reference websites are not embedded.'});
      }
      if (url.pathname === '/api/transit/status' && req.method === 'GET') return await transitStatus(req,env);\n      if (url.pathname === '/api/transit/discovery' && req.method === 'GET') return await transitDiscovery(req,env,url);
      if (url.pathname === '/api/environment/catalog' && req.method === 'GET') return await environmentCatalog(req,env,url);
      if (url.pathname === '/api/references' && req.method === 'GET') return json(req,env,{ok:true,generatedAt:nowIso(),sources:referenceRegistry()});
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