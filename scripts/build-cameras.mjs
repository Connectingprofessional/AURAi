// scripts/build-cameras.mjs
// Fetches the live camera catalogue, understands GeoJSON or camera arrays,
// tests every camera, and writes only working cameras to cameras.json.
// Env: CAMERA_CATALOGUE_URL or CAMERA_CATALOGUE_FILE, OUT_FILE (default cameras.json)

import fs from 'node:fs';

const DEFAULT_SRC_URL = 'https://raw.githubusercontent.com/willytop8/Live-Environment-Streams/main/streams.geojson';
const SRC_URL = process.env.CAMERA_CATALOGUE_URL || DEFAULT_SRC_URL;
const SRC_FILE = process.env.CAMERA_CATALOGUE_FILE;
const OUT = process.env.OUT_FILE || 'cameras.json';
const CONCURRENCY = 40;
const TIMEOUT = 7000;
const UA = { 'User-Agent': 'Mozilla/5.0 (TrackMeNow camera checker)' };

const get = (u, headers = {}) =>
  fetch(u, {
    headers: { ...UA, ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT)
  });

function normalise(e, i) {
  const p = e?.properties || e || {};
  const coords = e?.geometry?.coordinates;
  const lonFromGeometry = Array.isArray(coords) ? coords[0] : undefined;
  const latFromGeometry = Array.isArray(coords) ? coords[1] : undefined;

  const url = p.stream || p.url || p.src || p.link || p.playlist || p.m3u8 || '';
  let kind = (p.type || p.kind || p.format || '').toLowerCase();

  if (!kind) {
    if (/\.m3u8(\?|$)/i.test(url)) kind = 'hls';
    else if (/youtube\.com|youtu\.be/i.test(url)) kind = 'youtube';
    else kind = 'html';
  }
  if (kind === 'm3u8') kind = 'hls';

  return {
    id: p.id || e?.id || 'cam' + i,
    lat: +(p.lat ?? p.latitude ?? latFromGeometry),
    lon: +(p.lon ?? p.lng ?? p.longitude ?? lonFromGeometry),
    title: p.title || p.name || p.label || 'Camera',
    provider: p.provider || p.source || p.owner || '',
    kind,
    url
  };
}

async function checkHls(url) {
  let cur = url, cors = false, live = true;
  for (let depth = 0; depth < 3; depth++) {
    const r = await get(cur);
    if (!r.ok) return { ok: false };
    if (depth === 0) cors = !!r.headers.get('access-control-allow-origin');

    const text = (await r.text()).slice(0, 200000);
    if (!text.includes('#EXTM3U')) return { ok: false };

    const lines = text.split(/\r?\n/);
    const next = lines.find(l => l && !l.startsWith('#'));
    if (!next) return { ok: false };

    const abs = new URL(next, cur).href;
    if (text.includes('#EXT-X-STREAM-INF')) {
      cur = abs;
      continue;
    }

    live = !text.includes('#EXT-X-ENDLIST');
    const seg = await get(abs, { Range: 'bytes=0-1023' });
    return { ok: seg.ok || seg.status === 206, cors, live };
  }
  return { ok: false };
}

async function checkYoutube(url) {
  const r = await get(
    'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url)
  );
  return { ok: r.ok, cors: true, live: true };
}

async function checkHtml(url) {
  const r = await get(url, { Range: 'bytes=0-0' });
  return { ok: r.status < 400, cors: true, live: true };
}

async function check(c) {
  try {
    if (c.kind === 'hls') return await checkHls(c.url);
    if (c.kind === 'youtube') return await checkYoutube(c.url);
    return await checkHtml(c.url);
  } catch {
    return { ok: false };
  }
}

async function pool(items, worker) {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < items.length) {
        const n = i++;
        await worker(items[n], n);
      }
    })
  );
}

let raw;
if (SRC_FILE) {
  raw = JSON.parse(fs.readFileSync(SRC_FILE, 'utf8'));
} else {
  const response = await get(SRC_URL);
  if (!response.ok) throw new Error('Camera catalogue HTTP ' + response.status + ': ' + SRC_URL);
  raw = await response.json();
}

const entries =
  Array.isArray(raw) ? raw :
  Array.isArray(raw?.features) ? raw.features :
  Array.isArray(raw?.cameras) ? raw.cameras :
  Array.isArray(raw?.items) ? raw.items :
  [];

if (!entries.length) {
  throw new Error('Camera catalogue contains no supported camera entries: ' + SRC_URL);
}

const list = entries
  .map(normalise)
  .filter(c =>
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lon) &&
    /^https?:/i.test(c.url)
  );

if (!list.length) {
  throw new Error('Camera catalogue returned entries, but none had valid coordinates and HTTP(S) stream URLs: ' + SRC_URL);
}

const good = [];
const stats = {
  source: SRC_URL,
  catalogueEntries: entries.length,
  total: list.length,
  ok: 0,
  byKind: {}
};

await pool(list, async c => {
  const res = await check(c);
  stats.byKind[c.kind] ??= { tested: 0, ok: 0 };
  stats.byKind[c.kind].tested++;

  if (res.ok) {
    stats.byKind[c.kind].ok++;
    good.push({
      ...c,
      cors: res.cors,
      live: res.live,
      checked: Math.floor(Date.now() / 1000)
    });
  }
});

stats.ok = good.length;

if (fs.existsSync(OUT) && good.length < list.length * 0.05) {
  console.error('Too few working cameras, keeping previous', OUT, stats);
  process.exit(0);
}

fs.writeFileSync(
  OUT,
  JSON.stringify({ t: Math.floor(Date.now() / 1000), ...stats, cameras: good }, null, 2)
);

console.log(JSON.stringify(stats, null, 2));
