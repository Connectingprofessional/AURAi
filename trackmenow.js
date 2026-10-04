/* TrackMeNow Earth Live — Zoom.Earth-class
 * Satellite (Esri+GIBS), Radar (RainViewer 15-min frames),
 * Forecast (Open-Meteo), Storm tracks (NOAA NHC), time scrubber
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const OG_VER = '0.28.7';
  const OG_JS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.es.js';
  const OG_CSS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.css';

  const PLANETS = [
    { id: 'sun', name: 'Sun', color: '#FDB813', r: 28, au: 0, engine: null },
    { id: 'mercury', name: 'Mercury', color: '#B5B5B5', r: 5, au: 0.39, engine: null },
    { id: 'venus', name: 'Venus', color: '#E8CDA0', r: 7, au: 0.72, engine: null },
    { id: 'earth', name: 'Earth', color: '#3D8BFF', r: 8, au: 1.0, engine: 'earth' },
    { id: 'moon', name: 'Moon', color: '#C8C8C8', r: 3, au: 1.05, engine: 'moon' },
    { id: 'mars', name: 'Mars', color: '#C1440E', r: 6, au: 1.52, engine: 'mars' },
    { id: 'jupiter', name: 'Jupiter', color: '#C88B3A', r: 16, au: 5.2, engine: null },
    { id: 'saturn', name: 'Saturn', color: '#E6D3A3', r: 14, au: 9.5, engine: null },
    { id: 'uranus', name: 'Uranus', color: '#7EC8E3', r: 10, au: 19.2, engine: null },
    { id: 'neptune', name: 'Neptune', color: '#3F54BA', r: 9, au: 30.1, engine: null }
  ];

  let scale = 'earth';
  let globe = null, og = null, maplibre = null;
  let solarZoom = 1, solarCanvas = null, solarCtx = null, animId = 0;
  let activeWx = {
    satellite: true, live: true, dark: false, radar: false,
    precip: false, wind: false, temp: false, humidity: false, pressure: false, storms: true
  };
  let rvHost = '', rvFrames = [], rvIndex = 0, playTimer = null, playing = false;
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
    setTimeout(function () { try { s.remove(); } catch (e) {} }, 400);
  }

  function ensureCss(href) {
    if (document.querySelector('link[data-og-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-og-css', '1');
    document.head.appendChild(l);
  }

  function stripPlanet() {
    try {
      document.querySelectorAll('[data-scale="planet"],.tm-planet-btn,button[data-planet]').forEach(function (n) { n.remove(); });
      document.querySelectorAll('button').forEach(function (b) {
        if ((b.textContent || '').trim() === 'Planet') b.remove();
      });
    } catch (e) {}
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
      '<div id="tm-ze-menu" style="display:none;position:fixed;z-index:2200;left:12px;top:100px;width:210px;padding:10px 0;border-radius:12px;background:rgba(28,20,18,.9);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);color:#f0e8e0;font:12px system-ui">',
      '  <div style="padding:4px 14px 6px;font-weight:800;letter-spacing:.6px;opacity:.7;font-size:10px">LIVE MAPS</div>',
      '  <button data-wx="satellite" class="tm-ze-item on">Satellite</button>',
      '  <button data-wx="live" class="tm-ze-item on">Live clouds</button>',
      '  <button data-wx="dark" class="tm-ze-item">Dark</button>',
      '  <button data-wx="radar" class="tm-ze-item">Radar</button>',
      '  <button data-wx="storms" class="tm-ze-item on">Storm tracks</button>',
      '  <div style="padding:12px 14px 6px;font-weight:800;letter-spacing:.6px;opacity:.7;font-size:10px">FORECAST MAPS</div>',
      '  <button data-wx="precip" class="tm-ze-item">Precipitation</button>',
      '  <button data-wx="wind" class="tm-ze-item">Wind</button>',
      '  <button data-wx="temp" class="tm-ze-item">Temperature</button>',
      '  <button data-wx="humidity" class="tm-ze-item">Humidity</button>',
      '  <button data-wx="pressure" class="tm-ze-item">Pressure</button>',
      '</div>',
      '<div id="tm-timebar" style="display:none;position:fixed;z-index:2200;left:50%;bottom:52px;transform:translateX(-50%);min-width:280px;max-width:92vw;padding:8px 12px;border-radius:12px;background:rgba(8,12,18,.92);border:1px solid rgba(255,255,255,.15);backdrop-filter:blur(12px);color:#e8f0f6;font:11px ui-monospace,system-ui">',
      '  <div style="display:flex;align-items:center;gap:8px;justify-content:center">',
      '    <button id="tm-play" type="button" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(69,168,255,.2);color:#fff;cursor:pointer;font-size:14px">▶</button>',
      '    <button id="tm-prev" type="button" class="tm-tbtn">◀</button>',
      '    <div id="tm-time-label" style="min-width:120px;text-align:center;font-weight:700">—</div>',
      '    <button id="tm-next" type="button" class="tm-tbtn">▶</button>',
      '    <span style="opacity:.55;font-size:9px">~15 min frames</span>',
      '  </div>',
      '  <input id="tm-time-slider" type="range" min="0" max="0" value="0" style="width:100%;margin-top:6px">',
      '</div>',
      '<div id="tm-wx-readout" style="display:none;position:fixed;z-index:2200;left:12px;bottom:56px;min-width:200px;max-width:280px;padding:10px 12px;border-radius:10px;background:rgba(8,14,20,.9);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px/1.4 ui-monospace,system-ui"></div>',
      '<div style="position:fixed;z-index:2200;right:14px;bottom:120px;display:flex;flex-direction:column;gap:6px">',
      '  <button id="tm-zoom-in" class="tm-z">+</button>',
      '  <button id="tm-zoom-out" class="tm-z">−</button>',
      '  <button id="tm-zoom-home" class="tm-z" style="font-size:12px">⌂</button>',
      '</div>',
      '<style>',
      '.tm-scale-btn,.tm-z,.tm-tbtn{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui;padding:8px 12px}',
      '.tm-scale-btn.on{border-color:#4fd0a0;color:#4fd0a0;box-shadow:0 0 12px #4fd0a044}',
      '.tm-z{width:40px;height:40px;font-size:20px;font-weight:900;padding:0}',
      '.tm-tbtn{width:32px;height:32px;padding:0;border-radius:8px}',
      '.tm-ze-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:#f0e8e0;padding:9px 14px;cursor:pointer;font:600 13px system-ui}',
      '.tm-ze-item:hover{background:rgba(255,255,255,.08)}',
      '.tm-ze-item.on{background:rgba(255,255,255,.12);color:#fff;box-shadow:inset 3px 0 0 #4fd0a0}',
      '#tm-solar-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010208;cursor:grab;z-index:2}',
      'button[data-scale="planet"],.tm-planet-btn{display:none!important}',
      '</style>'
    ].join('');
    document.body.appendChild(box);

    box.querySelectorAll('[data-scale]').forEach(function (b) {
      b.onclick = function () { setScale(b.getAttribute('data-scale')); };
    });
    box.querySelectorAll('[data-wx]').forEach(function (b) {
      b.onclick = function () {
        const k = b.getAttribute('data-wx');
        if (k === 'dark') {
          activeWx.dark = !activeWx.dark;
          if (activeWx.dark) { activeWx.satellite = true; activeWx.live = false; }
        } else if (k === 'satellite') {
          activeWx.satellite = !activeWx.satellite;
        } else if (k === 'live') {
          activeWx.live = !activeWx.live;
          if (activeWx.live) activeWx.dark = false;
        } else {
          activeWx[k] = !activeWx[k];
        }
        syncWxButtons();
        applyWeatherLayers();
        if (['temp', 'humidity', 'pressure', 'wind', 'precip'].indexOf(k) >= 0) refreshForecast();
        if (k === 'storms') loadStormTracks();
      };
    });
    $('tm-zoom-in').onclick = function () { zoomBy(1); };
    $('tm-zoom-out').onclick = function () { zoomBy(-1); };
    $('tm-zoom-home').onclick = function () { zoomHome(); };
    $('tm-play').onclick = togglePlay;
    $('tm-prev').onclick = function () { stepFrame(-1); };
    $('tm-next').onclick = function () { stepFrame(1); };
    $('tm-time-slider').oninput = function () {
      rvIndex = parseInt(this.value, 10) || 0;
      applyRadarFrame();
      updateTimeLabel();
    };
  }

  function syncWxButtons() {
    document.querySelectorAll('[data-wx]').forEach(function (b) {
      const k = b.getAttribute('data-wx');
      b.classList.toggle('on', !!activeWx[k]);
    });
  }

  function markChrome() {
    document.querySelectorAll('[data-scale]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-scale') === scale);
    });
    const show = scale === 'earth';
    ['tm-ze-menu', 'tm-timebar', 'tm-wx-readout'].forEach(function (id) {
      const el = $(id);
      if (el) el.style.display = show ? 'block' : 'none';
    });
    stripPlanet();
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
    stopPlay();
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

  async function loadRainViewer() {
    try {
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const j = await r.json();
      rvHost = j.host || 'https://tilecache.rainviewer.com';
      rvFrames = (j.radar && j.radar.past) || [];
      if (j.radar && j.radar.nowcast) rvFrames = rvFrames.concat(j.radar.nowcast);
      rvIndex = Math.max(0, rvFrames.length - 1);
      const slider = $('tm-time-slider');
      if (slider) {
        slider.max = Math.max(0, rvFrames.length - 1);
        slider.value = rvIndex;
      }
      updateTimeLabel();
      return true;
    } catch (e) {
      rvFrames = [];
      return false;
    }
  }

  function framePath(i) {
    if (!rvFrames.length) return null;
    const f = rvFrames[Math.max(0, Math.min(rvFrames.length - 1, i))];
    return rvHost + f.path;
  }

  function updateTimeLabel() {
    const el = $('tm-time-label');
    if (!el) return;
    if (!rvFrames.length) {
      el.textContent = gibsDate(-1);
      return;
    }
    const f = rvFrames[rvIndex];
    const d = new Date((f.time || 0) * 1000);
    el.textContent = d.toUTCString().replace('GMT', 'UTC').slice(5, 22);
  }

  function applyRadarFrame() {
    if (!maplibre || !maplibre.getSource) return;
    const path = framePath(rvIndex);
    if (!path) return;
    try {
      if (maplibre.getSource('radar')) {
        maplibre.getSource('radar').setTiles([path + '/256/{z}/{x}/{y}/2/1_1.png']);
      }
    } catch (e) {}
  }

  function stepFrame(dir) {
    if (!rvFrames.length) return;
    rvIndex = Math.max(0, Math.min(rvFrames.length - 1, rvIndex + dir));
    const slider = $('tm-time-slider');
    if (slider) slider.value = rvIndex;
    applyRadarFrame();
    updateTimeLabel();
  }

  function togglePlay() {
    if (playing) stopPlay();
    else startPlay();
  }

  function startPlay() {
    if (!rvFrames.length) return;
    playing = true;
    const btn = $('tm-play');
    if (btn) btn.textContent = '⏸';
    playTimer = setInterval(function () {
      if (rvIndex >= rvFrames.length - 1) rvIndex = 0;
      else rvIndex++;
      const slider = $('tm-time-slider');
      if (slider) slider.value = rvIndex;
      applyRadarFrame();
      updateTimeLabel();
    }, 600);
  }

  function stopPlay() {
    playing = false;
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    const btn = $('tm-play');
    if (btn) btn.textContent = '▶';
  }

  function applyWeatherLayers() {
    if (!maplibre) return;
    try {
      if (maplibre.getLayer('basemap'))
        maplibre.setLayoutProperty('basemap', 'visibility', activeWx.dark ? 'none' : 'visible');
      if (maplibre.getLayer('dark-base'))
        maplibre.setLayoutProperty('dark-base', 'visibility', activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('gibs-live'))
        maplibre.setLayoutProperty('gibs-live', 'visibility', activeWx.live && !activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('radar'))
        maplibre.setLayoutProperty('radar', 'visibility', activeWx.radar ? 'visible' : 'none');
      if (maplibre.getLayer('storm-tracks'))
        maplibre.setLayoutProperty('storm-tracks', 'visibility', activeWx.storms ? 'visible' : 'none');
      if (maplibre.getLayer('storm-points'))
        maplibre.setLayoutProperty('storm-points', 'visibility', activeWx.storms ? 'visible' : 'none');
      if (maplibre.getLayer('forecast-circles')) {
        const any = activeWx.temp || activeWx.humidity || activeWx.pressure || activeWx.wind || activeWx.precip;
        maplibre.setLayoutProperty('forecast-circles', 'visibility', any ? 'visible' : 'none');
        paintForecast();
      }
    } catch (e) {}
    updateReadout();
  }

  function paintForecast() {
    if (!maplibre || !maplibre.getLayer('forecast-circles')) return;
    let prop = 'temp';
    if (activeWx.temp) prop = 'temp';
    else if (activeWx.humidity) prop = 'humidity';
    else if (activeWx.pressure) prop = 'pressure';
    else if (activeWx.wind) prop = 'wind';
    else if (activeWx.precip) prop = 'precip';
    maplibre.setPaintProperty('forecast-circles', 'circle-color', [
      'case',
      ['==', prop, 'temp'], ['interpolate', ['linear'], ['get', 'temp'], -20, '#4b6cb7', 0, '#6a9bd1', 15, '#f0d060', 35, '#e04040'],
      ['==', prop, 'humidity'], ['interpolate', ['linear'], ['get', 'humidity'], 0, '#d4a574', 50, '#7ec8e3', 100, '#3F54BA'],
      ['==', prop, 'pressure'], ['interpolate', ['linear'], ['get', 'pressure'], 980, '#e07040', 1013, '#90b0c0', 1040, '#4b6cb7'],
      ['==', prop, 'wind'], ['interpolate', ['linear'], ['get', 'wind'], 0, '#7ec8a0', 15, '#f0d060', 40, '#e04040'],
      ['interpolate', ['linear'], ['get', 'precip'], 0, '#334455', 2, '#4fd0a0', 10, '#3D8BFF', 30, '#9b59b6']
    ]);
  }

  async function refreshForecast() {
    if (!maplibre || scale !== 'earth') return;
    const any = activeWx.temp || activeWx.humidity || activeWx.pressure || activeWx.wind || activeWx.precip;
    if (!any) {
      if (maplibre.getSource('forecast')) maplibre.getSource('forecast').setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const c = maplibre.getCenter();
    const z = maplibre.getZoom();
    const step = z < 2 ? 25 : z < 4 ? 12 : 6;
    const points = [];
    for (let lat = Math.max(-55, c.lat - step * 2); lat <= Math.min(55, c.lat + step * 2); lat += step) {
      for (let lon = c.lng - step * 2; lon <= c.lng + step * 2; lon += step) {
        let L = lon;
        while (L > 180) L -= 360;
        while (L < -180) L += 360;
        points.push({ lat: lat, lon: L });
      }
    }
    const features = [];
    await Promise.all(points.slice(0, 16).map(async function (p) {
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
            temp: cur.temperature_2m, humidity: cur.relative_humidity_2m,
            pressure: cur.surface_pressure, wind: cur.wind_speed_10m, precip: cur.precipitation
          }
        });
      } catch (e) {}
    }));
    if (maplibre.getSource('forecast')) {
      maplibre.getSource('forecast').setData({ type: 'FeatureCollection', features: features });
    }
    paintForecast();
  }

  function updateReadout() {
    const el = $('tm-wx-readout');
    if (!el || !maplibre) return;
    const c = maplibre.getCenter();
    el.innerHTML = '<div style="opacity:.65;font-size:9px;margin-bottom:4px">CENTER · ' +
      c.lat.toFixed(2) + '°, ' + c.lng.toFixed(2) + '°</div><div id="tm-wx-vals">…</div>';
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
      }).catch(function () {});
  }

  async function loadStormTracks() {
    if (!maplibre) return;
    try {
      const url = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer/6/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=200';
      const res = await fetch(url);
      const gj = await res.json();
      if (maplibre.getSource('storms')) {
        maplibre.getSource('storms').setData(gj && gj.features ? gj : { type: 'FeatureCollection', features: [] });
      }
    } catch (e) {
      console.warn('storm tracks', e);
    }
  }

  async function enterEarthLive() {
    destroyGlobe();
    showSolar(false);
    if (!window.maplibregl) throw new Error('MapLibre missing');

    await loadRainViewer();
    const date = gibsDate(-1);
    const radarTile = framePath(rvIndex);

    const style = {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        basemap: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Esri World Imagery'
        },
        dark: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Esri Dark'
        },
        gibs: {
          type: 'raster', tileSize: 256, maxzoom: 9,
          tiles: [
            'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' +
              date + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'
          ],
          attribution: 'NASA GIBS VIIRS'
        },
        labels: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Esri'
        },
        forecast: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        storms: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
      },
      layers: [
        { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } },
        { id: 'dark-base', type: 'raster', source: 'dark', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1 } },
        { id: 'gibs-live', type: 'raster', source: 'gibs', paint: { 'raster-opacity': 0.55 } },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.9 } },
        {
          id: 'storm-tracks', type: 'line', source: 'storms',
          filter: ['in', '$type', 'LineString', 'MultiLineString'],
          paint: { 'line-color': '#ff9a3c', 'line-width': 3, 'line-opacity': 0.9 }
        },
        {
          id: 'storm-points', type: 'circle', source: 'storms',
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 6,
            'circle-color': [
              'interpolate', ['linear'], ['coalesce', ['get', 'MAXWIND'], ['get', 'maxwind'], 30],
              30, '#4fd0a0', 50, '#f0d060', 64, '#ff9a3c', 96, '#e04040'
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff'
          }
        },
        {
          id: 'forecast-circles', type: 'circle', source: 'forecast',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 11, 'circle-color': '#4fd0a0', 'circle-opacity': 0.7,
            'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff88'
          }
        }
      ],
      fog: {
        color: '#0a1a28', 'high-color': '#1a3048', 'space-color': '#010308',
        'horizon-blend': 0.1, range: [0.5, 12]
      }
    };

    if (radarTile) {
      style.sources.radar = {
        type: 'raster', tileSize: 256, maxzoom: 12,
        tiles: [radarTile + '/256/{z}/{x}/{y}/2/1_1.png'],
        attribution: 'RainViewer'
      };
      style.layers.splice(3, 0, {
        id: 'radar', type: 'raster', source: 'radar',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.7 }
      });
    }

    maplibre = new maplibregl.Map({
      container: 'map', style: style, center: [0, 15], zoom: 1.6,
      minZoom: 0.4, maxZoom: 18, maxPitch: 70, attributionControl: false,
      canvasContextAttributes: { antialias: true }
    });
    window.map = maplibre;
    maplibre.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    maplibre.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    maplibre.on('load', function () {
      applyWeatherLayers();
      updateReadout();
      loadStormTracks();
      setStatus('EARTH LIVE · satellite + time scrubber (~15 min) · storms', true);
    });
    maplibre.on('error', function () {
      setStatus('Tile warning · basemap still active', true);
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
      layers = [new XYZ('OnMars', {
        isBaseLayer: true,
        url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/{z}/{y}/{x}?blankTile=false',
        visibility: true, attribution: 'NASA / ArcGIS OnMars'
      })];
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
      const alt = planetId === 'mars' ? 5e6 : 2.5e6;
      if (globe.planet.camera.flyLonLat) globe.planet.camera.flyLonLat(new LonLat(0, 10, alt));
    } catch (e) {}
    setStatus(planetId.toUpperCase() + ' · NASA mosaic', true);
  }

  function zoomBy(dir) {
    if (scale === 'universe' || scale === 'solar') {
      solarZoom = Math.max(0.25, Math.min(4.5, solarZoom * (dir > 0 ? 1.18 : 0.85)));
      if (scale === 'universe' && solarZoom > 0.7) setScale('solar');
      else if (scale === 'solar' && solarZoom > 2.8) setScale('earth');
      else if (scale === 'solar' && solarZoom < 0.35) setScale('universe');
      return;
    }
    if (maplibre) {
      maplibre.easeTo({ zoom: Math.max(0.4, Math.min(18, maplibre.getZoom() + (dir > 0 ? 0.8 : -0.8))), duration: 250 });
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
    if (maplibre) maplibre.easeTo({ center: [0, 15], zoom: 1.6, pitch: 0, duration: 600 });
  }

  async function setScale(next) {
    if (next === 'planet') next = 'earth';
    scale = next;
    markChrome();
    try { localStorage.setItem('tm-scale', scale); } catch (e) {}
    if (scale === 'universe' || scale === 'solar') {
      destroyGlobe();
      showSolar(true);
      setStatus(scale.toUpperCase(), true);
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
  stripPlanet();
  try { scale = localStorage.getItem('tm-scale') || 'earth'; } catch (e) {}
  if (scale === 'planet') scale = 'earth';
  setStatus('STARTING…', true);
  setScale(['moon', 'mars', 'solar', 'universe'].indexOf(scale) >= 0 ? scale : 'earth')
    .then(closeSplash)
    .catch(function () { setScale('earth'); closeSplash(); });
  setTimeout(closeSplash, 5000);
  setTimeout(stripPlanet, 1500);

  window.TrackMeNowEngine = {
    name: 'TrackMeNow Zoom.Earth-class',
    setScale: setScale,
    zoomBy: zoomBy,
    get scale() { return scale; }
  };
})();
