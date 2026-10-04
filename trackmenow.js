/* TrackMeNow — 3D Geospatial Engine (High-Precision Planetary Visualization)
 * MapLibre GL WebGL · Globe / Satellite / Dark Digital
 * Orbital (z≈0.5) → terrain → building scale (z≈19)
 */
(function () {
  'use strict';

  const API = (typeof location !== 'undefined' && location.origin && !String(location.origin).startsWith('file:'))
    ? location.origin : '';
  const $ = (id) => document.getElementById(id);

  function setStatus(msg, ok) {
    const el = $('status');
    if (!el) return;
    const color = ok === false ? '#ff6672' : '#43e0a0';
    el.innerHTML = '<span style="color:' + color + '">●</span> ' + msg;
  }

  function closeSplash() {
    const s = $('splash');
    if (s) {
      s.classList.add('open');
      s.style.opacity = '0';
      s.style.pointerEvents = 'none';
      setTimeout(function () { try { s.remove(); } catch (e) {} }, 800);
    }
  }

  if (!window.maplibregl) {
    setStatus('MAP ENGINE MISSING — maplibre-gl.js failed to load', false);
    closeSplash();
    return;
  }

  const STYLE = {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      satellite: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: '© Esri'
      },
      dark: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
        attribution: '© Esri'
      },
      labels: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        attribution: '© Esri'
      },
      terrain: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15
      },
      flights: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#02050b' } },
      { id: 'base-satellite', type: 'raster', source: 'satellite', paint: { 'raster-opacity': 1 } },
      { id: 'base-dark', type: 'raster', source: 'dark', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.98 } },
      { id: 'base-labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
      {
        id: 'flights-dot',
        type: 'circle',
        source: 'flights',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 8, 4, 14, 6],
          'circle-color': '#4fd0ff',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#031018',
          'circle-opacity': 0.95
        }
      }
    ],
    sky: {
      'sky-color': '#0a1a28',
      'horizon-color': '#1a3040',
      'fog-color': '#050810'
    }
  };

  var map;
  try {
    map = new maplibregl.Map({
      container: 'map',
      style: STYLE,
      center: [15, 20],
      zoom: 1.6,
      minZoom: 0.4,
      maxZoom: 19,
      pitch: 0,
      maxPitch: 85,
      attributionControl: false,
      renderWorldCopies: false,
      canvasContextAttributes: { antialias: true }
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  } catch (err) {
    setStatus('WEBGL INIT FAILED · ' + (err && err.message ? err.message : err), false);
    closeSplash();
    return;
  }

  window.map = map;
  window.TrackMeNowEngine = { name: 'TrackMeNow 3D Geospatial Engine', mode: 'planetary', version: '1.0.0' };

  var currentView = 'globe';
  try { currentView = localStorage.getItem('tm-view') || 'globe'; } catch (e) {}

  function setBase(mode) {
    var sat = mode === 'satellite' || mode === 'globe';
    var dark = mode === 'dark';
    try {
      if (map.getLayer('base-satellite')) {
        map.setLayoutProperty('base-satellite', 'visibility', sat ? 'visible' : 'none');
        map.setPaintProperty('base-satellite', 'raster-opacity', mode === 'globe' ? 0.92 : 1);
      }
      if (map.getLayer('base-dark')) map.setLayoutProperty('base-dark', 'visibility', dark ? 'visible' : 'none');
      if (map.getLayer('base-labels')) map.setLayoutProperty('base-labels', 'visibility', 'visible');
    } catch (e) {}
  }

  function enableTerrain(on) {
    try {
      if (on && map.getSource('terrain')) map.setTerrain({ source: 'terrain', exaggeration: 1.35 });
      else map.setTerrain(null);
    } catch (e) {}
  }

  function applyView(id, reset) {
    var views = {
      globe: { projection: 'globe', pitch: 0, zoom: 1.5, terrain: false },
      satellite: { projection: 'mercator', pitch: 45, zoom: 3, terrain: true },
      dark: { projection: 'mercator', pitch: 0, zoom: 2.2, terrain: false }
    };
    var v = views[id] || views.globe;
    currentView = id;
    try { localStorage.setItem('tm-view', id); } catch (e) {}
    try {
      if (typeof map.setProjection === 'function') map.setProjection({ type: v.projection });
      setBase(id);
      enableTerrain(!!v.terrain);
      if (typeof map.setFog === 'function') {
        if (id === 'globe') {
          map.setFog({ color: '#08131a', 'high-color': '#0a2230', 'space-color': '#010308', 'horizon-blend': 0.18, range: [0.5, 12] });
        } else if (id === 'satellite') {
          map.setFog({ color: '#a0c0d8', 'high-color': '#c8e0f0', 'space-color': '#87a0b8', 'horizon-blend': 0.08, range: [0.8, 8] });
        } else map.setFog(null);
      }
      if (reset) map.easeTo({ pitch: v.pitch, zoom: Math.min(map.getZoom(), v.zoom + 2), bearing: 0, duration: 900 });
    } catch (e) { console.warn('[TrackMeNow] view', e); }
    document.querySelectorAll('[data-tm-view]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-tm-view') === id);
    });
    setStatus('3D ENGINE · ' + id.toUpperCase() + ' · Z' + map.getZoom().toFixed(1), true);
    return id;
  }

  function wireButtons() {
    var g = $('argos-globe'), s = $('argos-sat'), m = $('argos-map');
    if (g) { g.setAttribute('data-tm-view', 'globe'); g.onclick = function () { applyView('globe', true); }; }
    if (s) { s.setAttribute('data-tm-view', 'satellite'); s.onclick = function () { applyView('satellite', true); }; }
    if (m) { m.setAttribute('data-tm-view', 'dark'); m.onclick = function () { applyView('dark', true); }; }
    if (!g && !s && !m) {
      var bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;z-index:2000;top:60px;right:14px;display:flex;flex-direction:column;gap:6px;';
      ['globe', 'satellite', 'dark'].forEach(function (id) {
        var b = document.createElement('button');
        b.textContent = id === 'globe' ? '3D Globe' : id === 'satellite' ? 'Satellite 3D' : 'Dark Digital';
        b.setAttribute('data-tm-view', id);
        b.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(8,14,20,.9);color:#e8f4fa;cursor:pointer;font:700 11px system-ui;';
        b.onclick = function () { applyView(id, true); };
        bar.appendChild(b);
      });
      document.body.appendChild(bar);
    }
    applyView(currentView, false);
  }

  map.on('load', function () {
    closeSplash();
    wireButtons();
    setStatus('3D GEOSPATIAL ENGINE ONLINE · PLANETARY MODE', true);
    loadFlights();
  });

  map.on('error', function (e) { console.warn('[TrackMeNow map error]', e && e.error); });

  map.on('moveend', function () {
    var c = map.getCenter();
    var el = $('coords');
    if (el) el.textContent = 'Z' + map.getZoom().toFixed(1) + ' · ' + c.lat.toFixed(4) + ', ' + c.lng.toFixed(4);
  });

  async function loadFlights() {
    try {
      var b = map.getBounds();
      var url = 'https://opensky-network.org/api/states/all?lamin=' + b.getSouth() + '&lomin=' + b.getWest() + '&lamax=' + b.getNorth() + '&lomax=' + b.getEast();
      if (API && API.indexOf('github.io') === -1) {
        var r0 = await fetch(API + '/api/global/movement?bbox=' + encodeURIComponent([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',')) + '&layers=flights');
        if (r0.ok) {
          var data = await r0.json();
          if (map.getSource('flights')) map.getSource('flights').setData({ type: 'FeatureCollection', features: (data.features || []).filter(function (f) { return f.geometry && f.geometry.type === 'Point'; }) });
          return;
        }
      }
      var r = await fetch(url);
      if (!r.ok) return;
      var j = await r.json();
      var features = (j.states || []).filter(function (s) { return Number.isFinite(s[5]) && Number.isFinite(s[6]); }).map(function (s) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [s[5], s[6]] }, properties: { callsign: (s[1] || '').trim(), icao24: s[0] } };
      });
      if (map.getSource('flights')) {
        map.getSource('flights').setData({ type: 'FeatureCollection', features: features });
        setStatus('3D ENGINE · ' + features.length + ' AIRCRAFT · ' + currentView.toUpperCase(), true);
      }
    } catch (e) {}
  }

  map.on('moveend', function () { clearTimeout(window.__tmF); window.__tmF = setTimeout(loadFlights, 700); });
  setInterval(loadFlights, 45000);

  var gpsBtn = $('gpsBtn');
  if (gpsBtn) {
    var watchId = null, marker = null;
    gpsBtn.onclick = function () {
      if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; gpsBtn.textContent = '◎ GPS'; return; }
      if (!navigator.geolocation) return alert('GPS unavailable');
      watchId = navigator.geolocation.watchPosition(function (p) {
        var ll = [p.coords.longitude, p.coords.latitude];
        if (!marker) marker = new maplibregl.Marker({ color: '#43e0a0' }).setLngLat(ll).addTo(map);
        else marker.setLngLat(ll);
        map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), 14), pitch: 55, duration: 700 });
        setStatus('GPS LIVE ±' + Math.round(p.coords.accuracy) + 'm', true);
      }, function (e) { setStatus('GPS · ' + e.message, false); }, { enableHighAccuracy: true });
      gpsBtn.textContent = 'Stop GPS';
    };
  }

  var search = $('search'), searchBtn = $('searchBtn');
  function doSearch() {
    var q = (search && search.value || '').trim();
    if (!q) return;
    var coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coord) { map.flyTo({ center: [+coord[2], +coord[1]], zoom: 12, pitch: 50, duration: 1200 }); return; }
    fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d[0]) throw new Error('Not found');
        map.flyTo({ center: [+d[0].lon, +d[0].lat], zoom: 11, pitch: 45, duration: 1400 });
      }).catch(function (e) { alert(e.message || 'Search failed'); });
  }
  if (searchBtn) searchBtn.onclick = doSearch;
  if (search) search.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });

  setTimeout(closeSplash, 4000);
  setStatus('STARTING 3D GEOSPATIAL ENGINE…', true);
})();
