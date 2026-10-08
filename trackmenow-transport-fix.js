/* TrackMeNow transport fix v7
 * Default: Air + Ships + Transit + Rail ON together (not exclusive wipe)
 * Bottom bar / panel: toggle layers (stack). SHOW ALL restores full set.
 * Sparse /api/movement → GitHub live-data branch.
 */
(function () {
  'use strict';
  var LIVE = window.TM_LIVE_DATA_BASE ||
    'https://raw.githubusercontent.com/Connectingprofessional/TrackMenow/live-data';
  var cache = {};
  var cacheAt = 0;
  var DEFAULT_ON = { air: true, ships: true, transit: true, rail: true, taxi: false, car: false, bike: false };

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
          source: src, sourceStatus: 'LAST_PUBLISHED', status: 'LAST_PUBLISHED'
        }, extra)
      });
    }
    return out;
  }

  async function ensureLive(kinds) {
    var now = Date.now();
    if (now - cacheAt < 45000 && Object.keys(cache).length) return cache;
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
    var padLon = Math.max(0.5, (maxLon - minLon) * 0.05);
    var padLat = Math.max(0.5, (maxLat - minLat) * 0.05);
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
      if (!layers.length) return ['air', 'ships', 'transit', 'rail'];
      var map = { flights: 'air', ships: 'ships', transit: 'transit', rail: 'rail' };
      return layers.map(function (l) {
        if (map[l]) return map[l];
        if (l === 'public-transport') return 'transit';
        return l;
      });
    } catch (e) { return ['air', 'ships', 'transit', 'rail']; }
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
      var kinds = parseLayers(url).filter(function (k) {
        return k === 'air' || k === 'ships' || k === 'transit' || k === 'rail';
      });
      if (!kinds.length) kinds = ['air', 'ships', 'transit', 'rail'];
      var needFill = feats.length < 20;
      if (!needFill) {
        var hasAir = feats.some(function (f) {
          var p = f.properties || {};
          return p.kind === 'air' || p.category === 'flight' || p.layer === 'flights';
        });
        if (kinds.indexOf('air') >= 0 && !hasAir) needFill = true;
      }
      if (!needFill) return res;
      var bbox = parseBbox(url);
      await ensureLive(kinds);
      var merged = [];
      var sources = [];
      kinds.forEach(function (k) {
        var pack = cache[k];
        if (!pack) return;
        var list = filterBbox(pack.features, bbox);
        if (list.length > 6000) list = list.slice(0, 6000);
        merged = merged.concat(list);
        sources.push({
          layer: k === 'air' ? 'flights' : k,
          count: list.length,
          source: pack.src || 'GitHub live-data',
          status: 'last-published',
          observedAt: new Date(t0).toISOString()
        });
      });
      console.log('[TM] movement fill', kinds.join(','), '\u2192', merged.length);
      return new Response(JSON.stringify({
        ok: true,
        type: 'FeatureCollection',
        features: merged.length ? merged : feats,
        sources: sources.length ? sources : (j.sources || []),
        generatedAt: new Date().toISOString(),
        architecture: 'github-live-data-fallback'
      }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }).catch(function () {
      return ensureLive(['air', 'ships', 'transit', 'rail']).then(function () {
        var kinds = parseLayers(url);
        var bbox = parseBbox(url);
        var merged = [];
        kinds.forEach(function (k) {
          if (cache[k]) merged = merged.concat(filterBbox(cache[k].features, bbox).slice(0, 6000));
        });
        return new Response(JSON.stringify({
          ok: true, type: 'FeatureCollection', features: merged,
          sources: [{ source: 'GitHub live-data snapshot', status: merged.length > 0 ? 'last-published' : 'empty', count: merged.length }],
          generatedAt: new Date().toISOString(),
          architecture: 'github-live-data-offline'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    });
  };

  function setLayers(eng, target) {
    ['air', 'ships', 'transit', 'rail', 'taxi', 'car', 'bike'].forEach(function (k) {
      var want = !!target[k];
      var isOn = false;
      try { isOn = !!eng.transportOn(k); } catch (e) {}
      if (want !== isOn && typeof eng.toggleTransport === 'function') {
        eng.toggleTransport(k);
      }
    });
  }

  function patchEngine() {
    var eng = window.TrackMeNowEngine;
    if (!eng || eng.__tmStackPatch) return !!eng;
    eng.__tmStackPatch = true;

    eng.activateTransport = function (kind) {
      if (typeof eng.toggleTransport !== 'function') return false;
      if (!eng.transportOn(kind)) eng.toggleTransport(kind);
      return true;
    };

    eng.showAllTransport = function () {
      setLayers(eng, DEFAULT_ON);
      return true;
    };

    setTimeout(function () {
      try { setLayers(eng, DEFAULT_ON); } catch (e) {}
    }, 1500);
    setTimeout(function () {
      try { setLayers(eng, DEFAULT_ON); } catch (e) {}
    }, 4000);

    console.log('[TM] Air+Ships+Transit+Rail stacked by default');
    return true;
  }

  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (patchEngine() || tries > 100) clearInterval(iv);
  }, 200);

  ensureLive(['air', 'ships', 'transit', 'rail']);

  window.TrackMeNowLoadLiveData = function () {
    cacheAt = 0;
    return ensureLive(['air', 'ships', 'transit', 'rail']);
  };
  window.TrackMeNowShowAll = function () {
    var eng = window.TrackMeNowEngine;
    if (eng) setLayers(eng, DEFAULT_ON);
  };
  console.log('[TM] v7 stacked transport + live-data armed');
})();
