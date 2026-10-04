/* Fetches public NASA data at deploy time and writes one compact JSON file the site reads.
 * Sources: JPL Horizons (spacecraft), JPL Small-Body Database (asteroids/comets/NEOs/TNOs),
 * JPL CNEOS close-approach data, NASA Exoplanet Archive (stars with confirmed planets).
 * Browsers cannot call most of these directly (no CORS), so it runs here on the build runner.
 * Every section is optional: a failed source is recorded in meta.status and skipped. */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT = process.argv[2] || '_site/data/nasa.json';
const UA = { 'User-Agent': 'TrackMeNow-site-build/1.0 (+https://github.com/connectingprofessional/trackmenow)' };
const now = new Date();
const jdNow = now.getTime() / 86400000 + 2440587.5;
const status = {};
const writeOut = async (o) => { await mkdir(dirname(OUT), { recursive: true }); await writeFile(OUT, JSON.stringify(o)); };
process.on('uncaughtException', async (e) => { try { await writeOut({ meta: { generated: now.toISOString(), status, error: String((e && e.stack) || e).slice(0, 800) } }); } catch (x) {} console.error(e); process.exit(0); });
process.on('unhandledRejection', (e) => { throw e; });
const r = (v, d) => (Number.isFinite(+v) ? +(+v).toFixed(d) : null);

async function getJSON(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { err = e; await new Promise(k => setTimeout(k, 1500 * (i + 1))); }
  }
  throw err;
}
async function section(name, fn) {
  try { const v = await fn(); status[name] = 'ok'; return v; }
  catch (e) { status[name] = 'failed: ' + (e.message || e); console.warn(name, status[name]); return null; }
}

/* ── spacecraft: Horizons heliocentric ecliptic vectors, 30-minute steps from -2h to +72h ── */
const CRAFT = [
  ['Voyager 1', '-31', '#ffcc00'], ['Voyager 2', '-32', '#ffaa00'], ['New Horizons', '-98', '#ff9ec8'],
  ['Parker Solar Probe', '-96', '#ff6666'], ['Juno', '-61', '#ffd9a0'], ['James Webb Space Telescope', '-170', '#88ccff'],
  ['Lucy', '-49', '#c8ffa0'], ['Psyche', '-255', '#e0b0ff'], ['Europa Clipper', '-159', '#a0ffe8'],
  ['BepiColombo', '-121', '#ffb070'], ['Solar Orbiter', '-144', '#ff8a8a']
];
const fmt = d => d.toISOString().slice(0, 16).replace('T', ' ');
async function horizons(id) {
  const t0 = new Date(now.getTime() - 2 * 3600e3), t1 = new Date(now.getTime() + 72 * 3600e3);
  const q = new URLSearchParams({
    format: 'json', COMMAND: `'${id}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@10'", REF_PLANE: "'ECLIPTIC'", START_TIME: `'${fmt(t0)}'`, STOP_TIME: `'${fmt(t1)}'`,
    STEP_SIZE: "'30 min'", VEC_TABLE: "'1'", OUT_UNITS: "'AU-D'", CSV_FORMAT: "'YES'"
  });
  const j = await getJSON('https://ssd.jpl.nasa.gov/api/horizons.api?' + q);
  const txt = j.result || '';
  const a = txt.indexOf('$$SOE'), b = txt.indexOf('$$EOE');
  if (a < 0 || b < 0) throw new Error('no ephemeris (' + txt.split('\n').slice(0, 3).join(' ').slice(0, 120) + ')');
  const rows = txt.slice(a + 5, b).trim().split('\n').map(l => l.split(',').map(s => s.trim()));
  const pts = rows.map(c => [+c[2], +c[3], +c[4]]).filter(p => p.every(Number.isFinite));
  const jd0 = +rows[0][0];
  if (pts.length < 3) throw new Error('too few points');
  return { jd0, step: 30 / 1440, p: pts.map(p => p.map(v => r(v, 7))) };
}
const spacecraft = await section('spacecraft', async () => {
  const out = [], bad = [];
  for (const [name, id, color] of CRAFT) {
    try { out.push({ name, id, color, ...(await horizons(id)) }); } catch (e) { bad.push(name + ': ' + e.message); }
    await new Promise(k => setTimeout(k, 400));
  }
  if (bad.length) status.spacecraft_skipped = bad;
  if (!out.length) throw new Error('none returned');
  return out;
});

/* ── small bodies: [name, a, e, i, om, w, ma, epoch_jd, period_days, H, pha] ── */
const EL = 'full_name,a,e,i,om,w,ma,epoch,per_y,H,pha';
const clean = s => String(s).trim().replace(/^\d+\s+/, m => m).replace(/\s+/g, ' ');
function packRows(fields, data) {
  const ix = Object.fromEntries(fields.map((f, k) => [f, k]));
  const out = [];
  for (const row of data) {
    const a = +row[ix.a], e = +row[ix.e], per = +row[ix.per_y] * 365.25;
    if (!(a > 0) || !(e >= 0 && e < 1) || !(per > 0)) continue;
    out.push([clean(row[ix.full_name]), r(a, 5), r(e, 5), r(row[ix.i], 3), r(row[ix.om], 3), r(row[ix.w], 3),
      r(row[ix.ma], 4), r(row[ix.epoch], 1), r(per, 2), row[ix.H] == null ? null : r(row[ix.H], 2), row[ix.pha] === 'Y' ? 1 : 0]);
  }
  return out;
}
async function sbdb(params, label) {
  const base = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=' + EL + '&' + params;
  let j;
  try { j = await getJSON(base + '&sort=H'); } catch (e) { j = await getJSON(base); }
  const rows = packRows(j.fields, j.data || []);
  if (!rows.length) throw new Error(label + ': empty');
  return rows;
}
const neo = await section('neo', () => sbdb('sb-group=neo&limit=400', 'neo'));
const mba = await section('mainBelt', () => sbdb('sb-class=MBA&limit=500', 'mba'));
const trojans = await section('trojans', () => sbdb('sb-class=TJN&limit=200', 'tjn'));
const tno = await section('tno', () => sbdb('sb-class=TNO,CEN&limit=150', 'tno'));
const comets = await section('comets', async () => {
  const j = await getJSON('https://ssd-api.jpl.nasa.gov/sbdb_query.api?sb-kind=c&limit=6000&fields=full_name,e,q,i,om,w,tp,per_y');
  const ix = Object.fromEntries(j.fields.map((f, k) => [f, k]));
  const famous = /^\s*(1P|2P|9P|19P|21P|67P|81P|103P|109P|153P)\//;
  const rows = [];
  for (const d of j.data) {
    const e = +d[ix.e], q = +d[ix.q], tp = +d[ix.tp], per = +d[ix.per_y] * 365.25;
    if (!(e >= 0 && e < 1) || !(q > 0) || !(per > 0)) continue;
    const near = Math.abs(tp - jdNow) < 2.2 * 365.25;
    if (!near && !famous.test(d[ix.full_name])) continue;
    const a = q / (1 - e);
    rows.push([clean(d[ix.full_name]), r(a, 5), r(e, 6), r(d[ix.i], 3), r(d[ix.om], 3), r(d[ix.w], 3), 0, r(tp, 3), r(per, 2), null, 0]);
  }
  rows.sort((x, y) => Math.abs(x[7] - jdNow) - Math.abs(y[7] - jdNow));
  if (!rows.length) throw new Error('no comets');
  return rows.slice(0, 160);
});

/* ── upcoming close approaches (CNEOS) ── */
const approaches = await section('closeApproaches', async () => {
  const j = await getJSON('https://ssd-api.jpl.nasa.gov/cad.api?dist-max=0.1&date-min=now&date-max=%2B90&sort=date&limit=60');
  const ix = Object.fromEntries(j.fields.map((f, k) => [f, k]));
  const out = (j.data || []).map(d => ({ des: d[ix.des].trim(), cd: d[ix.cd], au: r(d[ix.dist], 6), vrel: r(d[ix.v_rel], 2), h: r(d[ix.h], 2) }));
  if (!out.length) throw new Error('none in window');
  return out;
});

/* ── NASA Exoplanet Archive: one row per host star ── */
const hosts = await section('exoplanetHosts', async () => {
  const q = 'select hostname,ra,dec,sy_dist,sy_pnum,st_teff,sy_vmag from pscomppars where ra is not null and dec is not null and sy_dist is not null';
  const j = await getJSON('https://exoplanetarchive.ipac.caltech.edu/TAP/sync?format=json&query=' + encodeURIComponent(q));
  const m = new Map();
  for (const p of j) if (!m.has(p.hostname)) m.set(p.hostname, [p.hostname, r(p.ra, 4), r(p.dec, 4), r(p.sy_dist, 3), p.sy_pnum | 0, p.st_teff == null ? null : Math.round(p.st_teff), p.sy_vmag == null ? null : r(p.sy_vmag, 2)]);
  if (m.size < 50) throw new Error('too few hosts: ' + m.size);
  return [...m.values()];
});

const out = {
  meta: { generated: now.toISOString(), jdGenerated: r(jdNow, 4), status,
    sources: { spacecraft: 'NASA/JPL Horizons', smallBodies: 'NASA/JPL Small-Body Database', closeApproaches: 'NASA/JPL CNEOS', exoplanetHosts: 'NASA Exoplanet Archive (Caltech/IPAC)' } },
  spacecraft, neo, mainBelt: mba, trojans, tno, comets, closeApproaches: approaches, exoplanetHosts: hosts
};
await writeOut(out);
console.log('wrote', OUT, JSON.stringify(status));
