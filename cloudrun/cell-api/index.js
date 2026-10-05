import http from 'node:http';

const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGIN = 'https://connectingprofessional.github.io';
const VALID_RADIOS = new Set(['GSM','UMTS','LTE','NBIOT','NR','CDMA']);

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function corsHeaders(origin) {
  if (origin === ALLOWED_ORIGIN) return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Vary': 'Origin'
  };
  return {};
}

async function lookupCell(url) {
  const key = process.env.OPENCELLID_API_KEY;
  if (!key) return { status: 503, body: { error: 'OpenCelliD API is not configured on the server' } };

  const required = ['mcc','mnc','lac','cellid'];
  const values = Object.fromEntries(required.map(k => [k, Number(url.searchParams.get(k))]));
  if (!required.every(k => Number.isInteger(values[k]))) {
    return { status: 400, body: { error: 'mcc,mnc,lac,cellid are required integers' } };
  }

  const radio = String(url.searchParams.get('radio') || '').trim().toUpperCase();
  const p = new URLSearchParams({
    key,
    mcc: String(values.mcc),
    mnc: String(values.mnc),
    lac: String(values.lac),
    cellid: String(values.cellid),
    format: 'json'
  });
  if (VALID_RADIOS.has(radio)) p.set('radio', radio);

  try {
    const upstream = await fetch('https://opencellid.org/cell/get?' + p.toString(), {
      headers: { 'User-Agent': 'TrackMeNow/1.0' }
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return { status: upstream.status, body: { error: 'OpenCelliD request failed', upstreamStatus: upstream.status } };
    }
    if (!data || data.stat === 'fail' || !Number.isFinite(Number(data.lat)) || !Number.isFinite(Number(data.lon))) {
      return { status: 404, body: data || { error: 'cell not found' } };
    }
    return {
      status: 200,
      body: data,
      cache: 'public, max-age=300'
    };
  } catch {
    return { status: 502, body: { error: 'OpenCelliD lookup failed' } };
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    if (origin && origin !== ALLOWED_ORIGIN) return json(res, 403, { error: 'origin not allowed' });
    res.writeHead(204, {
      ...cors,
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    });
    return res.end();
  }

  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'trackmenow-cell-api', provider: 'OpenCelliD' }, cors);
  }

  if (req.method === 'GET' && url.pathname === '/api/cell') {
    const result = await lookupCell(url);
    return json(res, result.status, result.body, {
      ...cors,
      ...(result.cache ? { 'Cache-Control': result.cache } : {})
    });
  }

  return json(res, 404, { error: 'not found' }, cors);
});

server.listen(PORT, () => {
  console.log('TrackMeNow cell API listening on port ' + PORT);
});
