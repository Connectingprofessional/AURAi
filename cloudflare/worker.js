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

function normalizePhone(v) {
  const d = String(v || '').trim().replace(/[^0-9+]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(d)) return null;
  return d.startsWith('+') ? d : '+' + d;
}
const maskPhone = (p) => (p ? p.replace(/(\+\d{2})\d+(\d{3})$/, '$1•••••$2') : '');
const bearer = (req) => { const h = req.headers.get('Authorization') || ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '86400' };
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function json(req, env, body, status = 200, extra = {}) {
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
const deviceByDeviceToken = async (env, tok) => (tok ? env.DB.prepare('SELECT * FROM devices WHERE device_token_hash = ? AND revoked_at IS NULL').bind(await sha256(tok)).first() : null);
const deviceByViewerToken = async (env, tok) => (tok ? env.DB.prepare('SELECT * FROM devices WHERE viewer_token_hash = ? AND revoked_at IS NULL').bind(await sha256(tok)).first() : null);
async function latestPoint(env, id) {
  const p = await env.DB.prepare('SELECT * FROM telemetry WHERE device_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1').bind(id).first();
  return p ? pointOut(p) : null;
}
const pointOut = (p) => ({ lat: p.lat, lon: p.lon, accuracy: p.accuracy, altitude: p.altitude, speed: p.speed, heading: p.heading, recordedAt: p.recorded_at, timestamp: p.recorded_at, radio: p.radio_json ? JSON.parse(p.radio_json) : null, source: 'android-gps' });

/* ───────── OpenCelliD single-cell lookup (key stays server-side) ───────── */
async function cellLookup(req, env, url) {
  if (!env.OPENCELLID_API_KEY) return json(req, env, { ok: false, error: 'OPENCELLID_API_KEY secret is not set on the Worker' }, 503);
  const q = url.searchParams, ints = ['mcc', 'mnc', 'lac', 'cellid'].map((k) => Number(q.get(k)));
  if (!ints.every(Number.isInteger)) return json(req, env, { ok: false, error: 'mcc, mnc, lac and cellid must be integers' }, 400);
  const radio = String(q.get('radio') || '').toUpperCase();
  const u = new URL('https://opencellid.org/cell/get');
  u.searchParams.set('key', env.OPENCELLID_API_KEY); u.searchParams.set('mcc', ints[0]); u.searchParams.set('mnc', ints[1]);
  u.searchParams.set('lac', ints[2]); u.searchParams.set('cellid', ints[3]); u.searchParams.set('format', 'json');
  if (['GSM', 'UMTS', 'LTE', 'NR', 'CDMA'].includes(radio)) u.searchParams.set('radio', radio);
  let r, j;
  try { r = await fetch(u, { cf: { cacheTtl: 3600 } }); j = await r.json(); } catch (e) { return json(req, env, { ok: false, error: 'OpenCelliD unreachable' }, 502); }
  if (!j || j.error || j.lat === undefined) return json(req, env, { ok: false, error: (j && (j.error || j.message)) || 'Cell not found in OpenCelliD' }, r.status === 200 ? 404 : 502);
  return json(req, env, { ok: true, data: { mcc: ints[0], mnc: ints[1], lac: ints[2], cellid: ints[3], radio: j.radio || radio || null, latitude: Number(j.lat), longitude: Number(j.lon), range: num(j.range), samples: num(j.samples) } });
}

/* ───────── device API ───────── */
async function devices(req, env, url, parts) {
  const method = req.method, sub = parts[2] || '', id = parts[2] && parts[3] ? parts[2] : null, act = parts[3] || '';

  if (method === 'POST' && sub === 'register') {
    if (await limited(env, req, 'register', 10, 3600)) return json(req, env, { error: 'Too many registrations. Try later.' }, 429);
    const b = await readBody(req), phone = normalizePhone(b.phone), label = String(b.label || 'My TrackMeNow device').trim().slice(0, 80);
    if (!phone) return json(req, env, { error: 'A valid mobile number is required.' }, 400);
    if (b.consent !== true) return json(req, env, { error: 'Explicit device-owner consent is required.' }, 403);
    const exists = await env.DB.prepare('SELECT id FROM devices WHERE phone = ? AND revoked_at IS NULL').bind(phone).first();
    if (exists) return json(req, env, { error: 'This number is already registered. Revoke it from the registered device first.' }, 409);
    await env.DB.prepare('DELETE FROM devices WHERE phone = ? AND revoked_at IS NOT NULL').bind(phone).run();
    const dev = { id: crypto.randomUUID(), tok: token(), code: code6() };
    const exp = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await env.DB.prepare('INSERT INTO devices (id, phone, label, device_token_hash, pairing_code_hash, pairing_expires_at, consented_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(dev.id, phone, label, await sha256(dev.tok), await sha256(dev.code), exp, nowIso(), nowIso()).run();
    return json(req, env, { deviceId: dev.id, deviceToken: dev.tok, pairingCode: dev.code, pairingExpiresAt: exp, maskedPhone: maskPhone(phone), message: 'Device registered with owner consent. Enter the pairing code on the TrackMeNow dashboard within 15 minutes.' }, 201);
  }

  if (method === 'POST' && sub === 'pair') {
    if (await limited(env, req, 'pair', 8, 600)) return json(req, env, { error: 'Too many pairing attempts. Try again in a few minutes.' }, 429);
    const b = await readBody(req), c = String(b.pairingCode || '').trim();
    if (!/^\d{6}$/.test(c)) return json(req, env, { error: 'Enter the 6-digit pairing code shown on the device.' }, 400);
    const d = await env.DB.prepare('SELECT * FROM devices WHERE pairing_code_hash = ? AND revoked_at IS NULL').bind(await sha256(c)).first();
    if (!d || !d.pairing_expires_at || d.pairing_expires_at < nowIso()) return json(req, env, { error: 'Pairing code not found, expired or already used.' }, 404);
    const viewer = token();
    await env.DB.prepare('UPDATE devices SET viewer_token_hash = ?, pairing_code_hash = NULL, pairing_expires_at = NULL WHERE id = ?').bind(await sha256(viewer), d.id).run();
    return json(req, env, { deviceId: d.id, viewerToken: viewer, maskedPhone: maskPhone(d.phone), label: d.label });
  }

  if (method === 'GET' && sub === 'search') {
    if (await limited(env, req, 'search', 30, 600)) return json(req, env, { error: 'Too many requests.' }, 429);
    const phone = normalizePhone(url.searchParams.get('phone'));
    if (!phone) return json(req, env, { error: 'Enter a valid mobile number.' }, 400);
    const d = await env.DB.prepare('SELECT id, label FROM devices WHERE phone = ? AND revoked_at IS NULL').bind(phone).first();
    if (!d) return json(req, env, { found: false, message: 'No consented TrackMeNow device is registered for this number.' }, 404);
    return json(req, env, { found: true, maskedPhone: maskPhone(phone), consented: true, access: 'PAIRING_REQUIRED' });
  }

  if (method === 'GET' && sub === 'lookup') {
    if (await limited(env, req, 'lookup', 30, 600)) return json(req, env, { error: 'Too many lookups. Try again in a few minutes.' }, 429);
    const phone = normalizePhone(url.searchParams.get('phone'));
    if (!phone) return json(req, env, { error: 'Enter a valid mobile number.' }, 400);
    const viewer = await deviceByViewerToken(env, bearer(req));
    if (!viewer) return json(req, env, { error: 'Viewer authorization required. Pair the device with its one-time code first.' }, 401);
    if (viewer.phone !== phone) return json(req, env, { found: false, error: 'This viewer token is not authorized for that number.' }, 403);
    const loc = await latestPoint(env, viewer.id);
    return json(req, env, { found: true, deviceId: viewer.id, maskedPhone: maskPhone(viewer.phone), label: viewer.label, location: loc, ...(loc ? {} : { message: 'Device is registered but has no GPS telemetry yet.' }) });
  }

  if (id && method === 'POST' && act === 'telemetry') {
    const d = await deviceByDeviceToken(env, bearer(req));
    if (!d || d.id !== id) return json(req, env, { error: 'Invalid device token.' }, 401);
    if (await limited(env, req, 'telemetry:' + id, 120, 60)) return json(req, env, { error: 'Sending too fast.' }, 429);
    const t = await readBody(req), lat = Number(t.lat), lon = Number(t.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return json(req, env, { error: 'Valid GPS coordinates are required.' }, 400);
    const ts = t.timestamp && !Number.isNaN(Date.parse(t.timestamp)) ? new Date(t.timestamp).toISOString() : nowIso();
    await env.DB.prepare('INSERT INTO telemetry (device_id, recorded_at, lat, lon, accuracy, altitude, speed, heading, radio_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, ts, lat, lon, num(t.accuracy), num(t.altitude), num(t.speed), num(t.heading), t.radio && typeof t.radio === 'object' ? JSON.stringify(t.radio).slice(0, 2000) : null).run();
    const cutoff = new Date(Date.now() - (Number(env.RETENTION_DAYS) || 7) * 86400000).toISOString();
    await env.DB.prepare('DELETE FROM telemetry WHERE device_id = ? AND recorded_at < ?').bind(id, cutoff).run();
    return json(req, env, { ok: true, receivedAt: nowIso() }, 201);
  }

  if (id && method === 'GET' && (act === 'latest' || act === 'history')) {
    const v = await deviceByViewerToken(env, bearer(req));
    if (!v || v.id !== id) return json(req, env, { error: 'Pair this device before viewing telemetry.' }, 401);
    if (act === 'latest') return json(req, env, { deviceId: v.id, label: v.label, maskedPhone: maskPhone(v.phone), latest: await latestPoint(env, v.id) });
    const rows = await env.DB.prepare('SELECT * FROM telemetry WHERE device_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 500').bind(v.id).all();
    return json(req, env, { deviceId: v.id, history: (rows.results || []).reverse().map(pointOut) });
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
    return json(req, env, { ok: true, revoked: true });
  }
  return json(req, env, { error: 'Not found' }, 404);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    const url = new URL(req.url), parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/health' || url.pathname === '/') return json(req, env, { ok: true, service: 'trackmenow-worker', cell: !!env.OPENCELLID_API_KEY, devices: !!env.DB });
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
