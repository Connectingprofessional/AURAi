// scripts/build-cameras.mjs
// Reads the raw camera catalogue, tests every stream, writes cameras.json with only working cameras.
// Env: CAMERA_CATALOGUE_URL or CAMERA_CATALOGUE_FILE, OUT_FILE (default cameras.json)

import fs from 'node:fs';

const SRC_URL = process.env.CAMERA_CATALOGUE_URL;
const SRC_FILE = process.env.CAMERA_CATALOGUE_FILE;
const OUT = process.env.OUT_FILE || 'cameras.json';
const CONCURRENCY = 40;
const TIMEOUT = 7000;
const UA = { 'User-Agent': 'Mozilla/5.0 (TrackMeNow camera checker)' };

const get = (u, headers = {}) =>
 fetch(u, { headers: { ...UA, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });

function normalise(e, i) {
 const url = e.stream || e.url || e.src || e.link || '';
 let kind = (e.type || e.kind || '').toLowerCase();
 if (!kind) kind = /\.m3u8(\?|$)/i.test(url) ? 'hls' : /youtube\.com|youtu\.be/i.test(url) ? 'youtube' : 'html';
 if (kind === 'm3u8') kind = 'hls';
 return { id:e.id||'cam'+i, lat:+(e.lat??e.latitude), lon:+(e.lon??e.lng??e.longitude), title:e.title||e.name||'Camera', provider:e.provider||e.source||'', kind, url };
}
async function checkHls(url) {
 let cur=url,cors=false,live=true;
 for(let depth=0;depth<3;depth++){
  const r=await get(cur); if(!r.ok)return{ok:false};
  if(depth===0)cors=!!r.headers.get('access-control-allow-origin');
  const text=(await r.text()).slice(0,200000); if(!text.includes('#EXTM3U'))return{ok:false};
  const lines=text.split(/\r?\n/),next=lines.find(l=>l&&!l.startsWith('#')); if(!next)return{ok:false};
  const abs=new URL(next,cur).href;
  if(text.includes('#EXT-X-STREAM-INF')){cur=abs;continue}
  live=!text.includes('#EXT-X-ENDLIST');
  const seg=await get(abs,{Range:'bytes=0-1023'}); return{ok:seg.ok||seg.status===206,cors,live};
 }
 return{ok:false};
}
async function checkYoutube(url){const r=await get('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent(url));return{ok:r.ok,cors:true,live:true}}
async function checkHtml(url){const r=await get(url,{Range:'bytes=0-0'});return{ok:r.status<400,cors:true,live:true}}
async function check(c){try{if(c.kind==='hls')return await checkHls(c.url);if(c.kind==='youtube')return await checkYoutube(c.url);return await checkHtml(c.url)}catch{return{ok:false}}}
async function pool(items,worker){let i=0;await Promise.all(Array.from({length:CONCURRENCY},async()=>{while(i<items.length){const n=i++;await worker(items[n],n)}}))}
let raw;
if(SRC_FILE)raw=JSON.parse(fs.readFileSync(SRC_FILE,'utf8'));
else if(SRC_URL)raw=await(await get(SRC_URL)).json();
else throw new Error('Set CAMERA_CATALOGUE_URL or CAMERA_CATALOGUE_FILE');
const list=(Array.isArray(raw)?raw:raw.cameras||raw.items||[]).map(normalise).filter(c=>isFinite(c.lat)&&isFinite(c.lon)&&/^https?:/.test(c.url));
const good=[],stats={total:list.length,ok:0,byKind:{}};
await pool(list,async c=>{const res=await check(c);stats.byKind[c.kind]??={tested:0,ok:0};stats.byKind[c.kind].tested++;if(res.ok){stats.byKind[c.kind].ok++;good.push({...c,cors:res.cors,live:res.live,checked:Math.floor(Date.now()/1000)})}});
stats.ok=good.length;
if(fs.existsSync(OUT)&&good.length<list.length*0.05){console.error('Too few working cameras, keeping previous',OUT,stats);process.exit(0)}
fs.writeFileSync(OUT,JSON.stringify({t:Math.floor(Date.now()/1000),...stats,cameras:good}));
console.log(JSON.stringify(stats,null,2));