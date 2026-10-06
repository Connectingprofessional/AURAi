/* TrackMeNow transport fix (GitHub Pages)
 * Problem: /api/movement worker often returns 0 flights / broken transit.
 * Fix: intercept movement API responses; if empty, fill from live-data branch.
 */
(function () {
  'use strict';
  var LIVE = window.TM_LIVE_DATA_BASE ||
    'https://raw.githubusercontent.com/Connectingprofessional/TrackMenow/live-data';
  var cache = {};
  var cacheAt = 0;

  function rowsToFeatures(kind, payload) {
    var rows = (payload && payload.a) || [];
    var t0 = (payload && payload.t) ? payload.t * 1000 : Date.now();
    var src = (payload && payload.src) || 'GitHub live-data';
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.length < 3) continue;
      var lat, lon, heading, speed, title, extra = {}, category, layer;
      if (kind === 'air') {
        lat = +r[1]; lon = +r[2]; heading = +r[3] || 0; speed = +r[4] || 0;
        title = String(r[6] || r[0] || '').trim() || String(r[0]);
        extra = { icao24: r[0], callsign: r[6], country: r[7], altitude_m: r[5], velocity_mps: speed };
        category = 'flight'; layer = 'flights';
      } else if (kind === 'ships') {
        lat = +r[1]; lon = +r[2]; heading = +r[3] || 0; speed = (+r[4] || 0) * 0.514444;
        title = String(r[5] || r[0] || 'Vessel').trim();
        extra = { mmsi: r[0], name: r[5], sog: r[4], cog: r[3] };
        category = 'ship'; layer = 'ships';
      } else if (kind === 'rail') {
        lat = +r[1]; lon = +r[2]; heading = +r[3] || 0; speed = +r[4] || 0;
        title = String(r[5] || r[0] || 'Train').trim();
        extra = { vehicle_id: r[0], label: r[5], route: r[6], speed_mps: speed };
        category = 'rail'; layer = 'rail';
      } else {
        lat = +r[1]; lon = +r[2]; heading = +r[3] || 0; speed = +r[4] || 0;
        title = String(r[5] || r[0] || 'Vehicle').trim();
        extra = { vehicle_id: r[0], label: r[5], route: r[6], speed_mps: speed };
        category = 'transit'; layer = 'transit';
      }
      if (!isFinite(lat) || !isFinite(lon)) continue;
      out.push({
        type: 'Feature',
        id: String(r[0]) + '-' + i,
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: Object.assign({
          kind: kind, category: category, layer: layer, mode: kind,
          title: title, name: title, h: heading, heading: heading, bearing: heading,
          speed: speed, velocity_mps: speed, speed_mps: speed,
          observedAt: new Date(t0).toISOString(),
          source: src, sourceStatus: 'LIVE', status: 'LIVE', smoothing: 'dead-reckon'
        }, extra)
      });
    }
    return out;
  }

  async function ensureLive(kinds) {
    var now = Date.now();
    if (now - cacheAt < 60000 && Object.keys(cache).length) return cache;
    var files = { air: 'flights.json', ships: 'ships.json', transit: 'transit.json', rail: 'rail.json' };
    var list = kinds && kinds.length ? kinds : Object.keys(files);
    await Promise.all(list.map(async function (k) {
      if (!files[k]) return;
      try {
        var r = await fetch(LIVE + '/' + files[k] + '?t=' + now, { cache: 'no-store' });
        if (!r.ok) return;
        var j = await r.json();
        cache[k] = { features: rowsToFeatures(k, j), src: j.src, t: j.t };
      } catch (e) { console.warn('[TM live-data]', k, e); }
    }));
    cacheAt = now;
    return cache;
  }

  function filterBbox(features, bbox) {
    if (!bbox || bbox.length !== 4) return features;
    var minLon = bbox[0], minLat = bbox[1], maxLon = bbox[2], maxLat = bbox[3];
    var padLon = (maxLon - minLon) * 0.05, padLat = (maxLat - minLat) * 0.05;
    minLon -= padLon; maxLon += padLon; minLat -= padLat; maxLat += padLat;
    return features.filter(function (f) {
      var c = f.geometry && f.geometry.coordinates;
      return c && c[0] >= minLon && c[0] <= maxLon && c[1] >= minLat && c[1] <= maxLat;
    });
  }

  function parseBbox(url) {
    try {
      var u = new URL(url, location.href);
      var b = (u.searchParams.get('bbox') || '').split(',').map(Number);
      if (b.length === 4 && b.every(isFinite)) return b;
    } catch (e) {}
    return null;
  }

  function parseLayers(url) {
    try {
      var u = new URL(url, location.href);
      var layers = (u.searchParams.get('layers') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var map = { flights: 'air', ships: 'ships', transit: 'transit', rail: 'rail' };
      return layers.map(function (l) {
        if (map[l]) return map[l];
        if (l === 'public-transport') return 'transit';
        return l;
      });
    } catch (e) { return ['air', 'ships', 'transit']; }
  }

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isMovement = /\/api\/movement\b/.test(url);
    var p = origFetch.apply(this, arguments);
    if (!isMovement) return p;
    return p.then(async function (res) {
      var clone = res.clone();
      var j = null;
      try { j = await clone.json(); } catch (e) { return res; }
      var feats = (j && j.features) || [];
      if (feats.length >= 5) return res;
      var kinds = parseLayers(url);
      var bbox = parseBbox(url);
      await ensureLive(kinds);
      var merged = [];
      var sources = [];
      kinds.forEach(function (k) {
        var pack = cache[k];
        if (!pack) return;
        var list = filterBbox(pack.features, bbox);
        if (list.length > 4000) list = list.slice(0, 4000);
        merged = merged.concat(list);
        sources.push({
          layer: k === 'air' ? 'flights' : k,
          count: list.length,
          source: pack.src || 'GitHub live-data',
          status: 'live',
          observedAt: new Date().toISOString()
        });
      });
      console.log('[TM fix] movement API sparse (' + feats.length + ') → live-data', merged.length);
      var body = JSON.stringify({
        ok: true,
        type: 'FeatureCollection',
        features: merged.length ? merged : feats,
        sources: sources.length ? sources : (j.sources || []),
        generatedAt: new Date().toISOString(),
        architecture: 'github-live-data-fallback'
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }).catch(function (err) {
      return ensureLive(parseLayers(url)).then(function () {
        var kinds = parseLayers(url);
        var bbox = parseBbox(url);
        var merged = [];
        kinds.forEach(function (k) {
          if (cache[k]) merged = merged.concat(filterBbox(cache[k].features, bbox).slice(0, 4000));
        });
        var body = JSON.stringify({
          ok: true, type: 'FeatureCollection', features: merged,
          sources: [{ source: 'GitHub live-data', status: 'live', count: merged.length }],
          generatedAt: new Date().toISOString(),
          architecture: 'github-live-data-offline'
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    });
  };

  setTimeout(function () { ensureLive(['air', 'ships', 'transit']); }, 2000);
  window.TrackMeNowLoadLiveData = function () { cacheAt = 0; return ensureLive(['air', 'ships', 'transit', 'rail']); };
  console.log('[TM fix] movement API → live-data fallback armed');
})();
