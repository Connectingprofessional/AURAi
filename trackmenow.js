/* TrackMeNow — 3D Geospatial Engine (OpenGlobus planetary + MapLibre fallback)
 * Precision from planet scale to street level. Apache-2.0 OpenGlobus @ 0.28.7
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const OG_VER = '0.28.7';
  const OG_JS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.es.js';
  const OG_CSS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.css';

  function setStatus(msg, ok) {
    const el = $('status');
    if (!el) return;
    el.innerHTML = '<span style="color:' + (ok === false ? '#ff6672' : '#43e0a0') + '">●</span> ' + msg;
  }

  function closeSplash() {
    const s = $('splash');
    if (!s) return;
    s.classList.add('open');
    s.style.opacity = '0';
    s.style.pointerEvents = 'none';
    setTimeout(function () { try { s.remove(); } catch (e) {} }, 700);
  }

  function ensureCss(href) {
    if (document.querySelector('link[data-og-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.setAttribute('data-og-css', '1');
    document.head.appendChild(l);
  }

  function wireViewButtons(api) {
    const g = $('argos-globe');
    const s = $('argos-sat');
    const m = $('argos-map');
    if (g) { g.setAttribute('data-tm-view', 'globe'); g.onclick = function () { api.setView('globe'); }; }
    if (s) { s.setAttribute('data-tm-view', 'satellite'); s.onclick = function () { api.setView('satellite'); }; }
    if (m) { m.setAttribute('data-tm-view', 'dark'); m.onclick = function () { api.setView('dark'); }; }
    if (!g && !s && !m) {
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;z-index:2000;top:58px;right:12px;display:flex;flex-direction:column;gap:6px;';
      [['globe', '3D Globe'], ['satellite', 'Satellite'], ['dark', 'Dark Digital']].forEach(function (pair) {
        const b = document.createElement('button');
        b.textContent = pair[1];
        b.setAttribute('data-tm-view', pair[0]);
        b.style.cssText = 'padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui;';
        b.onclick = function () { api.setView(pair[0]); };
        bar.appendChild(b);
      });
      document.body.appendChild(bar);
    }
  }

  function markActive(id) {
    document.querySelectorAll('[data-tm-view]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-tm-view') === id);
    });
  }

  async function startOpenGlobus() {
    ensureCss(OG_CSS);
    const og = await import(/* webpackIgnore: true */ OG_JS);

    const Globe = og.Globe;
    const XYZ = og.XYZ;
    const Bing = og.Bing;
    const OpenStreetMap = og.OpenStreetMap;
    const GlobusTerrain = og.GlobusTerrain;
    const GlobusRgbTerrain = og.GlobusRgbTerrain;
    const EmptyTerrain = og.EmptyTerrain;
    const control = og.control;
    const LonLat = og.LonLat;

    const target = $('map');
    if (!target) throw new Error('#map container missing');
    target.innerHTML = '';

    const sat = new XYZ('Satellite', {
      isBaseLayer: true,
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      visibility: true,
      attribution: 'Esri World Imagery'
    });

    const dark = new XYZ('Dark Digital', {
      isBaseLayer: true,
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      visibility: false,
      attribution: 'Esri Dark Gray'
    });

    let osm = null;
    try {
      osm = new OpenStreetMap('OSM', { visibility: false, isBaseLayer: true });
    } catch (e) {
      osm = new XYZ('OSM', {
        isBaseLayer: true,
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        visibility: false,
        attribution: '© OpenStreetMap'
      });
    }

    let bing = null;
    try { bing = new Bing('Bing', { visibility: false, isBaseLayer: true }); } catch (e) {}

    const layers = [sat, dark, osm].concat(bing ? [bing] : []);

    let terrain;
    try { terrain = new GlobusTerrain(); }
    catch (e) {
      try { terrain = new GlobusRgbTerrain(); }
      catch (e2) { terrain = new EmptyTerrain(); }
    }

    const globe = new Globe({
      target: target,
      name: 'TrackMeNow Earth',
      terrain: terrain,
      layers: layers,
      atmosphereEnabled: true,
      maxGridSize: 128,
      autoActivate: true
    });

    window.globe = globe;
    window.map = null;

    try { if (control && control.LayerSwitcher) globe.planet.addControl(new control.LayerSwitcher()); } catch (e) {}
    try { if (control && control.ZoomControl) globe.planet.addControl(new control.ZoomControl()); } catch (e) {}

    try {
      if (LonLat && globe.planet && globe.planet.camera) {
        if (globe.planet.camera.flyLonLat) globe.planet.camera.flyLonLat(new LonLat(20, 25, 12000000));
        else if (globe.planet.camera.setLonLat) globe.planet.camera.setLonLat(new LonLat(20, 25, 12000000));
      }
    } catch (e) {}

    let current = 'globe';
    try { current = localStorage.getItem('tm-view') || 'globe'; } catch (e) {}

    const api = {
      engine: 'openglobus',
      globe: globe,
      setView: function (id) {
        current = id;
        try { localStorage.setItem('tm-view', id); } catch (e) {}
        try {
          layers.forEach(function (ly) {
            if (ly && typeof ly.setVisibility === 'function') ly.setVisibility(false);
          });
          if (id === 'dark') { if (dark) dark.setVisibility(true); }
          else { if (sat) sat.setVisibility(true); }
          const cam = globe.planet && globe.planet.camera;
          if (cam && LonLat) {
            const alt = id === 'globe' ? 14000000 : id === 'satellite' ? 2500000 : 4000000;
            let lon = 20, lat = 25;
            try {
              if (cam.getLonLat) { const ll = cam.getLonLat(); lon = ll.lon; lat = ll.lat; }
            } catch (e) {}
            try {
              if (cam.flyLonLat) cam.flyLonLat(new LonLat(lon, lat, alt));
              else if (cam.setLonLat) cam.setLonLat(new LonLat(lon, lat, alt));
            } catch (e) {}
          }
        } catch (e) { console.warn('[TrackMeNow] view', e); }
        markActive(id);
        setStatus('3D GEOSPATIAL ENGINE ONLINE · PLANETARY MODE · ' + id.toUpperCase(), true);
      }
    };

    window.TrackMeNowEngine = {
      name: 'TrackMeNow 3D Geospatial Engine',
      mode: 'planetary',
      backend: 'openglobus',
      version: OG_VER
    };
    window.TrackMeNowViews = {
      applyView: function (id) { api.setView(id); return id; },
      get current() { return current; }
    };

    wireViewButtons(api);
    api.setView(current);

    const search = $('search');
    const searchBtn = $('searchBtn');
    function doSearch() {
      const q = (search && search.value || '').trim();
      if (!q) return;
      const coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (coord) {
        try { globe.planet.camera.flyLonLat(new LonLat(+coord[2], +coord[1], 8000)); } catch (e) {}
        return;
      }
      fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q), {
        headers: { Accept: 'application/json' }
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d[0]) throw new Error('Not found');
        globe.planet.camera.flyLonLat(new LonLat(+d[0].lon, +d[0].lat, 12000));
      }).catch(function (e) { alert(e.message || 'Search failed'); });
    }
    if (searchBtn) searchBtn.onclick = doSearch;
    if (search) search.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });

    const gpsBtn = $('gpsBtn');
    if (gpsBtn) {
      let watchId = null;
      gpsBtn.onclick = function () {
        if (watchId != null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
          gpsBtn.textContent = '◎ GPS';
          return;
        }
        if (!navigator.geolocation) return alert('GPS unavailable');
        watchId = navigator.geolocation.watchPosition(function (p) {
          try {
            globe.planet.camera.flyLonLat(new LonLat(p.coords.longitude, p.coords.latitude, Math.max(1200, p.coords.accuracy * 20)));
          } catch (e) {}
          setStatus('GPS LIVE ±' + Math.round(p.coords.accuracy) + 'm · PLANETARY', true);
        }, function (e) { setStatus('GPS · ' + e.message, false); }, { enableHighAccuracy: true });
        gpsBtn.textContent = 'Stop GPS';
      };
    }

    closeSplash();
    setStatus('3D GEOSPATIAL ENGINE ONLINE · PLANETARY MODE', true);
    return api;
  }

  function startMapLibreFallback() {
    if (!window.maplibregl) {
      setStatus('NO 3D ENGINE AVAILABLE', false);
      closeSplash();
      return;
    }
    setStatus('OPENGLOBUS UNAVAILABLE · MAPLIBRE FALLBACK', true);
    const STYLE = {
      version: 8,
      sources: {
        satellite: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']
        },
        dark: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}']
        }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#02050b' } },
        { id: 'base-satellite', type: 'raster', source: 'satellite' },
        { id: 'base-dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } }
      ]
    };
    const map = new maplibregl.Map({
      container: 'map', style: STYLE, center: [20, 25], zoom: 1.6,
      minZoom: 0.4, maxZoom: 19, maxPitch: 85, attributionControl: false
    });
    window.map = map;
    map.on('load', function () {
      closeSplash();
      try { map.setProjection({ type: 'globe' }); } catch (e) {}
      setStatus('3D ENGINE (MAPLIBRE) · PLANETARY FALLBACK', true);
    });
  }

  setStatus('STARTING 3D GEOSPATIAL ENGINE…', true);
  startOpenGlobus().catch(function (err) {
    console.error('[TrackMeNow] OpenGlobus failed', err);
    setStatus('OPENGLOBUS LOAD FAILED · TRYING FALLBACK', false);
    startMapLibreFallback();
  });
  setTimeout(closeSplash, 5000);
})();
