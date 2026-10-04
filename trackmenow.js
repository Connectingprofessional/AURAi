/* TrackMeNow — Zoom.Earth-complete Live Earth + NASA Moon/Mars
 * LIVE: Satellite (NASA GIBS), Radar (RainViewer)
 * FORECAST: Precip / Wind / Temp / Humidity / Pressure (Open-Meteo)
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const OG_VER = '0.28.7';
  const OG_JS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.es.js';
  const OG_CSS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.css';

  const PLANETS = [
    { id: 'sun', name: 'Sun', color: '#FDB813', r: 30, au: 0, engine: null },
    { id: 'mercury', name: 'Mercury', color: '#B5B5B5', r: 5, au: 0.39, engine: null },
    { id: 'venus', name: 'Venus', color: '#E8CDA0', r: 7, au: 0.72, engine: null },
    { id: 'earth', name: 'Earth', color: '#3D8BFF', r: 8, au: 1.0, engine: 'earth' },
    { id: 'moon', name: 'Moon', color: '#C8C8C8', r: 3.2, au: 1.05, engine: 'moon' },
    { id: 'mars', name: 'Mars', color: '#C1440E', r: 6, au: 1.52, engine: 'mars' },
    { id: 'jupiter', name: 'Jupiter', color: '#C88B3A', r: 16, au: 5.2, engine: null },
    { id: 'saturn', name: 'Saturn', color: '#E6D3A3', r: 14, au: 9.5, engine: null },
    { id: 'uranus', name: 'Uranus', color: '#7EC8E3', r: 10, au: 19.2, engine: null },
    { id: 'neptune', name: 'Neptune', color: '#3F54BA', r: 9, au: 30.1, engine: null }
  ];

  let scale = 'earth';
  let globe = null, og = null, maplibre = null;
  let solarZoom = 1, solarCanvas = null, solarCtx = null, animId = 0;
  let liveDate = gibsDate(-1);
  let radarPath = null;
  let activeWx = { satellite: true, radar: false, precip: false, wind: false, temp: false, humidity: false, pressure: false };
  let forecastTimer = null;

  function gibsDate(offsetDays) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }

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
    setTimeout(function () { try { s.remove(); } catch (e) {} }, 500);
  }

  function ensureCss(href) {
    if (document.querySelector('link[data-og-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-og-css', '1');
    document.head.appendChild(l);
  }

  function injectChrome() {
    if ($('tm-universe-chrome')) return;
    const box = document.createElement('div');
    box.id = 'tm-universe-chrome';
    box.innerHTML = [
      '<div style="position:fixed;z-index:2100;left:50%;top:58px;transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:96vw">',
      '  <button data-scale="universe" class="tm-scale-btn">Universe</button>',
      '  <button data-scale="solar" class="tm-scale-btn">Solar System</button>',
      '  <button data-scale="earth" class="tm-scale-btn">Earth Live</button>',
      '  <button data-scale="moon" class="tm-scale-btn">Moon</button>',
      '  <button data-scale="mars" class="tm-scale-btn">Mars</button>',
      '</div>',
      '<div id="tm-ze-menu" style="display:none;position:fixed;z-index:2100;left:12px;top:100px;width:200px;padding:10px 0;border-radius:12px;background:rgba(30,22,20,.88);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);color:#f0e8e0;font:12px system-ui">',
      '  <div style="padding:4px 14px 8px;font-weight:800;letter-spacing:.6px;opacity:.7;font-size:10px">LIVE MAPS</div>',
      '  <button data-wx="satellite" class="tm-ze-item on">Satellite</button>',
      '  <button data-wx="radar" class="tm-ze-item">Radar</button>',
      '  <div style="padding:12px 14px 8px;font-weight:800;letter-spacing:.6px;opacity:.7;font-size:10px">FORECAST MAPS</div>',
      '  <button data-wx="precip" class="tm-ze-item">Precipitation</button>',
      '  <button data-wx="wind" class="tm-ze-item">Wind</button>',
      '  <button data-wx="temp" class="tm-ze-item">Temperature</button>',
      '  <button data-wx="humidity" class="tm-ze-item">Humidity</button>',
      '  <button data-wx="pressure" class="tm-ze-item">Pressure</button>',
      '</div>',
      '<div id="tm-wx-readout" style="display:none;position:fixed;z-index:2100;left:12px;bottom:56px;min-width:200px;max-width:280px;padding:10px 12px;border-radius:10px;background:rgba(8,14,20,.9);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px/1.4 ui-monospace,system-ui"></div>',
      '<div style="position:fixed;z-index:2100;right:14px;bottom:120px;display:flex;flex-direction:column;gap:6px">',
      '  <button id="tm-zoom-in" style="width:40px;height:40px;font-size:20px;font-weight:900">+</button>',
      '  <button id="tm-zoom-out" style="width:40px;height:40px;font-size:20px;font-weight:900">−</button>',
      '  <button id="tm-zoom-home" style="width:40px;height:40px;font-size:12px;font-weight:800">⌂</button>',
      '</div>',
      '<style>',
      '.tm-scale-btn,#tm-zoom-in,#tm-zoom-out,#tm-zoom-home{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui;padding:8px 12px;backdrop-filter:blur(10px)}',
      '.tm-scale-btn.on{border-color:#4fd0a0;color:#4fd0a0;box-shadow:0 0 12px #4fd0a044}',
      '.tm-ze-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:#f0e8e0;padding:9px 14px;cursor:pointer;font:600 13px system-ui}',
      '.tm-ze-item:hover{background:rgba(255,255,255,.08)}',
      '.tm-ze-item.on{background:rgba(255,255,255,.12);color:#fff;box-shadow:inset 3px 0 0 #4fd0a0}',
      '#tm-solar-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010208;cursor:grab;z-index:2}',
      '#map canvas{pointer-events:auto!important}',
      '</style>'
    ].join('');
    document.body.appendChild(box);
    box.querySelectorAll('[data-scale]').forEach(function (b) {
      b.onclick = function () { setScale(b.getAttribute('data-scale')); };
    });
    box.querySelectorAll('[data-wx]').forEach(function (b) {
      b.onclick = function () {
        const k = b.getAttribute('data-wx');
        activeWx[k] = !activeWx[k];
        b.classList.toggle('on', activeWx[k]);
        applyWeatherLayers();
        if (['temp', 'humidity', 'pressure', 'wind', 'precip'].indexOf(k) >= 0) refreshForecast();
      };
    });
    $('tm-zoom-in').onclick = function () { zoomBy(1); };
    $('tm-zoom-out').onclick = function () { zoomBy(-1); };
    $('tm-zoom-home').onclick = function () { zoomHome(); };
  }

  function markChrome() {
    document.querySelectorAll('[data-scale]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-scale') === scale);
    });
    const m = $('tm-ze-menu');
    const r = $('tm-wx-readout');
    if (m) m.style.display = scale === 'earth' ? 'block' : 'none';
    if (r) r.style.display = scale === 'earth' ? 'block' : 'none';
  }

  function ensureSolarCanvas() {
    const map = $('map');
    if (!map) return null;
    let c = $('tm-solar-canvas');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'tm-solar-canvas';
      map.appendChild(c);
      c.addEventListener('wheel', function (e) { e.preventDefault(); zoomBy(e.deltaY > 0 ? -1 : 1); }, { passive: false });
      let dragging = false, lx = 0, ly = 0, panX = 0, panY = 0;
      c._pan = function () { return { x: panX, y: panY }; };
      c._setPan = function (x, y) { panX = x; panY = y; };
      c.addEventListener('mousedown', function (e) { dragging = true; lx = e.clientX; ly = e.clientY; });
      window.addEventListener('mouseup', function () { dragging = false; });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        panX += e.clientX - lx; panY += e.clientY - ly; lx = e.clientX; ly = e.clientY;
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
      const ang = (p.au || 0) * 0.85 + (performance.now() / 50000) * (p.au ? 1 / Math.sqrt(Math.max(p.au, 0.1)) : 0);
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
    ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
    const laid = layoutPlanets(w, h);
    const cx = w / 2 + (c._pan ? c._pan().x : 0), cy = h / 2 + (c._pan ? c._pan().y : 0);
    const scalePx = Math.min(w, h) * 0.035 * solarZoom;
    ctx.strokeStyle = 'rgba(100,140,180,0.25)';
    PLANETS.forEach(function (p) {
      if (!p.au) return;
      const dist = p.au * scalePx * 28;
      ctx.beginPath(); ctx.ellipse(cx, cy, dist, dist * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    });
    laid.forEach(function (o) {
      ctx.fillStyle = o.p.color;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.rad, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#dce9f0'; ctx.font = '10px ui-monospace';
      ctx.fillText(o.p.name, o.x + o.rad + 4, o.y + 3);
    });
    animId = requestAnimationFrame(drawSolar);
  }

  function showSolar(show) {
    const c = ensureSolarCanvas();
    if (!c) return;
    solarCanvas = c; solarCtx = c.getContext('2d');
    c.style.display = show ? 'block' : 'none';
    if (show) { cancelAnimationFrame(animId); drawSolar(); }
    else cancelAnimationFrame(animId);
  }

  function destroyGlobe() {
    try { if (globe && globe.destroy) globe.destroy(); } catch (e) {}
    globe = null;
    try { if (maplibre) maplibre.remove(); } catch (e) {}
    maplibre = null;
    if (forecastTimer) { clearTimeout(forecastTimer); forecastTimer = null; }
    const target = $('map');
    if (target) {
      Array.from(target.children).forEach(function (ch) {
        if (ch.id !== 'tm-solar-canvas') ch.remove();
      });
    }
  }

  function applyWeatherLayers() {
    if (!maplibre) return;
    try {
      if (maplibre.getLayer('gibs-live'))
        maplibre.setLayoutProperty('gibs-live', 'visibility', activeWx.satellite ? 'visible' : 'none');
      if (maplibre.getLayer('radar'))
        maplibre.setLayoutProperty('radar', 'visibility', activeWx.radar ? 'visible' : 'none');
      if (maplibre.getLayer('forecast-circles')) {
        const any = activeWx.temp || activeWx.humidity || activeWx.pressure || activeWx.wind || activeWx.precip;
        maplibre.setLayoutProperty('forecast-circles', 'visibility', any ? 'visible' : 'none');
        paintForecastCircles();
      }
    } catch (e) {}
    updateReadout();
  }

  function paintForecastCircles() {
    if (!maplibre || !maplibre.getLayer('forecast-circles')) return;
    let prop = 'temp';
    if (activeWx.temp) prop = 'temp';
    else if (activeWx.humidity) prop = 'humidity';
    else if (activeWx.pressure) prop = 'pressure';
    else if (activeWx.wind) prop = 'wind';
    else if (activeWx.precip) prop = 'precip';
    maplibre.setPaintProperty('forecast-circles', 'circle-color', [
      'case',
      ['==', prop, 'temp'],
      ['interpolate', ['linear'], ['get', 'temp'], -20, '#4b6cb7', 0, '#6a9bd1', 15, '#f0d060', 35, '#e04040'],
      ['==', prop, 'humidity'],
      ['interpolate', ['linear'], ['get', 'humidity'], 0, '#d4a574', 50, '#7ec8e3', 100, '#3F54BA'],
      ['==', prop, 'pressure'],
      ['interpolate', ['linear'], ['get', 'pressure'], 980, '#e07040', 1013, '#90b0c0', 1040, '#4b6cb7'],
      ['==', prop, 'wind'],
      ['interpolate', ['linear'], ['get', 'wind'], 0, '#7ec8a0', 15, '#f0d060', 40, '#e04040'],
      ['interpolate', ['linear'], ['get', 'precip'], 0, '#334455', 2, '#4fd0a0', 10, '#3D8BFF', 30, '#9b59b6']
    ]);
  }

  async function loadRainViewerPath() {
    try {
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const j = await r.json();
      const frames = (j.radar && j.radar.past) || [];
      if (!frames.length) return null;
      return j.host + frames[frames.length - 1].path;
    } catch (e) { return null; }
  }

  async function refreshForecast() {
    if (!maplibre || scale !== 'earth') return;
    const any = activeWx.temp || activeWx.humidity || activeWx.pressure || activeWx.wind || activeWx.precip;
    if (!any) {
      if (maplibre.getSource('forecast')) maplibre.getSource('forecast').setData({ type: 'FeatureCollection', features: [] });
      updateReadout();
      return;
    }
    const c = maplibre.getCenter();
    const z = maplibre.getZoom();
    const step = z < 2 ? 25 : z < 4 ? 12 : z < 6 ? 6 : 3;
    const points = [];
    for (let lat = Math.max(-55, c.lat - step * 2); lat <= Math.min(55, c.lat + step * 2); lat += step) {
      for (let lon = c.lng - step * 2; lon <= c.lng + step * 2; lon += step) {
        let L = lon;
        while (L > 180) L -= 360;
        while (L < -180) L += 360;
        points.push({ lat: lat, lon: L });
      }
    }
    const sample = points.slice(0, 16);
    const features = [];
    await Promise.all(sample.map(async function (p) {
      try {
        const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat.toFixed(2) +
          '&longitude=' + p.lon.toFixed(2) +
          '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,precipitation';
        const res = await fetch(u);
        const j = await res.json();
        const cur = j.current || {};
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: {
            temp: cur.temperature_2m,
            humidity: cur.relative_humidity_2m,
            pressure: cur.surface_pressure,
            wind: cur.wind_speed_10m,
            precip: cur.precipitation
          }
        });
      } catch (e) {}
    }));
    if (maplibre.getSource('forecast')) {
      maplibre.getSource('forecast').setData({ type: 'FeatureCollection', features: features });
    }
    paintForecastCircles();
    updateReadout();
  }

  function updateReadout() {
    const el = $('tm-wx-readout');
    if (!el || !maplibre) return;
    const c = maplibre.getCenter();
    el.innerHTML = '<div style="opacity:.65;font-size:9px;margin-bottom:4px">MAP CENTER · ' +
      c.lat.toFixed(2) + '°, ' + c.lng.toFixed(2) + '°</div><div id="tm-wx-vals">Loading…</div>';
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) +
      '&longitude=' + c.lng.toFixed(3) +
      '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,precipitation')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        const cur = j.current || {};
        const vals = el.querySelector('#tm-wx-vals');
        if (!vals) return;
        vals.innerHTML = [
          '<b>Temp</b> ' + (cur.temperature_2m != null ? cur.temperature_2m + ' °C' : '—'),
          '<b>Humidity</b> ' + (cur.relative_humidity_2m != null ? cur.relative_humidity_2m + ' %' : '—'),
          '<b>Pressure</b> ' + (cur.surface_pressure != null ? Math.round(cur.surface_pressure) + ' hPa' : '—'),
          '<b>Wind</b> ' + (cur.wind_speed_10m != null ? cur.wind_speed_10m + ' km/h' : '—'),
          '<b>Precip</b> ' + (cur.precipitation != null ? cur.precipitation + ' mm' : '—')
        ].join('<br>');
      })
      .catch(function () {
        const vals = el.querySelector('#tm-wx-vals');
        if (vals) vals.textContent = 'Weather unavailable';
      });
  }

  async function enterEarthLive() {
    destroyGlobe();
    showSolar(false);
    if (!window.maplibregl) throw new Error('MapLibre missing');

    liveDate = gibsDate(-1);
    radarPath = await loadRainViewerPath();

    const style = {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        basemap: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Esri'
        },
        gibs: {
          type: 'raster', tileSize: 256, maxzoom: 9,
          tiles: [
            'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' +
              liveDate + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'
          ],
          attribution: 'NASA GIBS / VIIRS'
        },
        labels: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Esri'
        },
        forecast: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
      },
      layers: [
        { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.3 } },
        { id: 'gibs-live', type: 'raster', source: 'gibs', paint: { 'raster-opacity': 0.92 } },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.8 } },
        {
          id: 'forecast-circles', type: 'circle', source: 'forecast',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 12, 'circle-color': '#4fd0a0', 'circle-opacity': 0.7,
            'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff88'
          }
        }
      ],
      fog: {
        color: '#0a1a28', 'high-color': '#1a3048', 'space-color': '#010308',
        'horizon-blend': 0.12, range: [0.6, 10]
      }
    };

    if (radarPath) {
      style.sources.radar = {
        type: 'raster', tileSize: 256, maxzoom: 12,
        tiles: [radarPath + '/256/{z}/{x}/{y}/2/1_1.png'],
        attribution: 'RainViewer'
      };
      style.layers.splice(2, 0, {
        id: 'radar', type: 'raster', source: 'radar',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.65 }
      });
    }

    maplibre = new maplibregl.Map({
      container: 'map', style: style, center: [20, 15], zoom: 1.8,
      minZoom: 0.5, maxZoom: 18, maxPitch: 70, attributionControl: false,
      canvasContextAttributes: { antialias: true }
    });
    window.map = maplibre;
    maplibre.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    maplibre.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    maplibre.on('load', function () {
      applyWeatherLayers();
      updateReadout();
      setStatus('EARTH LIVE · GIBS ' + liveDate + ' · all Zoom.Earth layers', true);
    });
    maplibre.on('moveend', function () {
      if (forecastTimer) clearTimeout(forecastTimer);
      forecastTimer = setTimeout(function () {
        updateReadout();
        if (activeWx.temp || activeWx.humidity || activeWx.pressure || activeWx.wind || activeWx.precip)
          refreshForecast();
      }, 400);
    });

    return maplibre;
  }

  async function loadOg() {
    if (og) return og;
    ensureCss(OG_CSS);
    og = await import(/* webpackIgnore: true */ OG_JS);
    return og;
  }

  async function enterOgPlanet(planetId) {
    destroyGlobe();
    showSolar(false);
    const mod = await loadOg();
    const Globe = mod.Globe, XYZ = mod.XYZ, LonLat = mod.LonLat, control = mod.control;
    const EmptyTerrain = mod.EmptyTerrain, RgbTerrain = mod.RgbTerrain;
    const moonEll = mod.moon, marsEll = mod.mars, quadTreeStrategyType = mod.quadTreeStrategyType;
    const target = $('map');
    let layers = [], terrain = null;
    const opts = { target: target, name: planetId, autoActivate: true, maxGridSize: 128 };

    if (planetId === 'moon') {
      layers = [new XYZ('LRO', {
        isBaseLayer: true,
        url: 'https://{s}.terrain.openglobus.org/moon/sat/{z}/{x}/{y}.png',
        visibility: true, maxNativeZoom: 10, attribution: 'NASA LRO'
      })];
      try {
        terrain = new RgbTerrain(null, {
          geoidSrc: null, maxZoom: 7,
          url: 'https://{s}.terrain.openglobus.org/moon/dem/{z}/{x}/{y}.png', heightFactor: 0.5
        });
      } catch (e) { terrain = new EmptyTerrain(); }
      opts.ellipsoid = moonEll;
      opts.atmosphereEnabled = false;
      opts.nightTextureSrc = null; opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    } else {
      layers = [
        new XYZ('OnMars MDIM', {
          isBaseLayer: true,
          url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/{z}/{y}/{x}?blankTile=false',
          visibility: true, attribution: 'ArcGIS OnMars / NASA'
        }),
        new XYZ('Mars Viking', {
          isBaseLayer: true,
          url: 'https://terrain.openglobus.org/mars/sat/{z}/{x}/{y}.png',
          visibility: false, attribution: 'Viking'
        })
      ];
      try {
        terrain = new RgbTerrain('Mars', {
          geoidSrc: null, maxZoom: 8,
          url: 'https://{s}.terrain.openglobus.org/mars/dem/{z}/{x}/{y}.png', heightFactor: 1.1
        });
      } catch (e) { try { terrain = new EmptyTerrain(); } catch (e2) { terrain = null; } }
      if (marsEll) opts.ellipsoid = marsEll;
      opts.atmosphereEnabled = false;
      opts.nightTextureSrc = null; opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    }

    opts.layers = layers;
    opts.terrain = terrain || new EmptyTerrain();
    globe = new Globe(opts);
    window.globe = globe;
    try {
      if (globe.planet.camera) {
        globe.planet.camera.minAltitude = 50;
        globe.planet.camera.maxAltitude = 8e6;
      }
      if (control && control.ZoomControl) globe.planet.addControl(new control.ZoomControl());
      if (control && control.LayerSwitcher) globe.planet.addControl(new control.LayerSwitcher());
      const alt = planetId === 'mars' ? 5e6 : 2.5e6;
      if (globe.planet.camera.flyLonLat) globe.planet.camera.flyLonLat(new LonLat(0, 10, alt));
    } catch (e) {}
    setStatus(planetId.toUpperCase() + ' · NASA mosaic', true);
  }

  function zoomBy(dir) {
    if (scale === 'universe' || scale === 'solar') {
      solarZoom = Math.max(0.25, Math.min(4.5, solarZoom * (dir > 0 ? 1.18 : 0.85)));
      if (scale === 'universe' && solarZoom > 0.7) { setScale('solar'); return; }
      if (scale === 'solar' && solarZoom > 2.8) { setScale('earth'); return; }
      if (scale === 'solar' && solarZoom < 0.35) { setScale('universe'); return; }
      return;
    }
    if (maplibre) {
      maplibre.easeTo({ zoom: Math.max(0.5, Math.min(18, maplibre.getZoom() + (dir > 0 ? 0.8 : -0.8))), duration: 250 });
      return;
    }
    if (globe && og) {
      try {
        const cam = globe.planet.camera;
        const LonLat = og.LonLat;
        const ll = cam.getLonLat && cam.getLonLat();
        const alt = (ll && ll.height) || 5e6;
        cam.flyLonLat(new LonLat(ll ? ll.lon : 0, ll ? ll.lat : 10, Math.max(80, Math.min(2e7, dir > 0 ? alt * 0.55 : alt * 1.85))));
      } catch (e) {}
    }
  }

  function zoomHome() {
    if (maplibre) maplibre.easeTo({ center: [20, 15], zoom: 1.8, pitch: 0, duration: 600 });
  }

  async function setScale(next) {
    scale = next;
    markChrome();
    try { localStorage.setItem('tm-scale', scale); } catch (e) {}
    if (scale === 'universe' || scale === 'solar') {
      destroyGlobe();
      showSolar(true);
      setStatus(scale === 'universe' ? 'UNIVERSE' : 'SOLAR SYSTEM', true);
      return;
    }
    showSolar(false);
    setStatus('LOADING ' + scale.toUpperCase() + '…', true);
    try {
      if (scale === 'earth') await enterEarthLive();
      else await enterOgPlanet(scale);
      closeSplash();
    } catch (err) {
      console.error(err);
      setStatus('FAILED · ' + (err.message || err), false);
    }
  }

  injectChrome();
  try { scale = localStorage.getItem('tm-scale') || 'earth'; } catch (e) {}
  if (scale === 'planet') scale = 'earth';
  setStatus('STARTING ZOOM.EARTH-COMPLETE ENGINE…', true);
  setScale(['moon', 'mars', 'solar', 'universe'].indexOf(scale) >= 0 ? scale : 'earth')
    .then(closeSplash)
    .catch(function () { setScale('earth'); closeSplash(); });
  setTimeout(closeSplash, 6000);

  window.TrackMeNowEngine = {
    name: 'TrackMeNow Zoom.Earth Complete',
    setScale: setScale,
    zoomBy: zoomBy,
    get scale() { return scale; }
  };
})();
