/* TrackMeNow — Universe + Solar System immersive views */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const OG_VER = '0.28.7';
  const OG_JS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.es.js';
  const OG_CSS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.css';

  const PLANETS = [
    { id: 'sun', name: 'Sun', color: '#FDB813', r: 28, au: 0, engine: null, type: 'star' },
    { id: 'mercury', name: 'Mercury', color: '#B5B5B5', r: 5, au: 0.39, engine: null, type: 'planet', period: 0.24 },
    { id: 'venus', name: 'Venus', color: '#E8CDA0', r: 7, au: 0.72, engine: null, type: 'planet', period: 0.62 },
    { id: 'earth', name: 'Earth', color: '#3D8BFF', r: 8, au: 1.0, engine: 'earth', type: 'planet', period: 1 },
    { id: 'moon', name: 'Moon', color: '#C8C8C8', r: 3, au: 1.05, engine: 'moon', type: 'moon', period: 0.075 },
    { id: 'mars', name: 'Mars', color: '#C1440E', r: 6, au: 1.52, engine: 'mars', type: 'planet', period: 1.88 },
    { id: 'ceres', name: 'Ceres', color: '#A0A0A0', r: 3, au: 2.77, engine: null, type: 'dwarf', period: 4.6 },
    { id: 'jupiter', name: 'Jupiter', color: '#C88B3A', r: 16, au: 5.2, engine: null, type: 'planet', period: 11.86 },
    { id: 'saturn', name: 'Saturn', color: '#E6D3A3', r: 14, au: 9.5, engine: null, type: 'planet', period: 29.46 },
    { id: 'uranus', name: 'Uranus', color: '#7EC8E3', r: 10, au: 19.2, engine: null, type: 'planet', period: 84 },
    { id: 'neptune', name: 'Neptune', color: '#3F54BA', r: 9, au: 30.1, engine: null, type: 'planet', period: 165 },
    { id: 'pluto', name: 'Pluto', color: '#C9B8A8', r: 3, au: 39.5, engine: null, type: 'dwarf', period: 248 }
  ];
  const ASTEROIDS = [];
  for (let i = 0; i < 120; i++) {
    const au = 2.1 + Math.random() * 1.4;
    ASTEROIDS.push({ au: au, ang0: Math.random() * Math.PI * 2, period: Math.sqrt(au * au * au), size: 0.6 + Math.random() * 1.2, neo: Math.random() < 0.08 });
  }
  const COMETS = [
    { name: 'Halley', au: 17.8, period: 76, ang0: 1.2, color: '#aaf0ff' },
    { name: 'Encke', au: 2.2, period: 3.3, ang0: 2.4, color: '#dff' },
    { name: '67P', au: 3.5, period: 6.4, ang0: 0.6, color: '#cfe' },
    { name: 'NEOWISE', au: 1.4, period: 6800, ang0: 4.1, color: '#9ef' }
  ];
  const SPACECRAFT = [
    { name: 'Voyager 1', au: 162, ang0: 0.3, color: '#ffcc00' },
    { name: 'Voyager 2', au: 136, ang0: 1.1, color: '#ffaa00' },
    { name: 'Parker', au: 0.25, ang0: 2.0, color: '#ff6666' },
    { name: 'JWST', au: 1.01, ang0: 0.05, color: '#88ccff' },
    { name: 'ISS', au: 1.0, ang0: 0.02, color: '#ffffff' }
  ];

  let scale = 'earth', earthMode = 'flat', dayNight = false, openDrawer = null;
  let globe = null, og = null, maplibre = null;
  let solarZoom = 1, solarCanvas = null, solarCtx = null, animId = 0;
  let activeWx = { satellite: true, live: true, radar: false, dark: false, precip: false, wind: false, temp: false, humidity: false, pressure: false, events: true, quakes: true, fires: false };
  let rvHost = '', rvFrames = [], rvIndex = 0, playTimer = null, playing = false;
  let terminatorTimer = null, forecastTimer = null, gibsDayOffset = -1;

  function setStatus(msg, ok) {
    const el = $('status');
    if (!el) return;
    el.innerHTML = '<span style="color:' + (ok === false ? '#ff6672' : '#43e0a0') + '">●</span> ' + msg;
  }
  function ensureCss(href) {
    if (document.querySelector('link[data-og-css]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-og-css', '1');
    document.head.appendChild(l);
  }
  function sunLonLat(date) {
    const d = date || new Date();
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const day = (d - start) / 86400000;
    const decl = 23.44 * Math.sin((2 * Math.PI / 365) * (day - 81));
    const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    return { lon: 15 * (12 - utcH), lat: decl };
  }
  function normalizeLon(lon) {
    while (lon > 180) lon -= 360; while (lon < -180) lon += 360; return lon;
  }
  function terminatorFeatures(date) {
    const sun = sunLonLat(date); const steps = 90;
    function offsetRing(deltaHa) {
      const r = [];
      for (let i = 0; i <= steps; i++) {
        const lat = -90 + (180 * i) / steps;
        const latRad = lat * Math.PI / 180, sunLatRad = sun.lat * Math.PI / 180;
        let cosHA = -Math.tan(latRad) * Math.tan(sunLatRad);
        if (!isFinite(cosHA)) cosHA = 0; cosHA = Math.max(-1, Math.min(1, cosHA));
        r.push([normalizeLon(sun.lon + Math.acos(cosHA) * 180 / Math.PI + deltaHa), lat]);
      }
      for (let i = steps; i >= 0; i--) {
        const lat = -90 + (180 * i) / steps;
        const latRad = lat * Math.PI / 180, sunLatRad = sun.lat * Math.PI / 180;
        let cosHA = -Math.tan(latRad) * Math.tan(sunLatRad);
        if (!isFinite(cosHA)) cosHA = 0; cosHA = Math.max(-1, Math.min(1, cosHA));
        r.push([normalizeLon(sun.lon - Math.acos(cosHA) * 180 / Math.PI + deltaHa), lat]);
      }
      r.push(r[0]); return r;
    }
    return { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { soft: 0 }, geometry: { type: 'Polygon', coordinates: [offsetRing(0)] } },
      { type: 'Feature', properties: { soft: 1 }, geometry: { type: 'Polygon', coordinates: [offsetRing(-4)] } },
      { type: 'Feature', properties: { soft: 2 }, geometry: { type: 'Polygon', coordinates: [offsetRing(-8)] } }
    ]};
  }
  function gibsDateStr() {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + gibsDayOffset);
    return d.toISOString().slice(0, 10);
  }
  function updateTimeLabel() {
    const el = $('tm-time-label'); if (!el) return;
    if (rvFrames.length && activeWx.radar) {
      el.textContent = new Date((rvFrames[rvIndex].time || 0) * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return;
    }
    el.textContent = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · ' + gibsDateStr();
  }
  function applyGibsDay() {
    updateTimeLabel();
    if (!maplibre || scale !== 'earth') return;
    const date = gibsDateStr();
    try {
      if (maplibre.getSource('gibs')) {
        maplibre.getSource('gibs').setTiles(['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' + date + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg']);
        if (maplibre.getLayer('gibs-live')) {
          const vis = activeWx.live && !activeWx.dark ? 'visible' : 'none';
          maplibre.setLayoutProperty('gibs-live', 'visibility', 'none');
          setTimeout(function () { try { maplibre.setLayoutProperty('gibs-live', 'visibility', vis); } catch (e) {} }, 30);
        }
      }
      if (maplibre.getSource('fires')) maplibre.getSource('fires').setTiles(['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/' + date + '/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png']);
      setStatus('EARTH · imagery ' + date, true);
    } catch (e) { if (scale === 'earth') enterEarth(); }
  }

  async function loadActivity() {
    if (!maplibre) return;
    if (activeWx.events) {
      try {
        const j = await (await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=80')).json();
        const feats = [];
        (j.events || []).forEach(function (ev) {
          const cats = (ev.categories || []).map(function (c) { return c.title; }).join(', ');
          (ev.geometry || []).forEach(function (g) {
            if (g.type === 'Point' && g.coordinates) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] }, properties: { title: ev.title, category: cats } });
          });
        });
        if (maplibre.getSource('eonet')) maplibre.getSource('eonet').setData({ type: 'FeatureCollection', features: feats });
      } catch (e) {}
    } else if (maplibre.getSource('eonet')) maplibre.getSource('eonet').setData({ type: 'FeatureCollection', features: [] });
    if (activeWx.quakes) {
      try {
        const j = await (await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')).json();
        if (maplibre.getSource('quakes')) maplibre.getSource('quakes').setData(j);
      } catch (e) {}
    } else if (maplibre.getSource('quakes')) maplibre.getSource('quakes').setData({ type: 'FeatureCollection', features: [] });
  }

  function injectChrome() {
    if ($('tm-universe-chrome')) return;
    const box = document.createElement('div');
    box.id = 'tm-universe-chrome';
    box.innerHTML = [
      '<div style="position:fixed;z-index:2200;left:50%;top:58px;transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:96vw">',
      '  <button data-scale="universe" class="tm-scale-btn">Universe</button>',
      '  <button data-scale="solar" class="tm-scale-btn">Solar System</button>',
      '  <button data-scale="earth" class="tm-scale-btn">Earth Live</button>',
      '  <button data-scale="moon" class="tm-scale-btn">Moon</button>',
      '  <button data-scale="mars" class="tm-scale-btn">Mars</button>',
      '</div>',
      '<div id="tm-drawer-live" class="tm-drawer" style="display:none">',
      '  <div class="tm-drawer-title">LIVE MAPS</div>',
      '  <button data-wx="live" class="tm-drawer-item on">Live clouds (VIIRS)</button>',
      '  <button data-wx="radar" class="tm-drawer-item">Radar</button>',
      '  <button data-wx="fires" class="tm-drawer-item">Active fires</button>',
      '  <button data-wx="events" class="tm-drawer-item on">EONET events</button>',
      '  <button data-wx="quakes" class="tm-drawer-item on">Earthquakes</button>',
      '  <button data-wx="dark" class="tm-drawer-item">Dark base</button>',
      '</div>',
      '<div id="tm-drawer-weather" class="tm-drawer" style="display:none">',
      '  <div class="tm-drawer-title">FORECAST MAPS</div>',
      '  <button data-wx="precip" class="tm-drawer-item">Precipitation</button>',
      '  <button data-wx="wind" class="tm-drawer-item">Wind</button>',
      '  <button data-wx="temp" class="tm-drawer-item">Temperature</button>',
      '  <button data-wx="humidity" class="tm-drawer-item">Humidity</button>',
      '  <button data-wx="pressure" class="tm-drawer-item">Pressure</button>',
      '</div>',
      '<div id="tm-bottom-bar">',
      '  <button data-bar="satellite" class="tm-bar-btn on">Satellite</button>',
      '  <button data-bar="live" class="tm-bar-btn">Live</button>',
      '  <button data-bar="flat" class="tm-bar-btn on">Flat</button>',
      '  <button data-bar="globe" class="tm-bar-btn">3D</button>',
      '  <button data-bar="weather" class="tm-bar-btn">Weather</button>',
      '  <button data-bar="daynight" class="tm-bar-btn">Day/Night</button>',
      '</div>',
      '<div id="tm-timebar" style="display:none">',
      '  <button id="tm-play" type="button" class="tm-play">▶</button>',
      '  <button id="tm-day-prev" type="button" class="tm-tbtn">◀ day</button>',
      '  <button id="tm-prev" type="button" class="tm-tbtn">◀</button>',
      '  <div id="tm-time-label" style="min-width:150px;text-align:center;font-weight:700">—</div>',
      '  <button id="tm-next" type="button" class="tm-tbtn">▶</button>',
      '  <button id="tm-day-next" type="button" class="tm-tbtn">day ▶</button>',
      '  <input id="tm-time-slider" type="range" min="0" max="0" value="0" style="width:160px">',
      '</div>',
      '<div id="tm-wx-readout" style="display:none"></div>',
      '<div id="tm-wx-legend" style="display:none;position:fixed;z-index:2280;left:14px;bottom:78px;padding:6px 12px;border-radius:8px;background:rgba(8,12,18,.92);border:1px solid rgba(255,255,255,.14);font:11px system-ui;color:#e8f0f6"></div>',
      '<div id="tm-zoom-stack">',
      '  <button id="tm-zoom-in" class="tm-z">+</button>',
      '  <button id="tm-zoom-out" class="tm-z">−</button>',
      '  <button id="tm-zoom-home" class="tm-z" style="font-size:12px">⌂</button>',
      '</div>',
      '<style>',
      '.tm-scale-btn,.tm-z,.tm-tbtn,.tm-bar-btn,.tm-drawer-item{border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui}',
      '.tm-scale-btn{padding:8px 12px}',
      '.tm-scale-btn.on{border-color:#4fd0a0;color:#4fd0a0;box-shadow:0 0 12px #4fd0a044}',
      '#tm-bottom-bar{position:fixed;z-index:2300;left:50%;bottom:14px;transform:translateX(-50%);display:none;gap:6px;padding:8px 10px;border-radius:14px;background:rgba(8,12,18,.94);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);flex-wrap:wrap;justify-content:center;max-width:96vw}',
      '.tm-bar-btn{padding:10px 14px;border-radius:10px;white-space:nowrap}',
      '.tm-bar-btn.on{border-color:#4fd0a0;color:#4fd0a0;background:rgba(79,208,160,.12)}',
      '.tm-drawer{position:fixed;z-index:2290;left:50%;bottom:70px;transform:translateX(-50%);min-width:200px;max-width:90vw;padding:8px 0;border-radius:12px;background:rgba(18,14,12,.96);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);color:#f0e8e0}',
      '.tm-drawer-title{padding:4px 14px 6px;font:800 10px system-ui;letter-spacing:.6px;opacity:.65}',
      '.tm-drawer-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:#f0e8e0;padding:10px 14px;font:600 13px system-ui;border-radius:0}',
      '.tm-drawer-item:hover{background:rgba(255,255,255,.08)}',
      '.tm-drawer-item.on{background:rgba(255,255,255,.1);box-shadow:inset 3px 0 0 #4fd0a0}',
      '#tm-timebar{position:fixed;z-index:2280;left:50%;bottom:72px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12px;background:rgba(8,12,18,.92);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace}',
      '#tm-time-label{min-width:150px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}',
      '.tm-play{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(69,168,255,.25);color:#fff;cursor:pointer}',
      '.tm-tbtn{width:auto;min-width:32px;height:32px;padding:0 8px}',
      '#tm-wx-readout{position:fixed;z-index:2200;left:12px;bottom:90px;padding:10px 12px;border-radius:10px;background:rgba(8,14,20,.9);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace;max-width:240px}',
      '#tm-zoom-stack{position:fixed;z-index:2200;right:14px;bottom:100px;display:flex;flex-direction:column;gap:6px}',
      '.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-right{display:none!important}',
      '.tm-z{width:40px;height:40px;font-size:20px;font-weight:900;padding:0}',
      '#tm-solar-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010208;cursor:grab;z-index:2}',
      '</style>'
    ].join('');
    document.body.appendChild(box);
    box.querySelectorAll('[data-scale]').forEach(function (b) { b.onclick = function () { setScale(b.getAttribute('data-scale')); }; });
    box.querySelectorAll('[data-bar]').forEach(function (b) {
      b.onclick = function () {
        const k = b.getAttribute('data-bar');
        if (k === 'satellite') { activeWx.satellite = true; activeWx.dark = false; applyLayers(); syncBar(); }
        else if (k === 'live') toggleDrawer(openDrawer === 'live' ? null : 'live');
        else if (k === 'weather') toggleDrawer(openDrawer === 'weather' ? null : 'weather');
        else if (k === 'flat') { earthMode = 'flat'; if (scale === 'earth') enterEarth(); syncBar(); }
        else if (k === 'globe') { earthMode = 'globe'; if (scale === 'earth') enterEarth(); syncBar(); }
        else if (k === 'daynight') { dayNight = !dayNight; if (scale === 'earth') applyDayNight(); syncBar(); }
      };
    });
    box.querySelectorAll('[data-wx]').forEach(function (b) {
      b.onclick = function () {
        const k = b.getAttribute('data-wx');
        activeWx[k] = !activeWx[k];
        if (k === 'dark' && activeWx.dark) activeWx.satellite = true;
        if (k === 'live' && activeWx.live) activeWx.dark = false;
        if (['temp', 'humidity', 'pressure', 'wind', 'precip'].indexOf(k) >= 0) {
          ['temp','humidity','pressure','wind','precip'].forEach(function(m){ if(m!==k) activeWx[m]=false; });
          syncDrawerItems(); applyLayers(); refreshForecast(); return;
        }
        syncDrawerItems(); applyLayers();
        if (k === 'events' || k === 'quakes') loadActivity();
      };
    });
    $('tm-zoom-in').onclick = function () { zoomBy(1); };
    $('tm-zoom-out').onclick = function () { zoomBy(-1); };
    $('tm-zoom-home').onclick = function () {
      if (maplibre) maplibre.flyTo({ center: [20, 15], zoom: earthMode === 'globe' ? 1.5 : 2, duration: 800 });
      else if (scale === 'solar' || scale === 'universe') solarZoom = 1;
    };
    $('tm-play').onclick = togglePlay;
    $('tm-prev').onclick = function () { stepFrame(-1); };
    $('tm-next').onclick = function () { stepFrame(1); };
    $('tm-time-slider').oninput = function () { rvIndex = parseInt(this.value, 10) || 0; applyRadar(); updateTime(); };
    if ($('tm-day-prev')) $('tm-day-prev').onclick = function () { gibsDayOffset = Math.max(-14, gibsDayOffset - 1); applyGibsDay(); };
    if ($('tm-day-next')) $('tm-day-next').onclick = function () { gibsDayOffset = Math.min(0, gibsDayOffset + 1); applyGibsDay(); };
    document.addEventListener('click', function (e) {
      if (!openDrawer) return;
      const t = e.target;
      if (t.closest && (t.closest('.tm-drawer') || t.closest('[data-bar="live"]') || t.closest('[data-bar="weather"]'))) return;
      toggleDrawer(null);
    });
  }

  function toggleDrawer(which) {
    openDrawer = which;
    if ($('tm-drawer-live')) $('tm-drawer-live').style.display = which === 'live' ? 'block' : 'none';
    if ($('tm-drawer-weather')) $('tm-drawer-weather').style.display = which === 'weather' ? 'block' : 'none';
    syncBar();
  }
  function syncBar() {
    document.querySelectorAll('[data-bar]').forEach(function (b) {
      const k = b.getAttribute('data-bar'); let on = false;
      if (k === 'satellite') on = activeWx.satellite && !activeWx.dark;
      if (k === 'live') on = openDrawer === 'live' || activeWx.live || activeWx.radar || activeWx.events || activeWx.quakes;
      if (k === 'flat') on = earthMode === 'flat';
      if (k === 'globe') on = earthMode === 'globe';
      if (k === 'weather') on = openDrawer === 'weather' || activeWx.temp || activeWx.wind || activeWx.precip || activeWx.humidity || activeWx.pressure;
      if (k === 'daynight') on = dayNight;
      b.classList.toggle('on', on);
    });
  }
  function syncDrawerItems() {
    document.querySelectorAll('[data-wx]').forEach(function (b) { b.classList.toggle('on', !!activeWx[b.getAttribute('data-wx')]); });
  }
  function markChrome() {
    document.querySelectorAll('[data-scale]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-scale') === scale); });
    const show = scale === 'earth';
    if ($('tm-bottom-bar')) $('tm-bottom-bar').style.display = show ? 'flex' : 'none';
    ['tm-timebar', 'tm-wx-readout'].forEach(function (id) {
      const el = $(id); if (el) el.style.display = show ? (id === 'tm-timebar' ? 'flex' : 'block') : 'none';
    });
    if (!show) toggleDrawer(null);
  }

  function ensureSolarCanvas() {
    const map = $('map'); if (!map) return null;
    let c = $('tm-solar-canvas');
    if (!c) {
      c = document.createElement('canvas'); c.id = 'tm-solar-canvas'; map.appendChild(c);
      c.addEventListener('wheel', function (e) { e.preventDefault(); zoomBy(e.deltaY > 0 ? -1 : 1); }, { passive: false });
      let dragging = false, lx = 0, ly = 0, panX = 0, panY = 0;
      c._pan = function () { return { x: panX, y: panY }; };
      c.addEventListener('mousedown', function (e) { dragging = true; lx = e.clientX; ly = e.clientY; });
      window.addEventListener('mouseup', function () { dragging = false; });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return; panX += e.clientX - lx; panY += e.clientY - ly; lx = e.clientX; ly = e.clientY;
      });
      c.addEventListener('click', function (e) {
        if (scale !== 'solar' && scale !== 'universe') return;
        const rect = c.getBoundingClientRect();
        const hit = pickPlanet(e.clientX - rect.left, e.clientY - rect.top);
        if (hit && hit.engine) setScale(hit.engine);
      });
    }
    return c;
  }

  function layoutPlanets(w, h) {
    const cx = w / 2 + (solarCanvas && solarCanvas._pan ? solarCanvas._pan().x : 0);
    const cy = h / 2 + (solarCanvas && solarCanvas._pan ? solarCanvas._pan().y : 0);
    const scalePx = Math.min(w, h) * 0.035 * solarZoom;
    return PLANETS.map(function (p) {
      const period = p.period || 1;
      const ang = (p.au || 0) * 0.85 + (performance.now() / 50000) * (p.au ? 1 / Math.sqrt(Math.max(period, 0.1)) : 0);
      const dist = p.au * scalePx * 28;
      return { p: p, x: cx + Math.cos(ang) * dist, y: cy + Math.sin(ang) * dist * 0.55, rad: Math.max(3, p.r * solarZoom * (scale === 'universe' ? 0.55 : 1)) };
    });
  }

  function pickPlanet(mx, my) {
    if (!solarCanvas) return null;
    const w = solarCanvas.width, h = solarCanvas.height;
    const laid = layoutPlanets(w, h);
    for (let i = laid.length - 1; i >= 0; i--) {
      const o = laid[i];
      const dx = mx * (w / solarCanvas.clientWidth) - o.x;
      const dy = my * (h / solarCanvas.clientHeight) - o.y;
      if (dx * dx + dy * dy <= (o.rad + 10) * (o.rad + 10)) return o.p;
    }
    return null;
  }

  function drawSolar() {
    if (!solarCanvas || !solarCtx || (scale !== 'solar' && scale !== 'universe')) return;
    const c = solarCanvas, ctx = solarCtx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== (w * dpr | 0) || c.height !== (h * dpr | 0)) { c.width = w * dpr | 0; c.height = h * dpr | 0; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = performance.now() / 1000;
    const cx = w / 2 + (c._pan ? c._pan().x : 0);
    const cy = h / 2 + (c._pan ? c._pan().y : 0);
    const scalePx = Math.min(w, h) * 0.035 * solarZoom;

    if (scale === 'universe') {
      ctx.fillStyle = '#000008'; ctx.fillRect(0, 0, w, h);
      [{ x: 0.15, y: 0.2, rx: 40, ry: 18, rot: 0.4, col: 'rgba(180,160,255,0.12)' },
       { x: 0.8, y: 0.25, rx: 50, ry: 22, rot: -0.6, col: 'rgba(120,180,255,0.1)' },
       { x: 0.25, y: 0.75, rx: 35, ry: 14, rot: 0.9, col: 'rgba(255,180,200,0.1)' },
       { x: 0.75, y: 0.7, rx: 45, ry: 20, rot: 0.2, col: 'rgba(160,220,200,0.1)' }].forEach(function (g) {
        const gx = g.x * w + (c._pan ? c._pan().x * 0.3 : 0);
        const gy = g.y * h + (c._pan ? c._pan().y * 0.3 : 0);
        ctx.save(); ctx.translate(gx, gy); ctx.rotate(g.rot + t * 0.01);
        ctx.fillStyle = g.col; ctx.beginPath(); ctx.ellipse(0, 0, g.rx * solarZoom, g.ry * solarZoom, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      });
      [{ x: 0.35, y: 0.4, r: 80, c1: 'rgba(255,80,120,0.08)', c2: 'rgba(80,40,120,0)' },
       { x: 0.65, y: 0.55, r: 100, c1: 'rgba(60,120,255,0.07)', c2: 'rgba(20,40,80,0)' },
       { x: 0.5, y: 0.3, r: 60, c1: 'rgba(100,255,180,0.06)', c2: 'rgba(0,40,30,0)' }].forEach(function (n) {
        const nx = n.x * w + Math.sin(t * 0.05) * 8, ny = n.y * h + Math.cos(t * 0.04) * 6;
        const grd = ctx.createRadialGradient(nx, ny, 0, nx, ny, n.r * solarZoom);
        grd.addColorStop(0, n.c1); grd.addColorStop(1, n.c2);
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(nx, ny, n.r * solarZoom, 0, Math.PI * 2); ctx.fill();
      });
      for (let i = 0; i < 400; i++) {
        const sx = (Math.sin(i * 12.9898 + 1.1) * 0.5 + 0.5) * w;
        const sy = (Math.sin(i * 78.233 + 2.2) * 0.5 + 0.5) * h;
        const bright = 0.3 + (Math.sin(i * 3.7 + t * 0.5) * 0.5 + 0.5) * 0.7;
        const size = (i % 17 === 0) ? 2.2 : (i % 5 === 0) ? 1.4 : 0.8;
        ctx.fillStyle = 'rgba(220,230,255,' + bright + ')'; ctx.fillRect(sx, sy, size, size);
      }
      const bhx = cx - 80 * solarZoom, bhy = cy - 30 * solarZoom, bhr = 18 * solarZoom;
      ctx.save(); ctx.translate(bhx, bhy); ctx.rotate(t * 0.3);
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = 'rgba(255,' + (140 + i * 30) + ',60,' + (0.35 - i * 0.08) + ')'; ctx.lineWidth = 3 - i;
        ctx.beginPath(); ctx.ellipse(0, 0, bhr * (2.2 + i * 0.5), bhr * (0.6 + i * 0.15), 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      const bhg = ctx.createRadialGradient(bhx, bhy, 0, bhx, bhy, bhr);
      bhg.addColorStop(0, '#000'); bhg.addColorStop(0.7, '#110011'); bhg.addColorStop(1, 'rgba(80,20,40,0.4)');
      ctx.fillStyle = bhg; ctx.beginPath(); ctx.arc(bhx, bhy, bhr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,180,120,0.7)'; ctx.font = '10px ui-monospace'; ctx.fillText('Black Hole', bhx - 28, bhy + bhr + 16);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.35);
      const mw = ctx.createLinearGradient(-w, 0, w, 0);
      mw.addColorStop(0, 'rgba(0,0,0,0)'); mw.addColorStop(0.3, 'rgba(180,190,220,0.06)');
      mw.addColorStop(0.5, 'rgba(220,210,255,0.12)'); mw.addColorStop(0.7, 'rgba(180,190,220,0.06)'); mw.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mw; ctx.fillRect(-w, -30 * solarZoom, w * 2, 60 * solarZoom);
      for (let i = 0; i < 100; i++) {
        const mx = (Math.sin(i * 9.1) * 0.5 + 0.5) * w - w / 2;
        const my = (Math.sin(i * 4.3) * 0.5) * 25 * solarZoom;
        ctx.fillStyle = 'rgba(255,245,220,0.5)'; ctx.fillRect(mx, my, 1.2, 1.2);
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(200,210,255,0.5)'; ctx.font = '11px ui-monospace'; ctx.fillText('Milky Way', cx + 40, cy - 40);
      const ssx = cx + 20 * solarZoom, ssy = cy + 10 * solarZoom;
      ctx.fillStyle = '#FDB813'; ctx.beginPath(); ctx.arc(ssx, ssy, 4 * solarZoom, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(253,184,19,0.3)'; ctx.beginPath(); ctx.arc(ssx, ssy, 12 * solarZoom, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9fd2ff'; ctx.font = '10px ui-monospace'; ctx.fillText('Our Solar System → zoom in', ssx + 14, ssy + 4);
      ctx.fillStyle = 'rgba(180,200,220,0.55)'; ctx.font = '11px system-ui';
      ctx.fillText('UNIVERSE · stars · nebulae · galaxies · black holes · Milky Way', 12, 28);
      ctx.fillText('Scroll / + to enter Solar System', 12, h - 14);
    } else {
      ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(200,210,230,0.4)';
      for (let i = 0; i < 120; i++) {
        const sx = (Math.sin(i * 12.9898) * 0.5 + 0.5) * w;
        const sy = (Math.sin(i * 78.233) * 0.5 + 0.5) * h;
        ctx.fillRect(sx, sy, 1, 1);
      }
      ctx.strokeStyle = 'rgba(100,140,180,0.25)'; ctx.lineWidth = 1;
      PLANETS.forEach(function (p) {
        if (!p.au) return;
        const dist = p.au * scalePx * 28;
        ctx.beginPath(); ctx.ellipse(cx, cy, dist, dist * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      });
      ASTEROIDS.forEach(function (a) {
        const ang = a.ang0 + t * 0.025 / Math.max(a.period, 0.5);
        const dist = a.au * scalePx * 28;
        const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist * 0.55;
        ctx.fillStyle = a.neo ? 'rgba(255,180,80,0.95)' : 'rgba(120,160,220,0.6)';
        ctx.beginPath(); ctx.arc(x, y, a.size * Math.max(0.7, solarZoom * 0.55), 0, Math.PI * 2); ctx.fill();
      });
      COMETS.forEach(function (co) {
        const ang = co.ang0 + t * 0.02 / Math.max(co.period, 1);
        const dist = co.au * scalePx * 28;
        const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist * 0.55;
        const tx = x - Math.cos(ang) * 22 * solarZoom, ty = y - Math.sin(ang) * 12 * solarZoom;
        const g = ctx.createLinearGradient(x, y, tx, ty);
        g.addColorStop(0, co.color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = co.color; ctx.beginPath(); ctx.arc(x, y, 3 * solarZoom, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(200,230,255,0.85)'; ctx.font = '9px ui-monospace'; ctx.fillText(co.name, x + 7, y - 4);
      });
      SPACECRAFT.forEach(function (sc) {
        const ang = sc.ang0 + t * 0.012;
        const dist = Math.min(sc.au, 45) * scalePx * 28 * (sc.au > 50 ? 0.12 : 1);
        const x = cx + Math.cos(ang) * dist, y = cy + Math.sin(ang) * dist * 0.55;
        ctx.fillStyle = sc.color; ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
        ctx.strokeStyle = 'rgba(150,200,255,0.15)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx + scalePx * 28, cy); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,210,0.9)'; ctx.font = '8px ui-monospace'; ctx.fillText(sc.name, x + 6, y + 3);
      });
      layoutPlanets(w, h).forEach(function (o) {
        if (o.p.id === 'sun') {
          const grd = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.rad * 2);
          grd.addColorStop(0, '#fff8d0'); grd.addColorStop(0.35, '#FDB813'); grd.addColorStop(1, 'rgba(253,184,19,0)');
          ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(o.x, o.y, o.rad * 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = o.p.color; ctx.beginPath(); ctx.arc(o.x, o.y, o.rad, 0, Math.PI * 2); ctx.fill();
        if (o.p.id === 'saturn') {
          ctx.strokeStyle = 'rgba(230,211,163,0.7)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(o.x, o.y, o.rad * 1.9, o.rad * 0.5, -0.35, 0, Math.PI * 2); ctx.stroke();
        }
        if (o.p.id === 'earth') {
          ctx.strokeStyle = 'rgba(100,180,255,0.4)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(o.x, o.y, o.rad + 2, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = '#e8f0f8'; ctx.font = (o.p.type === 'dwarf' ? '9px' : '11px') + ' ui-monospace';
        ctx.fillText(o.p.name, o.x + o.rad + 5, o.y + 3);
      });
      ctx.fillStyle = 'rgba(180,200,220,0.55)'; ctx.font = '11px system-ui';
      ctx.fillText('SOLAR SYSTEM · planets · asteroids · comets · spacecraft · orbits', 12, 28);
      ctx.fillText('Click Earth / Moon / Mars to land · scroll to zoom deeper', 12, h - 14);
    }
    animId = requestAnimationFrame(drawSolar);
  }

  function showSolar(show) {
    const c = ensureSolarCanvas(); if (!c) return;
    solarCanvas = c; solarCtx = c.getContext('2d');
    c.style.display = show ? 'block' : 'none';
    if (show) { cancelAnimationFrame(animId); drawSolar(); } else cancelAnimationFrame(animId);
  }

  function destroyViews() {
    if (playing) { playing = false; if (playTimer) clearInterval(playTimer); playTimer = null; }
    if (terminatorTimer) { clearInterval(terminatorTimer); terminatorTimer = null; }
    if (forecastTimer) { clearTimeout(forecastTimer); forecastTimer = null; }
    try { if (globe && globe.destroy) globe.destroy(); } catch (e) {}
    globe = null;
    try { if (maplibre) maplibre.remove(); } catch (e) {}
    maplibre = null;
    const target = $('map');
    if (target) Array.from(target.children).forEach(function (ch) { if (ch.id !== 'tm-solar-canvas') ch.remove(); });
  }

  async function loadRV() {
    try {
      const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
      rvHost = j.host || 'https://tilecache.rainviewer.com';
      rvFrames = (j.radar && j.radar.past) || [];
      rvIndex = Math.max(0, rvFrames.length - 1);
      const s = $('tm-time-slider');
      if (s) { s.max = Math.max(0, rvFrames.length - 1); s.value = rvIndex; }
      updateTime();
    } catch (e) { rvFrames = []; }
  }
  function updateTime() { updateTimeLabel(); }
  function applyRadar() {
    if (!maplibre || !rvFrames.length) return;
    try { if (maplibre.getSource('radar')) maplibre.getSource('radar').setTiles([rvHost + rvFrames[rvIndex].path + '/256/{z}/{x}/{y}/2/1_1.png']); } catch (e) {}
  }
  function stepFrame(d) {
    if (!rvFrames.length) return;
    rvIndex = Math.max(0, Math.min(rvFrames.length - 1, rvIndex + d));
    if ($('tm-time-slider')) $('tm-time-slider').value = rvIndex;
    applyRadar(); updateTime();
  }
  function togglePlay() {
    if (playing) { playing = false; if (playTimer) clearInterval(playTimer); playTimer = null; if ($('tm-play')) $('tm-play').textContent = '▶'; return; }
    if (!rvFrames.length) return;
    playing = true; if ($('tm-play')) $('tm-play').textContent = '⏸';
    playTimer = setInterval(function () {
      rvIndex = rvIndex >= rvFrames.length - 1 ? 0 : rvIndex + 1;
      if ($('tm-time-slider')) $('tm-time-slider').value = rvIndex;
      applyRadar(); updateTime();
    }, 600);
  }
  function applyDayNight() {
    if (!maplibre) return;
    try {
      if (maplibre.getSource('terminator')) maplibre.getSource('terminator').setData(dayNight ? terminatorFeatures(new Date()) : { type: 'FeatureCollection', features: [] });
      ['night-0', 'night-1', 'night-2'].forEach(function (id) {
        if (maplibre.getLayer(id)) maplibre.setLayoutProperty(id, 'visibility', dayNight ? 'visible' : 'none');
      });
    } catch (e) {}
  }

  function activeForecastMode() {
    if (activeWx.precip) return 'precip'; if (activeWx.wind) return 'wind'; if (activeWx.temp) return 'temp';
    if (activeWx.humidity) return 'humidity'; if (activeWx.pressure) return 'pressure'; return null;
  }
  function forecastScale(mode) {
    if (mode === 'precip') return { prop: 'precip', stops: [0, 'rgba(0,0,0,0)', 0.2, '#7ec8ff', 1, '#3D8BFF', 4, '#7b5cff', 12, '#ff4d6d', 30, '#ffffff'], label: 'Rain' };
    if (mode === 'wind') return { prop: 'wind', stops: [0, '#0a1f3d', 20, '#1a6b9a', 45, '#2ecc71', 80, '#f1c40f', 120, '#e67e22', 180, '#c0392b'], label: 'Wind km/h' };
    if (mode === 'temp') return { prop: 'temp', stops: [-30, '#3b0a7a', -15, '#3d5a9e', 0, '#5b9bd5', 10, '#7dcea0', 20, '#f4d03f', 30, '#e67e22', 42, '#c0392b'], label: 'Temp °C' };
    if (mode === 'humidity') return { prop: 'humidity', stops: [0, '#c9a66b', 25, '#d4c06a', 45, '#7dcea0', 65, '#5dade2', 85, '#3498db', 100, '#1a4a8a'], label: 'Humidity %' };
    if (mode === 'pressure') return { prop: 'pressure', stops: [970, '#1a5fb4', 990, '#5dade2', 1005, '#a8d5e5', 1013, '#f5e6c8', 1025, '#e8a090', 1040, '#c0392b'], label: 'Pressure hPa' };
    return { prop: 'temp', stops: [0, '#888', 40, '#fff'], label: '' };
  }
  function setWeatherBaseDim(on) {
    if (!maplibre) return;
    try {
      if (maplibre.getLayer('sat')) maplibre.setPaintProperty('sat', 'raster-opacity', on ? 0.3 : 1);
      if (maplibre.getLayer('gibs-live')) maplibre.setPaintProperty('gibs-live', 'raster-opacity', on ? 0.15 : 0.55);
    } catch (e) {}
  }
  function paintForecast() {
    if (!maplibre) return;
    const mode = activeForecastMode(); const leg = $('tm-wx-legend');
    if (!mode) {
      try {
        if (maplibre.getLayer('forecast-heat')) maplibre.setLayoutProperty('forecast-heat', 'visibility', 'none');
        if (maplibre.getLayer('forecast-circles')) maplibre.setLayoutProperty('forecast-circles', 'visibility', 'none');
        if (maplibre.getSource('forecast')) maplibre.getSource('forecast').setData({ type: 'FeatureCollection', features: [] });
      } catch (e) {}
      if (leg) leg.style.display = 'none'; setWeatherBaseDim(false); return;
    }
    setWeatherBaseDim(true);
    const sc = forecastScale(mode);
    if (!window._fcGrid || !window._fcGrid.points || !window._fcGrid.points.length) {
      if (leg) { leg.style.display = 'block'; leg.textContent = sc.label + ' · loading…'; } return;
    }
    const features = [];
    window._fcGrid.points.forEach(function (p) {
      const v = p[sc.prop]; if (v == null || isNaN(v)) return;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { v: +v } });
    });
    try {
      if (maplibre.getSource('forecast')) maplibre.getSource('forecast').setData({ type: 'FeatureCollection', features: features });
      if (maplibre.getLayer('forecast-circles')) {
        maplibre.setLayoutProperty('forecast-circles', 'visibility', 'visible');
        maplibre.setPaintProperty('forecast-circles', 'circle-color', ['interpolate', ['linear'], ['get', 'v']].concat(sc.stops));
        maplibre.setPaintProperty('forecast-circles', 'circle-opacity', 0.6);
        maplibre.setPaintProperty('forecast-circles', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 1, 30, 3, 40, 5, 55, 8, 70]);
        maplibre.setPaintProperty('forecast-circles', 'circle-blur', 0.9);
      }
      if (maplibre.getLayer('forecast-heat')) {
        maplibre.setLayoutProperty('forecast-heat', 'visibility', 'visible');
        maplibre.setPaintProperty('forecast-heat', 'heatmap-weight', ['interpolate', ['linear'], ['get', 'v'], sc.stops[0], 0.2, sc.stops[sc.stops.length - 2], 1]);
        maplibre.setPaintProperty('forecast-heat', 'heatmap-radius', ['interpolate', ['linear'], ['zoom'], 1, 40, 3, 55, 5, 75]);
        maplibre.setPaintProperty('forecast-heat', 'heatmap-intensity', 1.8);
        maplibre.setPaintProperty('forecast-heat', 'heatmap-opacity', 0.9);
      }
    } catch (e) {}
    if (leg) { leg.style.display = 'block'; leg.innerHTML = '<b>' + sc.label + '</b>'; }
  }
  async function refreshForecast() {
    if (!maplibre || scale !== 'earth') return;
    const mode = activeForecastMode();
    if (!mode) { window._fcGrid = null; paintForecast(); return; }
    if (mode === 'precip' && maplibre.getLayer('radar')) { try { maplibre.setLayoutProperty('radar', 'visibility', 'visible'); activeWx.radar = true; } catch (e) {} }
    setStatus('Loading ' + mode + ' map…', true); setWeatherBaseDim(true);
    const c = maplibre.getCenter(); const z = maplibre.getZoom();
    const step = z < 1.5 ? 12 : z < 2.5 ? 8 : z < 4 ? 5 : 3.5;
    const pts = [];
    for (let lat = Math.max(-60, c.lat - step * 3); lat <= Math.min(75, c.lat + step * 3); lat += step) {
      for (let lon = c.lng - step * 4; lon <= c.lng + step * 4; lon += step) {
        let L = lon; while (L > 180) L -= 360; while (L < -180) L += 360;
        pts.push({ lat: +lat.toFixed(2), lon: +L.toFixed(2) });
      }
    }
    const results = await Promise.all(pts.slice(0, 60).map(async function (p) {
      try {
        const j = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon + '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_gusts_10m,precipitation')).json();
        const cur = j.current || {};
        return { lat: p.lat, lon: p.lon, temp: cur.temperature_2m, humidity: cur.relative_humidity_2m, pressure: cur.surface_pressure, wind: cur.wind_gusts_10m != null ? cur.wind_gusts_10m : cur.wind_speed_10m, precip: cur.precipitation };
      } catch (e) { return null; }
    }));
    window._fcGrid = { points: results.filter(Boolean) }; paintForecast();
    setStatus('Weather · ' + mode, true);
  }
  function applyLayers() {
    if (!maplibre) return;
    try {
      if (maplibre.getLayer('sat')) maplibre.setLayoutProperty('sat', 'visibility', activeWx.dark ? 'none' : 'visible');
      if (maplibre.getLayer('dark')) maplibre.setLayoutProperty('dark', 'visibility', activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('gibs-live')) maplibre.setLayoutProperty('gibs-live', 'visibility', activeWx.live && !activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('radar')) maplibre.setLayoutProperty('radar', 'visibility', activeWx.radar ? 'visible' : 'none');
      if (maplibre.getLayer('fires-layer')) maplibre.setLayoutProperty('fires-layer', 'visibility', activeWx.fires ? 'visible' : 'none');
      if (maplibre.getLayer('eonet-pts')) maplibre.setLayoutProperty('eonet-pts', 'visibility', activeWx.events ? 'visible' : 'none');
      if (maplibre.getLayer('quakes-pts')) maplibre.setLayoutProperty('quakes-pts', 'visibility', activeWx.quakes ? 'visible' : 'none');
    } catch (e) {}
    applyDayNight(); paintForecast(); refreshWx(); syncBar(); syncDrawerItems();
  }
  function refreshWx() {
    const el = $('tm-wx-readout'); if (!el || !maplibre) return;
    const c = maplibre.getCenter();
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) + '&longitude=' + c.lng.toFixed(3) + '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,precipitation')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        const cur = j.current || {};
        el.innerHTML = ['CENTER · ' + c.lat.toFixed(2) + '°, ' + c.lng.toFixed(2) + '°',
          '<b>Temp</b> ' + (cur.temperature_2m != null ? cur.temperature_2m + ' °C' : '—'),
          '<b>Humidity</b> ' + (cur.relative_humidity_2m != null ? cur.relative_humidity_2m + ' %' : '—'),
          '<b>Pressure</b> ' + (cur.surface_pressure != null ? Math.round(cur.surface_pressure) + ' hPa' : '—'),
          '<b>Wind</b> ' + (cur.wind_speed_10m != null ? cur.wind_speed_10m + ' km/h' : '—'),
          '<b>Precip</b> ' + (cur.precipitation != null ? cur.precipitation + ' mm' : '—')].join('<br>');
      }).catch(function () {});
  }

  async function enterEarth() {
    destroyViews(); showSolar(false);
    if (!window.maplibregl) throw new Error('MapLibre missing');
    await loadRV();
    const radarPath = rvFrames.length ? rvHost + rvFrames[rvIndex].path + '/256/{z}/{x}/{y}/2/1_1.png' : null;
    const useGlobe = earthMode === 'globe'; const date = gibsDateStr(); updateTimeLabel();
    const style = {
      version: 8,
      sources: {
        sat: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
        dark: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'] },
        gibs: { type: 'raster', tileSize: 256, maxzoom: 9, tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' + date + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'] },
        labels: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'] },
        terminator: { type: 'geojson', data: dayNight ? terminatorFeatures(new Date()) : { type: 'FeatureCollection', features: [] } },
        forecast: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        eonet: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        quakes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        fires: { type: 'raster', tileSize: 256, maxzoom: 8, tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/' + date + '/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'] }
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
        { id: 'gibs-live', type: 'raster', source: 'gibs', layout: { visibility: activeWx.live ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.55 } },
        { id: 'night-0', type: 'fill', source: 'terminator', filter: ['==', ['get', 'soft'], 0], layout: { visibility: dayNight ? 'visible' : 'none' }, paint: { 'fill-color': '#00060f', 'fill-opacity': 0.12 } },
        { id: 'night-1', type: 'fill', source: 'terminator', filter: ['==', ['get', 'soft'], 1], layout: { visibility: dayNight ? 'visible' : 'none' }, paint: { 'fill-color': '#00060f', 'fill-opacity': 0.16 } },
        { id: 'night-2', type: 'fill', source: 'terminator', filter: ['==', ['get', 'soft'], 2], layout: { visibility: dayNight ? 'visible' : 'none' }, paint: { 'fill-color': '#00060f', 'fill-opacity': 0.22 } },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
        { id: 'forecast-heat', type: 'heatmap', source: 'forecast', layout: { visibility: 'none' }, paint: { 'heatmap-radius': 55, 'heatmap-intensity': 1.8, 'heatmap-opacity': 0.9, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.15, '#2980b9', 0.35, '#2ecc71', 0.55, '#f1c40f', 0.75, '#e67e22', 1, '#c0392b'] } },
        { id: 'forecast-circles', type: 'circle', source: 'forecast', layout: { visibility: 'none' }, paint: { 'circle-radius': 36, 'circle-color': '#4fd0a0', 'circle-opacity': 0.55, 'circle-blur': 0.9, 'circle-stroke-width': 0 } },
        { id: 'fires-layer', type: 'raster', source: 'fires', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } },
        { id: 'eonet-pts', type: 'circle', source: 'eonet', paint: { 'circle-radius': 7, 'circle-color': '#ff6b35', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9 } },
        { id: 'quakes-pts', type: 'circle', source: 'quakes', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 2.5, 4, 5, 8, 7, 14], 'circle-color': ['interpolate', ['linear'], ['get', 'mag'], 2.5, '#f0d060', 4.5, '#ff9a3c', 6, '#e04040'], 'circle-stroke-width': 1, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85 } }
      ]
    };
    if (useGlobe) { style.projection = { type: 'globe' }; style.fog = { color: 'rgb(8, 16, 32)', 'high-color': 'rgb(25, 45, 75)', 'space-color': 'rgb(1, 2, 6)', 'horizon-blend': 0.1, range: [0.5, 12] }; }
    if (radarPath) {
      style.sources.radar = { type: 'raster', tileSize: 256, tiles: [radarPath] };
      style.layers.splice(3, 0, { id: 'radar', type: 'raster', source: 'radar', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75 } });
    }
    maplibre = new maplibregl.Map({ container: 'map', style: style, center: [20, 15], zoom: useGlobe ? 1.4 : 2, minZoom: useGlobe ? 0.5 : 1, maxZoom: 20, maxPitch: useGlobe ? 85 : 60, attributionControl: false, failIfMajorPerformanceCaveat: false });
    window.map = maplibre;
    maplibre.on('load', function () {
      try { maplibre.resize(); } catch (e) {}
      applyLayers(); loadActivity();
      setStatus('EARTH · ' + (useGlobe ? '3D' : 'FLAT') + ' · live feeds', true);
      if (dayNight) terminatorTimer = setInterval(function () { applyDayNight(); }, 60000);
    });
    maplibre.on('moveend', function () {
      if (forecastTimer) clearTimeout(forecastTimer);
      forecastTimer = setTimeout(function () { refreshWx(); if (activeForecastMode()) refreshForecast(); }, 500);
    });
    setTimeout(function () { try { maplibre.resize(); } catch (e) {} }, 300);
  }

  async function loadOg() {
    if (og) return og;
    ensureCss(OG_CSS);
    og = await import(/* webpackIgnore: true */ OG_JS);
    return og;
  }
  async function enterPlanet(planetId) {
    destroyViews(); showSolar(false);
    const mod = await loadOg();
    const Globe = mod.Globe, XYZ = mod.XYZ, LonLat = mod.LonLat, control = mod.control;
    const EmptyTerrain = mod.EmptyTerrain, RgbTerrain = mod.RgbTerrain;
    const moonEll = mod.moon, marsEll = mod.mars, quadTreeStrategyType = mod.quadTreeStrategyType;
    const target = $('map'); let layers = [], terrain = null;
    const opts = { target: target, name: planetId, autoActivate: true, maxGridSize: 128 };
    if (planetId === 'moon') {
      layers = [new XYZ('LRO', { isBaseLayer: true, url: 'https://{s}.terrain.openglobus.org/moon/sat/{z}/{x}/{y}.png', visibility: true, maxNativeZoom: 10 })];
      try { terrain = new RgbTerrain(null, { geoidSrc: null, maxZoom: 7, url: 'https://{s}.terrain.openglobus.org/moon/dem/{z}/{x}/{y}.png', heightFactor: 0.5 }); } catch (e) { terrain = new EmptyTerrain(); }
      opts.ellipsoid = moonEll; opts.atmosphereEnabled = false; opts.nightTextureSrc = null; opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    } else {
      layers = [new XYZ('OnMars', { isBaseLayer: true, url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/{z}/{y}/{x}?blankTile=false', visibility: true })];
      try { terrain = new RgbTerrain('Mars', { geoidSrc: null, maxZoom: 8, url: 'https://{s}.terrain.openglobus.org/mars/dem/{z}/{x}/{y}.png', heightFactor: 1.1 }); } catch (e) { try { terrain = new EmptyTerrain(); } catch (e2) { terrain = null; } }
      if (marsEll) opts.ellipsoid = marsEll; opts.atmosphereEnabled = false; opts.nightTextureSrc = null; opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    }
    opts.layers = layers; opts.terrain = terrain || new EmptyTerrain();
    globe = new Globe(opts); window.globe = globe;
    try {
      if (globe.planet.camera) { globe.planet.camera.minAltitude = 5; globe.planet.camera.maxAltitude = 8e6; }
      if (control && control.ZoomControl) globe.planet.addControl(new control.ZoomControl());
      if (globe.planet.camera.flyLonLat) globe.planet.camera.flyLonLat(new LonLat(0, 10, planetId === 'mars' ? 5e6 : 2.5e6));
    } catch (e) {}
    setStatus(planetId.toUpperCase() + ' · NASA mosaic', true);
  }

  function zoomBy(dir) {
    if (scale === 'universe' || scale === 'solar') {
      solarZoom = Math.max(0.2, Math.min(5, solarZoom * (dir > 0 ? 1.2 : 0.83)));
      if (scale === 'universe' && solarZoom > 0.7) setScale('solar');
      else if (scale === 'solar' && solarZoom > 2.8) setScale('earth');
      else if (scale === 'solar' && solarZoom < 0.35) setScale('universe');
      return;
    }
    if (maplibre) {
      maplibre.easeTo({ zoom: Math.max(0.5, Math.min(20, maplibre.getZoom() + (dir > 0 ? 1.0 : -1.0))), duration: 250 });
      return;
    }
    if (globe && og) {
      try {
        const cam = globe.planet.camera; const LonLat = og.LonLat;
        const ll = cam.getLonLat && cam.getLonLat(); const alt = (ll && ll.height) || 5e6;
        cam.flyLonLat(new LonLat(ll ? ll.lon : 0, ll ? ll.lat : 10, Math.max(5, Math.min(2e7, dir > 0 ? alt * 0.5 : alt * 2))));
      } catch (e) {}
    }
  }

  async function setScale(next) {
    scale = next; markChrome();
    try { localStorage.setItem('tm-scale', scale); } catch (e) {}
    if (scale === 'universe' || scale === 'solar') {
      destroyViews(); showSolar(true);
      setStatus(scale === 'universe' ? 'UNIVERSE · galaxies · black holes · Milky Way' : 'SOLAR SYSTEM · planets · comets · orbits', true);
      return;
    }
    showSolar(false); setStatus('LOADING ' + scale.toUpperCase() + '…', true);
    try {
      if (scale === 'earth') await enterEarth();
      else if (scale === 'moon' || scale === 'mars') await enterPlanet(scale);
      else await enterEarth();
    } catch (err) { console.error(err); setStatus('FAILED · ' + (err.message || err), false); }
  }

  injectChrome();
  try { scale = localStorage.getItem('tm-scale') || 'earth'; } catch (e) {}
  if (['moon', 'mars', 'solar', 'universe'].indexOf(scale) < 0) scale = 'earth';
  setStatus('STARTING…', true);
  setScale(scale);
  setInterval(function () { if (!activeWx.radar) updateTimeLabel(); }, 1000);
  window.TrackMeNowEngine = { name: 'TrackMeNow realtime', setScale: setScale, zoomBy: zoomBy, get scale() { return scale; } };
})();
