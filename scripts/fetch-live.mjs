/* Collects live transport snapshots for the site. Run by .github/workflows/live-data.yml every ~10 minutes.
 *
 *   flights.json  aircraft        OpenSky Network (global); falls back to ADSB.lol point queries
 *   ships.json    vessels         AISstream.io websocket   (secret AISSTREAM_API_KEY)
 *   transit.json  buses/trams/... GTFS-Realtime feeds found via Mobility Database (secret MOBILITY_DB_REFRESH_TOKEN)
 *   meta.json     what worked and what did not
 *
 * Keys come from environment variables (GitHub Secrets) and are never written to any output file.
 * Each section is independent: a failure is recorded in meta.json and the previous file (copied into the
 * output folder by the workflow) is kept, so one bad source never blanks the map.
 * Compact array rows keep the files small. Row layouts are documented next to each collector. */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const OUT = process.argv[2] || 'out';
const E = process.env;
const UA = { 'User-Agent': 'TrackMeNow-live-data/1.0 (+https://github.com/connectingprofessional/trackmenow)' };
const OPENSKY = E.OPENSKY_URL || 'https://opensky-network.org/api/states/all';
const ADSBLOL = E.ADSBLOL_BASE || 'https://api.adsb.lol';
const AIS_WS = E.AIS_WS_URL || 'wss://stream.aisstream.io/v0/stream';
const MDB = E.MDB_BASE || 'https://api.mobilitydatabase.org';
const r = (v, d) => (Number.isFinite(+v) ? +(+v).toFixed(d) : null);
const now = () => Math.floor(Date.now() / 1000);
const status = {}, counts = {};

async function getJSON(url, opt = {}, ms = 30000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms), ...opt });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function pool(items, size, fn) {
  const q = items.slice(), out = [];
  await Promise.all(Array.from({ length: size }, async () => { while (q.length) { const it = q.shift(); try { out.push(await fn(it)); } catch (e) { /* skip item */ } } }));
  return out;
}

/* ── flights: [icao24, lat, lon, track°, speed m/s, altitude m, callsign, country] ── */
function openskyRows(j) {
  const rows = [];
  for (const s of j.states || []) {
    const lon = +s[5], lat = +s[6];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || s[8]) continue; /* skip on-ground */
    rows.push([s[0], r(lat, 4), r(lon, 4), r(s[10] ?? 0, 0), r(s[9] ?? 0, 0), r(s[13] ?? s[7] ?? 0, 0), (s[1] || '').trim(), s[2] || '']);
  }
  return rows;
}
function adsbRows(list, seen) {
  const rows = [];
  for (const a of list || []) {
    if (!a.hex || seen.has(a.hex) || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || a.alt_baro === 'ground') continue;
    seen.add(a.hex);
    rows.push([a.hex, r(a.lat, 4), r(a.lon, 4), r(a.track ?? 0, 0), r((a.gs ?? 0) * 0.514444, 0), r((typeof a.alt_baro === 'number' ? a.alt_baro : 0) * 0.3048, 0), (a.flight || '').trim(), '']);
  }
  return rows;
}
function adsbGrid() { /* dense traffic regions, ~450 km spacing (ADSB.lol point radius max 250 nm) */
  const boxes = [[35, 62, -10, 35], [25, 55, -125, -65], [20, 45, 100, 145], [8, 36, 35, 90], [-35, -5, -60, -35], [-37, -24, 115, 155], [-35, -20, 15, 35], [0, 22, 95, 125], [15, 30, -105, -85]], pts = [];
  for (const [a, b, c, d] of boxes) for (let la = a; la <= b; la += 4.2) for (let lo = c; lo <= d; lo += 4.2 / Math.max(0.35, Math.cos(la * Math.PI / 180))) pts.push([+la.toFixed(2), +lo.toFixed(2)]);
  return pts;
}
async function flights() {
  try {
    const j = await getJSON(OPENSKY, {}, 40000), rows = openskyRows(j);
    if (rows.length < 200) throw new Error('only ' + rows.length + ' aircraft');
    return { t: j.time || now(), src: 'OpenSky Network', a: rows };
  } catch (e) {
    status.flights_opensky = 'failed: ' + e.message;
    const seen = new Set(), rows = [];
    await pool(adsbGrid().slice(0, 220), 8, async ([la, lo]) => { const j = await getJSON(`${ADSBLOL}/v2/point/${la}/${lo}/250`, {}, 6000); rows.push(...adsbRows(j.ac, seen)); });
    if (rows.length < 100) throw new Error('OpenSky and ADSB.lol both returned too little (' + rows.length + ')');
    return { t: now(), src: 'ADSB.lol (regional)', a: rows };
  }
}

/* ── ships: [mmsi, lat, lon, course°, speed kn, name, unix time of the position] ── */
function collectAis(key, seconds) {
  return new Promise((resolve, reject) => {
    const ships = new Map(); let settled = false, err = null;
    const ws = new WebSocket(AIS_WS);
    const finish = () => { if (settled) return; settled = true; try { ws.close(); } catch (e) {} err && !ships.size ? reject(new Error(err)) : resolve(ships); };
    const timer = setTimeout(finish, seconds * 1000 + 3000);
    ws.on('open', () => { ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport'] })); setTimeout(finish, seconds * 1000); });
    ws.on('message', (raw) => {
      try {
        const e = JSON.parse(Buffer.from(raw).toString('utf8'));
        if (e.error) { err = String(e.error); return finish(); }
        const m = (e.Message && (e.Message.PositionReport || e.Message.StandardClassBPositionReport)) || null, md = e.MetaData || {};
        if (!m) return;
        const lat = +(m.Latitude ?? md.latitude), lon = +(m.Longitude ?? md.longitude), mmsi = String(m.UserID ?? md.MMSI ?? '');
        if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
        const cog = +m.Cog < 360 ? +m.Cog : (+m.TrueHeading < 360 ? +m.TrueHeading : 0), sog = +m.Sog < 102.3 ? +m.Sog : 0;
        ships.set(mmsi, [+mmsi, r(lat, 4), r(lon, 4), r(cog, 0), r(sog, 1), String(md.ShipName || '').trim().slice(0, 28), now()]);
      } catch (x) { /* ignore malformed */ }
    });
    ws.on('error', (x) => { err = x.message || 'websocket error'; finish(); });
    ws.on('close', () => { clearTimeout(timer); finish(); });
  });
}
async function ships() {
  if (!E.AISSTREAM_API_KEY) throw new Error('skipped: AISSTREAM_API_KEY secret not set');
  const m = await collectAis(E.AISSTREAM_API_KEY, Number(E.AIS_SECONDS || 50));
  if (m.size < 50) throw new Error('only ' + m.size + ' vessels received');
  /* AIS is sparse in a short listen: keep vessels from the previous snapshot (up to 45 min old) that were not heard this time */
  let kept = 0;
  try {
    const prev = JSON.parse(await readFile(`${OUT}/ships.json`, 'utf8')), cut = now() - 2700;
    for (const row of prev.a || []) { const t = row[6] || prev.t || 0; if (t >= cut && !m.has(String(row[0]))) { m.set(String(row[0]), [row[0], row[1], row[2], row[3], row[4], row[5], t]); kept++; } }
  } catch (e) { /* no previous snapshot */ }
  return { t: now(), src: 'AISstream.io', a: [...m.values()].slice(0, 60000) };
}

/* ── transit: [id, lat, lon, bearing°, speed m/s, label, route] ── */
async function transit() {
  if (!E.MOBILITY_DB_REFRESH_TOKEN) throw new Error('skipped: MOBILITY_DB_REFRESH_TOKEN secret not set');
  const tk = await getJSON(MDB + '/v1/tokens', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: E.MOBILITY_DB_REFRESH_TOKEN }) });
  if (!tk.access_token) throw new Error('no access_token in token response');
  const max = Number(E.MOBILITY_DB_MAX_FEEDS || 200), urls = [];
  for (let off = 0; off < 4000 && urls.length < max; off += 1000) {
    const list = await getJSON(`${MDB}/v1/gtfs_rt_feeds?entity_types=vp&limit=1000&offset=${off}`, { headers: { ...UA, Authorization: 'Bearer ' + tk.access_token } });
    if (!Array.isArray(list)) break;
    for (const f of list) { const si = f.source_info || {}; if (f.status === 'active' && si.producer_url && !si.authentication_type && !urls.includes(si.producer_url)) urls.push(si.producer_url); if (urls.length >= max) break; }
    if (list.length < 1000) break;
  }
  if (!urls.length) throw new Error('Mobility Database returned no open vehicle feeds');
  const rows = []; let okFeeds = 0;
  await pool(urls, 12, async (u) => {
    const res = await fetch(u, { headers: { ...UA, Accept: 'application/x-protobuf,application/octet-stream' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(await res.arrayBuffer())), n = now(); let got = 0;
    for (const e of feed.entity || []) {
      const v = e.vehicle, p = v && v.position; if (!p || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
      const ts = Number(v.timestamp || (feed.header && feed.header.timestamp) || 0); if (ts && n - ts > 300) continue;
      rows.push([String((v.vehicle && v.vehicle.id) || e.id || ''), r(p.latitude, 5), r(p.longitude, 5), r(p.bearing ?? 0, 0), r(p.speed ?? 0, 1), String((v.vehicle && v.vehicle.label) || '').slice(0, 20), String((v.trip && v.trip.routeId) || '').slice(0, 20)]);
      got++;
    }
    if (got) okFeeds++;
  });
  if (rows.length < 20) throw new Error('only ' + rows.length + ' vehicles from ' + urls.length + ' feeds');
  return { t: now(), src: 'GTFS-Realtime via Mobility Database', feeds: okFeeds, a: rows.slice(0, 40000) };
}

await mkdir(OUT, { recursive: true });
const jobs = { flights, ships, transit };
await Promise.all(Object.entries(jobs).map(async ([name, fn]) => {
  try {
    const d = await fn(); await writeFile(`${OUT}/${name === 'flights' ? 'flights' : name}.json`, JSON.stringify(d));
    status[name] = 'ok'; counts[name] = d.a.length;
  } catch (e) { status[name] = String(e.message || e); }
}));
await writeFile(`${OUT}/meta.json`, JSON.stringify({ generated: new Date().toISOString(), status, counts }));
console.log(JSON.stringify({ status, counts }));
