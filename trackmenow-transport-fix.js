/* TrackMeNow transport fix — forces GitHub live-data when movement API is empty */
(function () {
  'use strict';
  var LIVE = window.TM_LIVE_DATA_BASE ||
    'https://raw.githubusercontent.com/Connectingprofessional/TrackMenow/live-data';

  function rowsToFeatures(kind, payload) {
    var rows = (payload && payload.a) || [];
    var t0 = (payload && payload.t) ? payload.t * 1000 : Date.now();
    var src = (payload && payload.src) || 'GitHub live-data';
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.length < 3) continue;
      var lat, lon, heading, speed, title, extra = {}, category;
      if (kind === 'air') {
        lat = +r[1]; lon = +r[2]; heading = +r[3] || 0; speed = +r[4] || 0;
        title = String(r[6] || r[0] || '').trim() || String(r[0]);
        extra = { icao24: r[0], callsign: r[6], country: r[7], altitude_m: r[5], velocity_mps: speed };
        category = 'flight';
      } else if (kind === 'ships') {
        lat = +r[1]; lon = +r[2]; heading = +r[3] || 0; speed = (+r[4] || 0) * 0.514444;
        title = String(r[5] || r[0] || 'Vessel').trim();
        extra = { mmsi: r[0], name: r[5], sog: r[4], cog: r[3] };
        category = 'ship';
      } else {
        lat = +r[1]; lon = +r[2]; heading = +r[3] || 0; speed = +r[4] || 0;
        title = String(r[5] || r[0] || 'Vehicle').trim();
        extra = { vehicle_id: r[0], label: r[5], route: r[6], speed_mps: speed };
        category = kind;
      }
      if (!isFinite(lat) || !isFinite(lon)) continue;
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: Object.assign({
          i: out.length, kind: kind, category: category, layer: kind,
          title: title, name: title, h: heading, heading: heading,
          speed: speed, velocity_mps: speed,
          observedAt: new Date(t0).toISOString(),
          source: src, sourceStatus: 'LIVE', smoothing: 'dead-reckon'
        }, extra)
      });
    }
    return out;
  }

  function findMap() {
    var nodes = document.querySelectorAll('.maplibregl-canvas');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i].parentElement;
      while (el) {
        if (el._map) return el._map;
        el = el.parentElement;
      }
    }
    return null;
  }

  async function loadKinds(kinds) {
    var map = findMap();
    if (!map) {
      console.warn('[TM fix] map not ready');
      return;
    }
    var files = { air: 'flights.json', ships: 'ships.json', transit: 'transit.json', rail: 'rail.json' };
    var colors = { air: '#58c8ff', ships: '#43e0a0', transit: '#ffb347', rail: '#b794f6' };
    var receivedAt = Date.now();
    window.__TM_LIVE = window.__TM_LIVE || {};
    for (var i = 0; i < kinds.length; i++) {
      var k = kinds[i];
      if (!files[k]) continue;
      try {
        var r = await fetch(LIVE + '/' + files[k] + '?t=' + receivedAt, { cache: 'no-store' });
        if (!r.ok) continue;
        var j = await r.json();
        var features = rowsToFeatures(k, j);
        var srcId = 'tp-' + k;
        if (!map.getSource(srcId)) {
          map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer(srcId)) {
          map.addLayer({
            id: srcId,
            type: 'circle',
            source: srcId,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2, 8, 5, 12, 7],
              'circle-color': colors[k],
              'circle-stroke-width': 1,
              'circle-stroke-color': '#071018',
              'circle-opacity': 0.9
            }
          });
        }
        window.__TM_LIVE[k] = { features: features, t: j.t || receivedAt / 1000 };
        map.getSource(srcId).setData({ type: 'FeatureCollection', features: features });
        map.setLayoutProperty(srcId, 'visibility', 'visible');
        console.log('[TM fix] live-data', k, features.length);
        var st = document.getElementById('status');
        if (st) st.innerHTML = '<span style="color:#43e0a0">●</span> ' + k.toUpperCase() + ' · ' + features.length.toLocaleString() + ' · GitHub live-data';
      } catch (e) {
        console.warn('[TM fix]', k, e);
      }
    }
    if (!window.__TM_DR) {
      window.__TM_DR = setInterval(function () {
        var store = window.__TM_LIVE;
        var m = findMap();
        if (!store || !m) return;
        Object.keys(store).forEach(function (k) {
          var src = m.getSource('tp-' + k);
          if (!src || !store[k] || !store[k].features) return;
          var now = Date.now();
          var feats = store[k].features.map(function (f) {
            var p = f.properties || {};
            var lon = f.geometry.coordinates[0], lat = f.geometry.coordinates[1];
            var h = Number(p.h || p.heading || 0) || 0;
            var spd = Number(p.speed || p.velocity_mps || 0) || 0;
            var obs = p.observedAt ? Date.parse(p.observedAt) : 0;
            var age = obs ? Math.max(0, (now - obs) / 1000) : 0;
            if (spd > 0.5 && age > 0 && age < 720) {
              var rad = h * Math.PI / 180, dist = spd * age;
              lat += (dist * Math.cos(rad)) / 111320;
              lon += (dist * Math.sin(rad)) / (111320 * Math.cos(lat * Math.PI / 180) || 1);
            }
            return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: p };
          });
          try { src.setData({ type: 'FeatureCollection', features: feats }); } catch (e) {}
        });
      }, 250);
    }
  }

  function wire() {
    document.querySelectorAll('[data-bar="air"],[data-bar="ships"],[data-bar="transit"],[data-bar="rail"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.getAttribute('data-bar');
        setTimeout(function () { loadKinds([k]); }, 1200);
      }, true);
    });
    window.TrackMeNowLoadLiveData = function (kinds) {
      return loadKinds(kinds || ['air', 'ships', 'transit']);
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
