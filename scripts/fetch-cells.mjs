/* Weekly job: downloads the OpenCelliD tower database and boils it down to a coarse density grid
 * (0.25° cells) that is small enough to ship to the browser.  Secret: OPENCELLID_API_KEY.
 *   node scripts/fetch-cells.mjs <outDir>           (CELLS_URL overrides the download URL for tests)
 * cells.json: { generated, src, step, total, a: [[lat, lon, towers, radioMask]] }  (cell centre; mask 1=GSM 2=UMTS 4=LTE 8=NR) */
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
const OUT = process.argv[2] || 'out', STEP = 0.25;
const key = process.env.OPENCELLID_API_KEY;
await mkdir(OUT, { recursive: true });
const fail = async (m) => { await writeFile(`${OUT}/meta.json`, JSON.stringify({ generated: new Date().toISOString(), status: m })); console.error(m); process.exit(m.startsWith('skipped') ? 0 : 1); };
if (!key && !process.env.CELLS_URL) await fail('skipped: OPENCELLID_API_KEY secret not set');
const url = process.env.CELLS_URL || `https://opencellid.org/ocid/downloads?token=${encodeURIComponent(key)}&type=full&file=cell_towers.csv.gz`;
const res = await fetch(url, { headers: { 'User-Agent': 'TrackMeNow-cell-data/1.0' } });
if (!res.ok || !res.body) await fail('download failed: HTTP ' + res.status);
const grid = new Map(), bit = { GSM: 1, UMTS: 2, LTE: 4, NR: 8, CDMA: 1 };
let total = 0;
const rl = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  const c = line.split(',');
  if (c.length < 8 || c[0] === 'radio') continue;
  const lon = +c[6], lat = +c[7];
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
  const k = Math.floor((lat + 90) / STEP) * 100000 + Math.floor((lon + 180) / STEP);
  const g = grid.get(k) || [0, 0]; g[0]++; g[1] |= bit[c[0]] || 0; grid.set(k, g); total++;
}
if (total < 1000) await fail('only ' + total + ' towers parsed - download probably failed (daily limit?)');
const a = [];
for (const [k, [n, m]] of grid) a.push([+((Math.floor(k / 100000) + 0.5) * STEP - 90).toFixed(3), +(((k % 100000) + 0.5) * STEP - 180).toFixed(3), n, m]);
await writeFile(`${OUT}/cells.json`, JSON.stringify({ generated: new Date().toISOString(), src: 'OpenCelliD', step: STEP, total, a }));
await writeFile(`${OUT}/meta.json`, JSON.stringify({ generated: new Date().toISOString(), status: 'ok', total, cells: a.length }));
console.log('ok', total, 'towers', a.length, 'cells');
