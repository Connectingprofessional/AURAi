/* TrackMeNow — Earth: Flat / 3D Globe / Day-Night terminator + Moon + Mars + Universe */
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
  let earthMode = 'flat';
  let globe = null, og = null, maplibre = null;
  let solarZoom = 1, solarCanvas = null, solarCtx = null, animId = 0;
  let activeWx = { satellite: true, dark: false, radar: false };
  let rvHost = '', rvFrames = [], rvIndex = 0, playTimer = null, playing = false;
  let terminatorTimer = null;

  function setStatus(msg, ok) {
    const el = $('status');
    if (!el) return;
    el.innerHTML = '<span style="color:' + (ok === false ? '#ff6672' : '#43e0a0') + '">●</span> ' + msg;
  }

  function ensureCss(href) {
    if (document.querySelector('link[data-og-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-og-css', '1');
    document.head.appendChild(l);
  }

  function sunLonLat(date) {
    const d = date || new Date();
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const day = (d - start) / 86400000;
    const decl = 23.44 * Math.sin((2 * Math.PI / 365) * (day - 81));
    const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const lon = 15 * (12 - utcH);
    return { lon: lon, lat: decl };
  }

  function normalizeLon(lon) {
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return lon;
  }

  function terminatorGeoJSON(date) {
    const sun = sunLonLat(date);
    const coords = [];
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const lat = -90 + (180 * i) / steps;
      const latRad = lat * Math.PI / 180;
      const sunLatRad = sun.lat * Math.PI / 180;
      let cosHA = -Math.tan(latRad) * Math.tan(sunLatRad);
      cosHA = Math.max(-1, Math.min(1, cosHA));
      const ha = Math.acos(cosHA) * 180 / Math.PI;
      coords.push([normalizeLon(sun.lon - ha), lat]);
    }
    for (let i = steps; i >= 0; i--) {
      const lat = -90 + (180 * i) / steps;
      const latRad = lat * Math.PI / 180;
      const sunLatRad = sun.lat * Math.PI / 180;
      let cosHA = -Math.tan(latRad) * Math.tan(sunLatRad);
      cosHA = Math.max(-1, Math.min(1, cosHA));
      const ha = Math.acos(cosHA) * 180 / Math.PI;
      coords.push([normalizeLon(sun.lon + ha), lat]);
    }
    coords.push(coords[0]);
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: 'night' },
        geometry: { type: 'Polygon', coordinates: [coords] }
      }]
    };
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
      '<div id="tm-earth-modes" style="display:none;position:fixed;z-index:2200;left:50%;top:100px;transform:translateX(-50%);gap:6px;flex-wrap:wrap;justify-content:center">',
      '  <button data-emode="flat" class="tm-emode on">Flat</button>',
      '  <button data-emode="globe" class="tm-emode">3D Globe</button>',
      '  <button data-emode="terminator" class="tm-emode">Day / Night</button>',
      '</div>',
      '<div id="tm-ze-menu" style="display:none;position:fixed;z-index:2200;left:12px;top:140px;width:200px;padding:10px 0;border-radius:12px;background:rgba(28,20,18,.92);border:1px solid rgba(255,255,255,.12);color:#f0e8e0;font:12px system-ui">',
      '  <div style="padding:4px 14px;font-weight:800;opacity:.7;font-size:10px">LIVE MAPS</div>',
      '  <button data-wx="satellite" class="tm-ze-item on">Satellite</button>',
      '  <button data-wx="dark" class="tm-ze-item">Dark</button>',
      '  <button data-wx="radar" class="tm-ze-item">Radar</button>',
      '</div>',
      '<div id="tm-timebar" style="display:none;position:fixed;z-index:2200;left:50%;bottom:52px;transform:translateX(-50%);min-width:260px;padding:8px 12px;border-radius:12px;background:rgba(8,12,18,.92);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace">',
      '  <div style="display:flex;align-items:center;gap:8px;justify-content:center">',
      '    <button id="tm-play" type="button" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(69,168,255,.25);color:#fff;cursor:pointer">▶</button>',
      '    <button id="tm-prev" type="button" class="tm-tbtn">◀</button>',
      '    <div id="tm-time-label" style="min-width:110px;text-align:center;font-weight:700">—</div>',
      '    <button id="tm-next" type="button" class="tm-tbtn">▶</button>',
      '  </div>',
      '  <input id="tm-time-slider" type="range" min="0" max="0" value="0" style="width:100%;margin-top:6px">',
      '</div>',
      '<div id="tm-wx-readout" style="display:none;position:fixed;z-index:2200;left:12px;bottom:56px;padding:10px 12px;border-radius:10px;background:rgba(8,14,20,.9);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace"></div>',
      '<div style="position:fixed;z-index:2200;right:14px;bottom:120px;display:flex;flex-direction:column;gap:6px">',
      '  <button id="tm-zoom-in" class="tm-z">+</button>',
      '  <button id="tm-zoom-out" class="tm-z">−</button>',
      '  <button id="tm-zoom-home" class="tm-z" style="font-size:12px">⌂</button>',
      '</div>',
      '<style>',
      '.tm-scale-btn,.tm-emode,.tm-z,.tm-tbtn{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui;padding:8px 12px}',
      '.tm-scale-btn.on,.tm-emode.on{border-color:#4fd0a0;color:#4fd0a0;box-shadow:0 0 12px #4fd0a044}',
      '.tm-z{width:40px;height:40px;font-size:20px;font-weight:900;padding:0}',
      '.tm-tbtn{width:32px;height:32px;padding:0}',
      '.tm-ze-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:#f0e8e0;padding:9px 14px;cursor:pointer;font:600 13px system-ui}',
      '.tm-ze-item.on{background:rgba(255,255,255,.12);box-shadow:inset 3px 0 0 #4fd0a0}',
      '#tm-solar-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010208;cursor:grab;z-index:2}',
      '</style>'
    ].join('');
    document.body.appendChild(box);

    box.querySelectorAll('[data-scale]').forEach(function (b) {
      b.onclick = function () { setScale(b.getAttribute('data-scale')); };
    });
    box.querySelectorAll('[data-emode]').forEach(function (b) {
      b.onclick = function () {
        earthMode = b.getAttribute('data-emode');
        document.querySelectorAll('[data-emode]').forEach(function (x) {
          x.classList.toggle('on', x.getAttribute('data-emode') === earthMode);
        });
        if (scale === 'earth') enterEarth();
      };
    });
    box.querySelectorAll('[data-wx]').forEach(function (b) {
      b.onclick = function () {
        const k = b.getAttribute('data-wx');
        activeWx[k] = !activeWx[k];
        if (k === 'dark' && activeWx.dark) activeWx.satellite = true;
        if (k === 'satellite' && activeWx.satellite) activeWx.dark = false;
        document.querySelectorAll('[data-wx]').forEach(function (x) {
          x.classList.toggle('on', !!activeWx[x.getAttribute('data-wx')]);
        });
        applyLayers();
      };
    });
    $('tm-zoom-in').onclick = function () { zoomBy(1); };
    $('tm-zoom-out').onclick = function () { zoomBy(-1); };
    $('tm-zoom-home').onclick = function () {
      if (maplibre) maplibre.flyTo({ center: [20, 15], zoom: earthMode === 'globe' ? 1.5 : 2, duration: 800 });
    };
    $('tm-play').onclick = togglePlay;
    $('tm-prev').onclick = function () { stepFrame(-1); };
    $('tm-next').onclick = function () { stepFrame(1); };
    $('tm-time-slider').oninput = function () {
      rvIndex = parseInt(this.value, 10) || 0;
      applyRadar();
      updateTime();
    };
  }

  function markChrome() {
    document.querySelectorAll('[data-scale]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-scale') === scale);
    });
    const show = scale === 'earth';
    const modes = $('tm-earth-modes');
    if (modes) modes.style.display = show ? 'flex' : 'none';
    ['tm-ze-menu', 'tm-timebar', 'tm-wx-readout'].forEach(function (id) {
      const el = $(id);
      if (el) el.style.display = show ? 'block' : 'none';
    });
  }

  function ensureSolarCanvas() {
    const map = $('map');
    if (!map) return null;
    let c = $('tm-solar-canvas');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'tm-solar-canvas';
      map.appendChild(c);
      c.addEventListener('wheel', function (e) {
        e.preventDefault();
        zoomBy(e.deltaY > 0 ? -1 : 1);
      }, { passive: false });
      let dragging = false, lx = 0, ly = 0, panX = 0, panY = 0;
      c._pan = function () { return { x: panX, y: panY }; };
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
      return {
        p: p,
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist * 0.55,
        rad: Math.max(3, p.r * solarZoom * (scale === 'universe' ? 0.55 : 1))
      };
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
    if (c.width !== (w * dpr | 0) || c.height !== (h * dpr | 0)) {
      c.width = w * dpr | 0; c.height = h * dpr | 0;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#010208';
    ctx.fillRect(0, 0, w, h);
    const laid = layoutPlanets(w, h);
    const cx = w / 2 + (c._pan ? c._pan().x : 0);
    const cy = h / 2 + (c._pan ? c._pan().y : 0);
    const scalePx = Math.min(w, h) * 0.035 * solarZoom;
    ctx.strokeStyle = 'rgba(100,140,180,0.25)';
    PLANETS.forEach(function (p) {
      if (!p.au) return;
      const dist = p.au * scalePx * 28;
      ctx.beginPath();
      ctx.ellipse(cx, cy, dist, dist * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    laid.forEach(function (o) {
      ctx.fillStyle = o.p.color;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#dce9f0';
      ctx.font = '10px ui-monospace';
      ctx.fillText(o.p.name, o.x + o.rad + 4, o.y + 3);
    });
    animId = requestAnimationFrame(drawSolar);
  }

  function showSolar(show) {
    const c = ensureSolarCanvas();
    if (!c) return;
    solarCanvas = c;
    solarCtx = c.getContext('2d');
    c.style.display = show ? 'block' : 'none';
    if (show) { cancelAnimationFrame(animId); drawSolar(); }
    else cancelAnimationFrame(animId);
  }

  function destroyViews() {
    if (playing) { playing = false; if (playTimer) clearInterval(playTimer); playTimer = null; }
    if (terminatorTimer) { clearInterval(terminatorTimer); terminatorTimer = null; }
    try { if (globe && globe.destroy) globe.destroy(); } catch (e) {}
    globe = null;
    try { if (maplibre) maplibre.remove(); } catch (e) {}
    maplibre = null;
    const target = $('map');
    if (target) {
      Array.from(target.children).forEach(function (ch) {
        if (ch.id !== 'tm-solar-canvas') ch.remove();
      });
    }
  }

  async function loadRV() {
    try {
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const j = await r.json();
      rvHost = j.host || 'https://tilecache.rainviewer.com';
      rvFrames = (j.radar && j.radar.past) || [];
      rvIndex = Math.max(0, rvFrames.length - 1);
      const s = $('tm-time-slider');
      if (s) { s.max = Math.max(0, rvFrames.length - 1); s.value = rvIndex; }
      updateTime();
    } catch (e) { rvFrames = []; }
  }

  function updateTime() {
    const el = $('tm-time-label');
    if (!el) return;
    if (!rvFrames.length) {
      el.textContent = new Date().toISOString().slice(0, 16).replace('T', ' ');
      return;
    }
    const d = new Date((rvFrames[rvIndex].time || 0) * 1000);
    el.textContent = d.toUTCString().slice(5, 22);
  }

  function applyRadar() {
    if (!maplibre || !rvFrames.length) return;
    const path = rvHost + rvFrames[rvIndex].path + '/256/{z}/{x}/{y}/2/1_1.png';
    try {
      if (maplibre.getSource('radar')) maplibre.getSource('radar').setTiles([path]);
    } catch (e) {}
  }

  function stepFrame(d) {
    if (!rvFrames.length) return;
    rvIndex = Math.max(0, Math.min(rvFrames.length - 1, rvIndex + d));
    const s = $('tm-time-slider');
    if (s) s.value = rvIndex;
    applyRadar();
    updateTime();
  }

  function togglePlay() {
    if (playing) {
      playing = false;
      if (playTimer) clearInterval(playTimer);
      playTimer = null;
      if ($('tm-play')) $('tm-play').textContent = '▶';
      return;
    }
    if (!rvFrames.length) return;
    playing = true;
    if ($('tm-play')) $('tm-play').textContent = '⏸';
    playTimer = setInterval(function () {
      rvIndex = rvIndex >= rvFrames.length - 1 ? 0 : rvIndex + 1;
      if ($('tm-time-slider')) $('tm-time-slider').value = rvIndex;
      applyRadar();
      updateTime();
    }, 600);
  }

  function applyLayers() {
    if (!maplibre) return;
    try {
      if (maplibre.getLayer('sat'))
        maplibre.setLayoutProperty('sat', 'visibility', activeWx.dark ? 'none' : 'visible');
      if (maplibre.getLayer('dark'))
        maplibre.setLayoutProperty('dark', 'visibility', activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('radar'))
        maplibre.setLayoutProperty('radar', 'visibility', activeWx.radar ? 'visible' : 'none');
      if (maplibre.getLayer('night-shade'))
        maplibre.setLayoutProperty('night-shade', 'visibility', earthMode === 'terminator' ? 'visible' : 'none');
    } catch (e) {}
    refreshWx();
  }

  function refreshWx() {
    const el = $('tm-wx-readout');
    if (!el || !maplibre) return;
    const c = maplibre.getCenter();
    el.innerHTML = 'CENTER · ' + c.lat.toFixed(2) + ', ' + c.lng.toFixed(2) + '<br>…';
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) +
      '&longitude=' + c.lng.toFixed(3) +
      '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,precipitation')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        const cur = j.current || {};
        el.innerHTML = [
          'CENTER · ' + c.lat.toFixed(2) + '°, ' + c.lng.toFixed(2) + '°',
          '<b>Temp</b> ' + (cur.temperature_2m != null ? cur.temperature_2m + ' °C' : '—'),
          '<b>Humidity</b> ' + (cur.relative_humidity_2m != null ? cur.relative_humidity_2m + ' %' : '—'),
          '<b>Pressure</b> ' + (cur.surface_pressure != null ? Math.round(cur.surface_pressure) + ' hPa' : '—'),
          '<b>Wind</b> ' + (cur.wind_speed_10m != null ? cur.wind_speed_10m + ' km/h' : '—'),
          '<b>Precip</b> ' + (cur.precipitation != null ? cur.precipitation + ' mm' : '—')
        ].join('<br>');
      }).catch(function () {});
  }

  function updateTerminator() {
    if (!maplibre || !maplibre.getSource('terminator')) return;
    try {
      maplibre.getSource('terminator').setData(terminatorGeoJSON(new Date()));
    } catch (e) {}
  }

  async function enterEarth() {
    destroyViews();
    showSolar(false);
    if (!window.maplibregl) throw new Error('MapLibre missing');

    await loadRV();
    const radarPath = rvFrames.length
      ? rvHost + rvFrames[rvIndex].path + '/256/{z}/{x}/{y}/2/1_1.png'
      : null;

    const useGlobe = earthMode === 'globe';
    const useTerm = earthMode === 'terminator';

    const style = {
      version: 8,
      sources: {
        sat: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Esri World Imagery'
        },
        dark: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Esri Dark'
        },
        labels: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}']
        },
        terminator: {
          type: 'geojson',
          data: useTerm ? terminatorGeoJSON(new Date()) : { type: 'FeatureCollection', features: [] }
        }
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
        {
          id: 'night-shade',
          type: 'fill',
          source: 'terminator',
          layout: { visibility: useTerm ? 'visible' : 'none' },
          paint: {
            'fill-color': '#000818',
            'fill-opacity': 0.55,
            'fill-outline-color': '#4fd0a088'
          }
        },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } }
      ]
    };

    if (useGlobe) {
      style.projection = { type: 'globe' };
      style.fog = {
        color: 'rgb(10, 20, 40)',
        'high-color': 'rgb(30, 50, 80)',
        'space-color': 'rgb(1, 3, 8)',
        'horizon-blend': 0.08,
        range: [0.5, 10]
      };
    }

    if (radarPath) {
      style.sources.radar = {
        type: 'raster', tileSize: 256,
        tiles: [radarPath], attribution: 'RainViewer'
      };
      style.layers.splice(2, 0, {
        id: 'radar', type: 'raster', source: 'radar',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.7 }
      });
    }

    const mapOpts = {
      container: 'map',
      style: style,
      center: [20, 15],
      zoom: useGlobe ? 1.4 : 2,
      minZoom: useGlobe ? 0.5 : 1,
      maxZoom: 18,
      attributionControl: false,
      failIfMajorPerformanceCaveat: false
    };
    if (useGlobe) {
      mapOpts.pitch = 0;
      mapOpts.maxPitch = 85;
    }

    maplibre = new maplibregl.Map(mapOpts);
    window.map = maplibre;
    maplibre.addControl(new maplibregl.NavigationControl({ visualizePitch: useGlobe }), 'bottom-right');

    maplibre.on('load', function () {
      try { maplibre.resize(); } catch (e) {}
      applyLayers();
      const modeLabel = earthMode === 'globe' ? '3D GLOBE' : (earthMode === 'terminator' ? 'DAY / NIGHT' : 'FLAT');
      setStatus('EARTH · ' + modeLabel + ' · satellite', true);
      if (useTerm) {
        terminatorTimer = setInterval(updateTerminator, 60000);
      }
    });
    maplibre.on('moveend', function () { refreshWx(); });
    maplibre.on('error', function (e) {
      console.warn('maplibre', e && e.error);
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
    destroyViews();
    showSolar(false);
    const mod = await loadOg();
    const Globe = mod.Globe, XYZ = mod.XYZ, LonLat = mod.LonLat, control = mod.control;
    const EmptyTerrain = mod.EmptyTerrain, RgbTerrain = mod.RgbTerrain;
    const moonEll = mod.moon, marsEll = mod.mars;
    const quadTreeStrategyType = mod.quadTreeStrategyType;
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
          url: 'https://{s}.terrain.openglobus.org/moon/dem/{z}/{x}/{y}.png',
          heightFactor: 0.5
        });
      } catch (e) { terrain = new EmptyTerrain(); }
      opts.ellipsoid = moonEll;
      opts.atmosphereEnabled = false;
      opts.nightTextureSrc = null;
      opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi)
        opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    } else {
      layers = [new XYZ('OnMars', {
        isBaseLayer: true,
        url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/{z}/{y}/{x}?blankTile=false',
        visibility: true, attribution: 'NASA / ArcGIS OnMars'
      })];
      try {
        terrain = new RgbTerrain('Mars', {
          geoidSrc: null, maxZoom: 8,
          url: 'https://{s}.terrain.openglobus.org/mars/dem/{z}/{x}/{y}.png',
          heightFactor: 1.1
        });
      } catch (e) {
        try { terrain = new EmptyTerrain(); } catch (e2) { terrain = null; }
      }
      if (marsEll) opts.ellipsoid = marsEll;
      opts.atmosphereEnabled = false;
      opts.nightTextureSrc = null;
      opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi)
        opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
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
      if (globe.planet.camera.flyLonLat)
        globe.planet.camera.flyLonLat(new LonLat(0, 10, alt));
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
      maplibre.easeTo({
        zoom: Math.max(0.5, Math.min(18, maplibre.getZoom() + (dir > 0 ? 0.8 : -0.8))),
        duration: 250
      });
      return;
    }
    if (globe && og) {
      try {
        const cam = globe.planet.camera;
        const LonLat = og.LonLat;
        const ll = cam.getLonLat && cam.getLonLat();
        const alt = (ll && ll.height) || 5e6;
        cam.flyLonLat(new LonLat(
          ll ? ll.lon : 0,
          ll ? ll.lat : 10,
          Math.max(80, Math.min(2e7, dir > 0 ? alt * 0.55 : alt * 1.85))
        ));
      } catch (e) {}
    }
  }

  async function setScale(next) {
    scale = next;
    markChrome();
    try { localStorage.setItem('tm-scale', scale); } catch (e) {}

    if (scale === 'universe' || scale === 'solar') {
      destroyViews();
      showSolar(true);
      setStatus(scale.toUpperCase(), true);
      return;
    }

    showSolar(false);
    setStatus('LOADING ' + scale.toUpperCase() + '…', true);
    try {
      if (scale === 'earth') await enterEarth();
      else if (scale === 'moon' || scale === 'mars') await enterPlanet(scale);
      else await enterEarth();
    } catch (err) {
      console.error(err);
      setStatus('FAILED · ' + (err.message || err), false);
    }
  }

  injectChrome();
  try { scale = localStorage.getItem('tm-scale') || 'earth'; } catch (e) {}
  if (['moon', 'mars', 'solar', 'universe'].indexOf(scale) < 0) scale = 'earth';
  setStatus('STARTING…', true);
  setScale(scale);

  window.TrackMeNowEngine = {
    name: 'TrackMeNow Earth modes',
    setScale: setScale,
    zoomBy: zoomBy,
    get scale() { return scale; },
    get earthMode() { return earthMode; }
  };
})();
