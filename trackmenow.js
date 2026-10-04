/* TrackMeNow — MapLibre Global Intelligence (self-contained, GitHub Pages safe)
 * Three views: 3D Globe · Satellite · Dark digital
 * Zoom: orbital Earth (z~0.5) → building tops (z~19)
 */
(function () {
  const API = (typeof location !== 'undefined' && location.origin && !String(location.origin).startsWith('file:'))
    ? location.origin : '';
  const $ = (id) => document.getElementById(id);
  const status = $('status');
  const coords = $('coords');

  function setStatus(html) {
    if (status) status.innerHTML = html;
  }

  if (!window.maplibregl) {
    setStatus('<span style="color:#ff6672">●</span> MAPLIBRE NOT LOADED');
    return;
  }

  const EMPTY = { type: 'FeatureCollection', features: [] };

  const MAP_STYLE = {
    version: 8,
    projection: { type: 'globe' },
    fog: {
      color: '#08131a',
      'high-color': '#0a2230',
      'space-color': '#02050b',
      'horizon-blend': 0.16,
      range: [0.5, 10]
    },
    sources: {
      ocean: {
        type: 'geojson',
        data: 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_ocean.geojson'
      },
      land: {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'
      },
      countries: {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'
      },
      satellite: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Esri World Imagery'
      },
      labels: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Esri'
      },
      dark: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Esri Dark Gray'
      },
      flights: { type: 'geojson', data: EMPTY },
      ships: { type: 'geojson', data: EMPTY }
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#05070b' } },
      { id: 'globe-ocean', type: 'fill', source: 'ocean', paint: { 'fill-color': '#078eaa', 'fill-opacity': 0.88 } },
      { id: 'globe-land', type: 'fill', source: 'land', paint: { 'fill-color': '#c7cfbd', 'fill-opacity': 0.86 } },
      { id: 'globe-borders', type: 'line', source: 'countries', paint: { 'line-color': '#18262a', 'line-width': 1.1, 'line-opacity': 0.95 } },
      { id: 'base-satellite', type: 'raster', source: 'satellite', paint: { 'raster-opacity': 0.35 } },
      { id: 'base-dark', type: 'raster', source: 'dark', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.96 } },
      { id: 'base-labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.9 } },
      {
        id: 'flights-layer',
        type: 'circle',
        source: 'flights',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2.5, 6, 4, 12, 6],
          'circle-color': '#45a8ff',
          'circle-stroke-color': '#05080c',
          'circle-stroke-width': 1,
          'circle-opacity': 0.92
        }
      },
      {
        id: 'ships-layer',
        type: 'circle',
        source: 'ships',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 2, 6, 3.5, 12, 5],
          'circle-color': '#43e0c0',
          'circle-stroke-color': '#05080c',
          'circle-stroke-width': 1,
          'circle-opacity': 0.9
        }
      }
    ]
  };

  let map;
  try {
    map = new maplibregl.Map({
      container: 'map',
      style: MAP_STYLE,
      center: [20, 25],
      zoom: 1.8,
      minZoom: 0.5,
      maxZoom: 19,
      maxPitch: 70,
      attributionControl: false,
      renderWorldCopies: false
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  } catch (e) {
    setStatus('<span style="color:#ff6672">●</span> WEBGL MAP FAILED · ' + (e.message || e));
    return;
  }
  window.map = map;

  map.on('load', () => {
    const splash = $('splash');
    if (splash) splash.classList.add('open');
    setStatus('<span class="live">●</span> MAP READY · ' + (currentView || 'globe').toUpperCase());
    loadFlights();
  });

  map.on('moveend', () => {
    if (!coords) return;
    const c = map.getCenter();
    coords.textContent = 'ZOOM ' + map.getZoom().toFixed(1) + ' · ' + c.lat.toFixed(2) + ', ' + c.lng.toFixed(2);
  });

  const VIEWS = {
    globe: {
      id: 'globe',
      projection: 'globe',
      minZoom: 0.5,
      maxZoom: 18,
      fog: { color: '#08131a', 'high-color': '#0a2230', 'space-color': '#02050b', 'horizon-blend': 0.16, range: [0.5, 10] }
    },
    satellite: {
      id: 'satellite',
      projection: 'mercator',
      minZoom: 0.8,
      maxZoom: 19,
      fog: null
    },
    dark: {
      id: 'dark',
      projection: 'mercator',
      minZoom: 0.8,
      maxZoom: 19,
      fog: null
    }
  };

  let currentView = 'globe';
  try { currentView = localStorage.getItem('tm-view') || 'globe'; } catch (e) {}

  function setBase(mode) {
    const sat = mode === 'satellite' || mode === 'globe';
    const dark = mode === 'dark';
    try {
      if (map.getLayer('base-satellite')) {
        map.setLayoutProperty('base-satellite', 'visibility', sat ? 'visible' : 'none');
        map.setPaintProperty('base-satellite', 'raster-opacity', mode === 'globe' ? 0.35 : 1);
      }
      if (map.getLayer('base-dark')) {
        map.setLayoutProperty('base-dark', 'visibility', dark ? 'visible' : 'none');
      }
      if (map.getLayer('base-labels')) {
        map.setLayoutProperty('base-labels', 'visibility', 'visible');
      }
      ['globe-ocean', 'globe-land', 'globe-borders'].forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', mode === 'globe' ? 'visible' : 'none');
      });
    } catch (e) {}
  }

  function applyView(id, reset) {
    const v = VIEWS[id] || VIEWS.globe;
    currentView = v.id;
    try { localStorage.setItem('tm-view', currentView); } catch (e) {}
    try {
      map.setMinZoom(v.minZoom);
      map.setMaxZoom(v.maxZoom);
      if (map.setProjection) map.setProjection({ type: v.projection });
      if (map.setFog) map.setFog(v.fog);
      setBase(v.id);
      if (reset) {
        map.easeTo({ zoom: v.id === 'globe' ? 1.6 : 2.2, pitch: 0, bearing: 0, duration: 800 });
      }
    } catch (e) {}
    document.querySelectorAll('[data-tm-view]').forEach((btn) => {
      btn.classList.toggle('on', btn.getAttribute('data-tm-view') === currentView);
    });
    setStatus('<span class="live">●</span> ' + v.id.toUpperCase() + ' VIEW');
    return currentView;
  }

  function wireViewButtons() {
    const g = $('argos-globe');
    const s = $('argos-sat');
    const m = $('argos-map');
    if (g) { g.setAttribute('data-tm-view', 'globe'); g.onclick = () => applyView('globe', true); }
    if (s) { s.setAttribute('data-tm-view', 'satellite'); s.onclick = () => applyView('satellite', false); }
    if (m) { m.setAttribute('data-tm-view', 'dark'); m.onclick = () => applyView('dark', false); }
    applyView(currentView, false);
  }

  map.on('load', wireViewButtons);

  window.TrackMeNowViews = { applyView, VIEWS, get current() { return currentView; } };

  async function loadFlights() {
    try {
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
      let fc = null;
      if (API && !API.includes('github.io')) {
        const r = await fetch(API + '/api/global/movement?bbox=' + encodeURIComponent(bbox) + '&layers=flights');
        if (r.ok) fc = await r.json();
      }
      if (!fc) {
        const url = 'https://opensky-network.org/api/states/all?lamin=' + b.getSouth() +
          '&lomin=' + b.getWest() + '&lamax=' + b.getNorth() + '&lomax=' + b.getEast();
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();
          const features = (j.states || [])
            .filter((s) => Number.isFinite(s[5]) && Number.isFinite(s[6]))
            .map((s) => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [s[5], s[6]] },
              properties: { callsign: (s[1] || '').trim(), icao24: s[0] }
            }));
          fc = { type: 'FeatureCollection', features };
        }
      }
      if (fc && map.getSource('flights')) {
        const flights = {
          type: 'FeatureCollection',
          features: (fc.features || []).filter((f) => (f.properties || {}).category === 'flight' || f.properties?.icao24)
        };
        if (!flights.features.length && fc.features) flights.features = fc.features;
        map.getSource('flights').setData(flights);
        setStatus('<span class="live">●</span> ' + flights.features.length + ' AIRCRAFT · ' + currentView.toUpperCase());
      }
    } catch (e) {
      setStatus('<span class="live">●</span> MAP LIVE · FEEDS LIMITED');
    }
  }

  map.on('moveend', () => {
    clearTimeout(window.__tmFlightT);
    window.__tmFlightT = setTimeout(loadFlights, 600);
  });
  setInterval(loadFlights, 30000);

  const gpsBtn = $('gpsBtn');
  if (gpsBtn) {
    let watchId = null;
    let marker = null;
    gpsBtn.onclick = () => {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        gpsBtn.textContent = '◎ GPS';
        return;
      }
      if (!navigator.geolocation) return alert('GPS unavailable');
      watchId = navigator.geolocation.watchPosition((p) => {
        const ll = [p.coords.longitude, p.coords.latitude];
        if (!marker) marker = new maplibregl.Marker({ color: '#43e0a0' }).setLngLat(ll).addTo(map);
        else marker.setLngLat(ll);
        map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), 14), duration: 600 });
        setStatus('<span class="live">●</span> GPS ±' + Math.round(p.coords.accuracy) + 'm');
      }, (e) => setStatus('GPS · ' + e.message), { enableHighAccuracy: true, maximumAge: 3000 });
      gpsBtn.textContent = 'Stop GPS';
    };
  }

  const search = $('search');
  const searchBtn = $('searchBtn');
  async function doSearch() {
    const q = (search && search.value || '').trim();
    if (!q) return;
    const coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coord) {
      map.easeTo({ center: [+coord[2], +coord[1]], zoom: 12, duration: 800 });
      return;
    }
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q), {
        headers: { Accept: 'application/json' }
      });
      const d = await r.json();
      if (!d[0]) throw new Error('Not found');
      map.easeTo({ center: [+d[0].lon, +d[0].lat], zoom: 11, duration: 900 });
    } catch (e) {
      alert(e.message || 'Search failed');
    }
  }
  if (searchBtn) searchBtn.onclick = doSearch;
  if (search) search.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  setStatus('<span class="live">●</span> STARTING MAP…');
})();
