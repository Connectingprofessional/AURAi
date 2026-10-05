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
  const h = { 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Max-Age': '86400' };
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
async function devices(req, env, url, parts) {
  const method = req.method, sub = parts[2] || '', id = parts[2] && parts[3] ? parts[2] : null, act = parts[3] || '';
  const byPhone = (phone, activeOnly = true) => { const [a, b] = phoneForms(phone); return env.DB.prepare('SELECT * FROM devices WHERE phone IN (?, ?)' + (activeOnly ? ' AND revoked_at IS NULL' : '') + ' LIMIT 1').bind(a, b).first(); };

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
    const viewer = await deviceByViewerToken(env, bearer(req));
    if (!viewer) return json(req, env, { error: 'Viewer authorization required. Pair the device with its one-time code first.' }, 401);
    if (!samePhone(viewer.phone, phone)) return json(req, env, { found: false, error: 'This viewer token is not authorized for that number.' }, 403);
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
  return json(req, env, { error: 'Route not found' }, 404);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    const url = new URL(req.url), parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/health' || url.pathname === '/') return json(req, env, { ok: true, service: 'TrackMeNow Cell API', provider: 'OpenCelliD', cell: !!env.OPENCELLID_API_KEY, devices: !!env.DB });
      if (url.pathname === '/api/db-test') {
        if (!env.DB) return json(req, env, { ok: false, database: 'binding-missing', error: 'D1 binding DB is not available.' }, 500);
        const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('devices', 'telemetry', 'rate_limits') ORDER BY name").all();
        const t = new Set((r.results || []).map((x) => x.name));
        let migrated = false; try { await env.DB.prepare('SELECT pairing_expires_at FROM devices LIMIT 1').first(); migrated = true; } catch (e) {}
        return json(req, env, { ok: true, database: 'connected', tables: { devices: t.has('devices'), telemetry: t.has('telemetry'), rate_limits: t.has('rate_limits') }, pairingExpiryColumn: migrated });
      }
      if (!['GET', 'POST'].includes(req.method)) return json(req, env, { ok: false, error: 'Method not allowed' }, 405);
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
