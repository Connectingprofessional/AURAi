/* TrackMeNow — Live Earth (Zoom.Earth-style) + NASA Moon/Mars
 * Earth: GIBS near-real-time true color + RainViewer radar
 * Moon/Mars: NASA-lineage mosaics | no Planet tab
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
  let activePlanet = 'earth';
  let globe = null, og = null, maplibre = null;
  let solarZoom = 1, solarCanvas = null, solarCtx = null, animId = 0;
  let liveDate = gibsDate(-1);

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
      '<div id="tm-weather-bar" style="position:fixed;z-index:2100;left:14px;top:110px;display:none;flex-direction:column;gap:6px;max-width:200px">',
      '  <button data-wx="live" class="tm-wx-btn on">Satellite Live</button>',
      '  <button data-wx="radar" class="tm-wx-btn">Radar / Rain</button>',
      '  <button data-wx="labels" class="tm-wx-btn on">Labels</button>',
      '  <div style="font:9px ui-monospace;color:#8ab;padding:4px 2px">GIBS / RainViewer · near real-time sky</div>',
      '</div>',
      '<div style="position:fixed;z-index:2100;right:14px;bottom:120px;display:flex;flex-direction:column;gap:6px">',
      '  <button id="tm-zoom-in" style="width:40px;height:40px;font-size:20px;font-weight:900">+</button>',
      '  <button id="tm-zoom-out" style="width:40px;height:40px;font-size:20px;font-weight:900">−</button>',
      '  <button id="tm-zoom-home" style="width:40px;height:40px;font-size:12px;font-weight:800">⌂</button>',
      '</div>',
      '<style>',
      '.tm-scale-btn,.tm-wx-btn,#tm-zoom-in,#tm-zoom-out,#tm-zoom-home{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui;padding:8px 12px;backdrop-filter:blur(10px);text-align:left}',
      '.tm-scale-btn.on,.tm-wx-btn.on{border-color:#4fd0a0;color:#4fd0a0;box-shadow:0 0 12px #4fd0a044}',
      '#tm-zoom-in:hover,#tm-zoom-out:hover,#tm-zoom-home:hover,.tm-scale-btn:hover,.tm-wx-btn:hover{background:rgba(69,168,255,.22)}',
      '#tm-solar-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010208;cursor:grab;z-index:2}',
      '#map canvas{pointer-events:auto!important}',
      '</style>'
    ].join('');
    document.body.appendChild(box);
    box.querySelectorAll('[data-scale]').forEach(function (b) {
      b.onclick = function () { setScale(b.getAttribute('data-scale')); };
    });
    box.querySelectorAll('[data-wx]').forEach(function (b) {
      b.onclick = function () { b.classList.toggle('on'); applyWeatherLayers(); };
    });
    $('tm-zoom-in').onclick = function () { zoomBy(1); };
    $('tm-zoom-out').onclick = function () { zoomBy(-1); };
    $('tm-zoom-home').onclick = function () { zoomHome(); };
  }

  function markChrome() {
    document.querySelectorAll('[data-scale]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-scale') === scale);
    });
    const wx = $('tm-weather-bar');
    if (wx) wx.style.display = scale === 'earth' ? 'flex' : 'none';
  }

  function wxOn(id) {
    const b = document.querySelector('[data-wx="' + id + '"]');
    return b && b.classList.contains('on');
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
    if (!solarCanvas || !solarCtx) return;
    if (scale !== 'solar' && scale !== 'universe') return;
    const c = solarCanvas, ctx = solarCtx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== (w * dpr | 0) || c.height !== (h * dpr | 0)) { c.width = w * dpr | 0; c.height = h * dpr | 0; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#010208';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 200; i++) {
      const sx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const sy = (Math.sin(i * 78.233) * 12345.678) % 1;
      ctx.globalAlpha = 0.25 + (i % 5) * 0.1;
      ctx.fillRect((sx < 0 ? sx + 1 : sx) * w, (sy < 0 ? sy + 1 : sy) * h, 1, 1);
    }
    ctx.globalAlpha = 1;
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
      if (maplibre.getLayer('gibs-live')) maplibre.setLayoutProperty('gibs-live', 'visibility', wxOn('live') ? 'visible' : 'none');
      if (maplibre.getLayer('radar')) maplibre.setLayoutProperty('radar', 'visibility', wxOn('radar') ? 'visible' : 'none');
      if (maplibre.getLayer('labels')) maplibre.setLayoutProperty('labels', 'visibility', wxOn('labels') ? 'visible' : 'none');
    } catch (e) {}
  }

  async function loadRainViewerPath() {
    try {
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const j = await r.json();
      const frames = (j.radar && j.radar.past) || [];
      if (!frames.length) return null;
      const last = frames[frames.length - 1];
      return j.host + last.path;
    } catch (e) { return null; }
  }

  async function enterEarthLive() {
    destroyGlobe();
    showSolar(false);
    if (!window.maplibregl) throw new Error('MapLibre missing');

    liveDate = gibsDate(-1);
    const radarHostPath = await loadRainViewerPath();

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
        }
      },
      layers: [
        { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.35 } },
        { id: 'gibs-live', type: 'raster', source: 'gibs', paint: { 'raster-opacity': 0.92 } },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } }
      ],
      fog: {
        color: '#0a1a28', 'high-color': '#1a3048', 'space-color': '#010308',
        'horizon-blend': 0.12, range: [0.6, 10]
      }
    };

    if (radarHostPath) {
      style.sources.radar = {
        type: 'raster', tileSize: 256, maxzoom: 12,
        tiles: [radarHostPath + '/256/{z}/{x}/{y}/2/1_1.png'],
        attribution: 'RainViewer'
      };
      style.layers.push({
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
      setStatus('EARTH LIVE · NASA GIBS ' + liveDate + ' · clouds & sky · Zoom.Earth-style', true);
    });

    setInterval(function () {
      if (scale !== 'earth' || !maplibre) return;
      const d = gibsDate(-1);
      if (d === liveDate) return;
      liveDate = d;
      try {
        if (maplibre.getSource('gibs')) {
          maplibre.getSource('gibs').setTiles([
            'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' +
              liveDate + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'
          ]);
        }
      } catch (e) {}
    }, 3600000);

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
    activePlanet = planetId;
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
          url: 'https://{s}.terrain.openglobus.org/moon/dem/{z}/{x}/{y}.png',
          heightFactor: 0.5
        });
      } catch (e) { terrain = new EmptyTerrain(); }
      opts.ellipsoid = moonEll;
      opts.atmosphereEnabled = false;
      opts.nightTextureSrc = null;
      opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
      opts.maxAltitude = 5e6;
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
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
      opts.maxAltitude = 8e6;
    }

    opts.layers = layers;
    opts.terrain = terrain || new EmptyTerrain();
    globe = new Globe(opts);
    window.globe = globe;
    try {
      if (globe.planet.camera) {
        globe.planet.camera.minAltitude = 50;
        globe.planet.camera.maxAltitude = opts.maxAltitude || 1e7;
      }
    } catch (e) {}
    try {
      if (control && control.ZoomControl) globe.planet.addControl(new control.ZoomControl());
      if (control && control.LayerSwitcher) globe.planet.addControl(new control.LayerSwitcher());
    } catch (e) {}
    try {
      const alt = planetId === 'mars' ? 5e6 : 2.5e6;
      if (globe.planet.camera.flyLonLat) globe.planet.camera.flyLonLat(new LonLat(0, 10, alt));
    } catch (e) {}
    setStatus(planetId.toUpperCase() + ' · NASA mosaic · zoom +/-', true);
  }

  function zoomBy(dir) {
    if (scale === 'universe' || scale === 'solar') {
      solarZoom = Math.max(0.25, Math.min(4.5, solarZoom * (dir > 0 ? 1.18 : 0.85)));
      if (scale === 'universe' && solarZoom > 0.7) { setScale('solar'); return; }
      if (scale === 'solar' && solarZoom > 2.8) { setScale('earth'); return; }
      if (scale === 'solar' && solarZoom < 0.35) { setScale('universe'); return; }
      setStatus(scale.toUpperCase() + ' · z ' + solarZoom.toFixed(2), true);
      return;
    }
    if (maplibre) {
      const z = maplibre.getZoom();
      maplibre.easeTo({ zoom: Math.max(0.5, Math.min(18, z + (dir > 0 ? 0.8 : -0.8))), duration: 250 });
      return;
    }
    if (globe && og) {
      try {
        const cam = globe.planet.camera;
        const LonLat = og.LonLat;
        const ll = cam.getLonLat && cam.getLonLat();
        const alt = (ll && ll.height) || 5e6;
        const next = Math.max(80, Math.min(2e7, dir > 0 ? alt * 0.55 : alt * 1.85));
        cam.flyLonLat(new LonLat(ll ? ll.lon : 0, ll ? ll.lat : 10, next));
      } catch (e) {}
    }
  }

  function zoomHome() {
    if (maplibre) maplibre.easeTo({ center: [20, 15], zoom: 1.8, pitch: 0, duration: 600 });
    else if (scale === 'solar' || scale === 'universe') {
      solarZoom = 1;
      if (solarCanvas && solarCanvas._setPan) solarCanvas._setPan(0, 0);
    }
  }

  async function setScale(next) {
    scale = next;
    if (next === 'earth' || next === 'moon' || next === 'mars') activePlanet = next;
    markChrome();
    try { localStorage.setItem('tm-scale', scale); } catch (e) {}

    if (scale === 'universe' || scale === 'solar') {
      destroyGlobe();
      showSolar(true);
      setStatus(scale === 'universe' ? 'UNIVERSE' : 'SOLAR SYSTEM · click Earth/Moon/Mars', true);
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
      if (scale !== 'earth') {
        try { await enterEarthLive(); scale = 'earth'; markChrome(); } catch (e2) {}
      }
    }
  }

  injectChrome();
  try { scale = localStorage.getItem('tm-scale') || 'earth'; } catch (e) {}
  if (scale === 'planet') scale = 'earth';
  setStatus('STARTING LIVE EARTH ENGINE…', true);
  setScale(scale === 'moon' || scale === 'mars' || scale === 'solar' || scale === 'universe' ? scale : 'earth')
    .then(closeSplash)
    .catch(function () { setScale('earth'); closeSplash(); });
  setTimeout(closeSplash, 6000);

  window.TrackMeNowEngine = {
    name: 'TrackMeNow Live Earth + NASA Planets',
    setScale: setScale,
    zoomBy: zoomBy,
    get scale() { return scale; }
  };
})();
