import express from 'express';

const router = express.Router();
const key = (name) => process.env[name] || '';

async function jsonFetch(url, options = {}) {
  const r = await fetch(url, { ...options, headers: { 'User-Agent': 'TrackMeNow/1.0', ...(options.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data && data.error && data.error.message) || data.error || `HTTP ${r.status}`);
  return data;
}

router.get('/ip/my', async (req, res) => {
  const k = key('IPSTACK_API_KEY');
  if (!k) return res.status(503).json({ error: 'IPSTACK_API_KEY is not configured' });
  try {
    res.json(await jsonFetch('https://api.ipstack.com/check?' + new URLSearchParams({ access_key: k }).toString()));
  } catch (e) { res.status(502).json({ error: 'IPstack lookup failed', detail: e.message }); }
});

router.get('/ip/lookup', async (req, res) => {
  const ip = String(req.query.ip || '').trim();
  const k = key('IPSTACK_API_KEY');
  if (!k) return res.status(503).json({ error: 'IPSTACK_API_KEY is not configured' });
  if (!ip) return res.status(400).json({ error: 'ip is required' });
  try {
    res.json(await jsonFetch('https://api.ipstack.com/' + encodeURIComponent(ip) + '?' + new URLSearchParams({ access_key: k }).toString()));
  } catch (e) { res.status(502).json({ error: 'IPstack lookup failed', detail: e.message }); }
});

router.get('/flight/search', async (req, res) => {
  const q = String(req.query.flight || req.query.callsign || '').trim();
  const k = key('AVIATIONSTACK_API_KEY');
  if (!k) return res.status(503).json({ error: 'AVIATIONSTACK_API_KEY is not configured' });
  if (!q) return res.status(400).json({ error: 'flight is required' });
  try {
    const data = await jsonFetch('https://api.aviationstack.com/v1/flights?' + new URLSearchParams({ access_key: k, flight_iata: q }).toString());
    res.json(data);
  } catch (e) { res.status(502).json({ error: 'Aviationstack lookup failed', detail: e.message }); }
});

router.get('/country/name', async (req, res) => {
  const q = String(req.query.name || '').trim();
  const k = key('COUNTRYLAYER_API_KEY');
  if (!k) return res.status(503).json({ error: 'COUNTRYLAYER_API_KEY is not configured' });
  if (!q) return res.status(400).json({ error: 'name is required' });
  try {
    const data = await jsonFetch('https://api.countrylayer.com/v2/name/' + encodeURIComponent(q) + '?' + new URLSearchParams({ access_key: k }).toString());
    res.json(data);
  } catch (e) { res.status(502).json({ error: 'Countrylayer lookup failed', detail: e.message }); }
});

router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const k = key('POSITIONSTACK_API_KEY');
  if (!k) return res.status(503).json({ error: 'POSITIONSTACK_API_KEY is not configured' });
  if (!q) return res.status(400).json({ error: 'q is required' });
  try {
    const data = await jsonFetch('https://api.positionstack.com/v1/forward?' + new URLSearchParams({ access_key: k, query: q, limit: '5' }).toString());
    res.json(data);
  } catch (e) { res.status(502).json({ error: 'Positionstack geocoding failed', detail: e.message }); }
});

router.get('/reverse', async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon), k = key('POSITIONSTACK_API_KEY');
  if (!k) return res.status(503).json({ error: 'POSITIONSTACK_API_KEY is not configured' });
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat and lon are required' });
  try {
    const data = await jsonFetch('https://api.positionstack.com/v1/reverse?' + new URLSearchParams({ access_key: k, query: lat + ',' + lon }).toString());
    res.json(data);
  } catch (e) { res.status(502).json({ error: 'Positionstack reverse geocoding failed', detail: e.message }); }
});

router.get('/status', (req, res) => {
  res.json({
    ipstack: !!key('IPSTACK_API_KEY'),
    aviationstack: !!key('AVIATIONSTACK_API_KEY'),
    countrylayer: !!key('COUNTRYLAYER_API_KEY'),
    positionstack: !!key('POSITIONSTACK_API_KEY')
  });
});

export default router;
