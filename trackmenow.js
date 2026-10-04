/* TrackMeNow — Universal 3D Geospatial Engine
 * Universe → Solar System → Earth / Moon / Mars (real surface tiles)
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const OG_VER = '0.28.7';
  const OG_JS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.es.js';
  const OG_CSS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.css';

  const PLANETS = [
    { id: 'sun', name: 'Sun', color: '#ffcc33', r: 28, au: 0, engine: null },
    { id: 'mercury', name: 'Mercury', color: '#b0b0b0', r: 5, au: 0.39, engine: null },
    { id: 'venus', name: 'Venus', color: '#e8c48a', r: 7, au: 0.72, engine: null },
    { id: 'earth', name: 'Earth', color: '#4aa3ff', r: 8, au: 1.0, engine: 'earth' },
    { id: 'moon', name: 'Moon', color: '#c8c8c8', r: 3, au: 1.08, engine: 'moon' },
    { id: 'mars', name: 'Mars', color: '#e07040', r: 6, au: 1.52, engine: 'mars' },
    { id: 'jupiter', name: 'Jupiter', color: '#d4a574', r: 18, au: 5.2, engine: null },
    { id: 'saturn', name: 'Saturn', color: '#e6d3a3', r: 15, au: 9.5, engine: null },
    { id: 'uranus', name: 'Uranus', color: '#7ec8e3', r: 11, au: 19.2, engine: null },
    { id: 'neptune', name: 'Neptune', color: '#4169e1', r: 10, au: 30.1, engine: null }
  ];

  let scale = 'solar';
  let activePlanet = 'earth';
  let globe = null;
  let og = null;
  let solarZoom = 1;
  let solarCanvas = null;
  let solarCtx = null;
  let animId = 0;

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
    setTimeout(function () { try { s.remove(); } catch (e) {} }, 600);
  }

  function ensureCss(href) {
    if (document.querySelector('link[data-og-css]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.setAttribute('data-og-css', '1');
    document.head.appendChild(l);
  }

  function injectChrome() {
    if ($('tm-universe-chrome')) return;
    const box = document.createElement('div');
    box.id = 'tm-universe-chrome';
    box.innerHTML = [
      '<div style="position:fixed;z-index:2100;left:50%;top:58px;transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:92vw;">',
      '  <button data-scale="universe" class="tm-scale-btn">Universe</button>',
      '  <button data-scale="solar" class="tm-scale-btn">Solar System</button>',
      '  <button data-scale="planet" class="tm-scale-btn">Planet</button>',
      '  <span style="width:8px"></span>',
      '  <button data-planet="earth" class="tm-planet-btn">Earth</button>',
      '  <button data-planet="moon" class="tm-planet-btn">Moon</button>',
      '  <button data-planet="mars" class="tm-planet-btn">Mars</button>',
      '</div>',
      '<div style="position:fixed;z-index:2100;right:14px;bottom:120px;display:flex;flex-direction:column;gap:6px;">',
      '  <button id="tm-zoom-in" style="width:40px;height:40px;font-size:20px;font-weight:900;">+</button>',
      '  <button id="tm-zoom-out" style="width:40px;height:40px;font-size:20px;font-weight:900;">−</button>',
      '  <button id="tm-zoom-home" style="width:40px;height:40px;font-size:12px;font-weight:800;">⌂</button>',
      '</div>',
      '<style>',
      '.tm-scale-btn,.tm-planet-btn,#tm-zoom-in,#tm-zoom-out,#tm-zoom-home{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui;padding:8px 12px;backdrop-filter:blur(10px);}',
      '.tm-scale-btn.on,.tm-planet-btn.on{border-color:#4fd0a0;color:#4fd0a0;box-shadow:0 0 12px #4fd0a044;}',
      '#tm-zoom-in:hover,#tm-zoom-out:hover,#tm-zoom-home:hover,.tm-scale-btn:hover,.tm-planet-btn:hover{background:rgba(69,168,255,.2);}',
      '#tm-solar-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010208;cursor:grab;z-index:2;}',
      '#tm-solar-canvas:active{cursor:grabbing;}',
      '#map canvas{pointer-events:auto!important;}',
      '</style>'
    ].join('');
    document.body.appendChild(box);
    box.querySelectorAll('[data-scale]').forEach(function (b) {
      b.onclick = function () { setScale(b.getAttribute('data-scale')); };
    });
    box.querySelectorAll('[data-planet]').forEach(function (b) {
      b.onclick = function () {
        activePlanet = b.getAttribute('data-planet');
        setScale('planet');
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
    document.querySelectorAll('[data-planet]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-planet') === activePlanet && scale === 'planet');
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
      c.addEventListener('wheel', onSolarWheel, { passive: false });
      let dragging = false, lx = 0, ly = 0, panX = 0, panY = 0;
      c._pan = function () { return { x: panX, y: panY }; };
      c._setPan = function (x, y) { panX = x; panY = y; };
      c.addEventListener('mousedown', function (e) { dragging = true; lx = e.clientX; ly = e.clientY; });
      window.addEventListener('mouseup', function () { dragging = false; });
      window.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        panX += e.clientX - lx; panY += e.clientY - ly; lx = e.clientX; ly = e.clientY;
      });
      c.addEventListener('click', onSolarClick);
    }
    return c;
  }

  function onSolarWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    zoomBy(e.deltaY > 0 ? -1 : 1);
  }

  function onSolarClick(e) {
    if (scale !== 'solar' && scale !== 'universe') return;
    if (!solarCanvas) return;
    const rect = solarCanvas.getBoundingClientRect();
    const hit = pickPlanet(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;
    if (hit.engine) { activePlanet = hit.engine; setScale('planet'); }
    else setStatus(hit.name + ' · surface map available for Earth / Moon / Mars', true);
  }

  function layoutPlanets(w, h) {
    const cx = w / 2 + (solarCanvas && solarCanvas._pan ? solarCanvas._pan().x : 0);
    const cy = h / 2 + (solarCanvas && solarCanvas._pan ? solarCanvas._pan().y : 0);
    const scalePx = Math.min(w, h) * 0.035 * solarZoom;
    return PLANETS.map(function (p) {
      const ang = (p.au || 0) * 0.85 + (performance.now() / 40000) * (p.au ? 1 / Math.sqrt(p.au) : 0);
      const dist = p.au * scalePx * 28;
      return { p: p, x: cx + Math.cos(ang) * dist, y: cy + Math.sin(ang) * dist * 0.55, rad: Math.max(3, p.r * solarZoom * (scale === 'universe' ? 0.6 : 1)) };
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
      if (dx * dx + dy * dy <= (o.rad + 8) * (o.rad + 8)) return o.p;
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
    ctx.fillStyle = scale === 'universe' ? '#000008' : '#010208';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < (scale === 'universe' ? 400 : 180); i++) {
      const sx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const sy = (Math.sin(i * 78.233) * 12345.678) % 1;
      ctx.globalAlpha = 0.25 + (i % 5) * 0.12;
      ctx.fillRect((sx < 0 ? sx + 1 : sx) * w, (sy < 0 ? sy + 1 : sy) * h, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
    const laid = layoutPlanets(w, h);
    const cx = w / 2 + (c._pan ? c._pan().x : 0), cy = h / 2 + (c._pan ? c._pan().y : 0);
    const scalePx = Math.min(w, h) * 0.035 * solarZoom;
    ctx.strokeStyle = 'rgba(100,140,180,0.25)'; ctx.lineWidth = 1;
    PLANETS.forEach(function (p) {
      if (!p.au) return;
      const dist = p.au * scalePx * 28;
      ctx.beginPath(); ctx.ellipse(cx, cy, dist, dist * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    });
    laid.forEach(function (o) {
      const g = ctx.createRadialGradient(o.x - o.rad * 0.3, o.y - o.rad * 0.3, 0, o.x, o.y, o.rad);
      g.addColorStop(0, '#fff8'); g.addColorStop(0.4, o.p.color); g.addColorStop(1, o.p.color + '88');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.rad, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#dce9f0'; ctx.font = '10px ui-monospace,monospace';
      ctx.fillText(o.p.name, o.x + o.rad + 4, o.y + 3);
    });
    ctx.fillStyle = 'rgba(180,200,220,0.7)'; ctx.font = '11px ui-monospace,monospace';
    ctx.fillText(scale === 'universe' ? 'UNIVERSE · scroll toward Sol' : 'SOLAR SYSTEM · click Earth / Moon / Mars', 12, h - 14);
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

  async function loadOg() {
    if (og) return og;
    ensureCss(OG_CSS);
    og = await import(/* webpackIgnore: true */ OG_JS);
    return og;
  }

  async function enterPlanet(planetId) {
    activePlanet = planetId || 'earth';
    showSolar(false);
    const mod = await loadOg();
    const Globe = mod.Globe, XYZ = mod.XYZ, LonLat = mod.LonLat, control = mod.control;
    const GlobusTerrain = mod.GlobusTerrain, EmptyTerrain = mod.EmptyTerrain, RgbTerrain = mod.RgbTerrain;
    const moonEll = mod.moon, marsEll = mod.mars, quadTreeStrategyType = mod.quadTreeStrategyType;

    const target = $('map');
    if (!target) throw new Error('#map missing');
    try { if (globe && globe.destroy) globe.destroy(); } catch (e) {}
    Array.from(target.children).forEach(function (ch) { if (ch.id !== 'tm-solar-canvas') ch.remove(); });

    let layers = [], terrain = null;
    const opts = { target: target, name: activePlanet, autoActivate: true, maxGridSize: 128 };

    if (activePlanet === 'moon') {
      layers = [new XYZ('Moon LRO', {
        isBaseLayer: true, pickingEnabled: false,
        url: 'https://{s}.terrain.openglobus.org/moon/sat/{z}/{x}/{y}.png',
        visibility: true, maxNativeZoom: 10,
        attribution: 'LRO Morphology Mosaic',
        diffuse: [1, 1, 1.2], ambient: [0.05, 0.05, 0.07]
      })];
      try {
        terrain = new RgbTerrain(null, {
          geoidSrc: null, maxZoom: 7,
          url: 'https://{s}.terrain.openglobus.org/moon/dem/{z}/{x}/{y}.png',
          heightFactor: 0.5, minHeight: -20000
        });
      } catch (e) { try { terrain = new EmptyTerrain(); } catch (e2) {} }
      opts.ellipsoid = moonEll;
      opts.atmosphereEnabled = false;
      opts.nightTextureSrc = null;
      opts.specularTextureSrc = null;
      opts.maxAltitude = 5841727;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    } else if (activePlanet === 'mars') {
      layers = [
        new XYZ('Mars-Viking', {
          isBaseLayer: true,
          url: 'https://terrain.openglobus.org/mars/sat/{z}/{x}/{y}.png',
          visibility: true, attribution: 'Mars Viking'
        }),
        new XYZ('Mars-ArcGIS', {
          isBaseLayer: true,
          url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/{z}/{y}/{x}?blankTile=false',
          visibility: false, attribution: 'ArcGIS OnMars'
        })
      ];
      try {
        terrain = new RgbTerrain('Mars', {
          geoidSrc: null, maxZoom: 8, maxNativeZoom: 8,
          url: 'https://{s}.terrain.openglobus.org/mars/dem/{z}/{x}/{y}.png',
          heightFactor: 1.1
        });
      } catch (e) { try { terrain = new EmptyTerrain(); } catch (e2) {} }
      opts.ellipsoid = marsEll;
      opts.atmosphereEnabled = true;
      opts.nightTextureSrc = null;
      opts.specularTextureSrc = null;
      opts.maxAltitude = 8100000;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    } else {
      layers = [
        new XYZ('Satellite', {
          isBaseLayer: true,
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          visibility: true, attribution: 'Esri'
        }),
        new XYZ('Dark', {
          isBaseLayer: true,
          url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          visibility: false
        })
      ];
      try { terrain = new GlobusTerrain(); } catch (e) { try { terrain = new EmptyTerrain(); } catch (e2) {} }
      opts.atmosphereEnabled = true;
      opts.maxAltitude = 50000000;
    }

    opts.terrain = terrain;
    opts.layers = layers;
    globe = new Globe(opts);
    window.globe = globe;

    try {
      const cam = globe.planet.camera;
      if (cam) { cam.minAltitude = 50; cam.maxAltitude = opts.maxAltitude || 5e7; }
    } catch (e) {}
    try {
      if (control && control.ZoomControl) globe.planet.addControl(new control.ZoomControl());
      if (control && control.LayerSwitcher) globe.planet.addControl(new control.LayerSwitcher());
    } catch (e) {}
    try {
      const alt = activePlanet === 'earth' ? 12000000 : activePlanet === 'mars' ? 6000000 : 2500000;
      if (globe.planet.camera.flyLonLat) globe.planet.camera.flyLonLat(new LonLat(0, 20, alt));
      else if (globe.planet.camera.setLonLat) globe.planet.camera.setLonLat(new LonLat(0, 20, alt));
    } catch (e) {}

    setStatus('PLANET · ' + activePlanet.toUpperCase() + ' · real surface', true);
    return globe;
  }

  function zoomPlanetAltitude(alt) {
    if (!globe || !og) return;
    try {
      const cam = globe.planet.camera;
      const LonLat = og.LonLat;
      let lon = 0, lat = 20;
      try { const ll = cam.getLonLat && cam.getLonLat(); if (ll) { lon = ll.lon; lat = ll.lat; } } catch (e) {}
      if (cam.flyLonLat) cam.flyLonLat(new LonLat(lon, lat, alt));
      else if (cam.setLonLat) cam.setLonLat(new LonLat(lon, lat, alt));
    } catch (e) {}
  }

  function getPlanetAltitude() {
    try {
      const ll = globe.planet.camera.getLonLat();
      return ll && ll.height != null ? ll.height : 1e7;
    } catch (e) { return 1e7; }
  }

  function zoomBy(dir) {
    if (scale === 'universe' || scale === 'solar') {
      solarZoom = Math.max(0.25, Math.min(4.5, solarZoom * (dir > 0 ? 1.18 : 0.85)));
      if (scale === 'universe' && solarZoom > 0.7) { setScale('solar'); return; }
      if (scale === 'solar' && solarZoom > 2.8) { activePlanet = 'earth'; setScale('planet'); return; }
      if (scale === 'solar' && solarZoom < 0.35) { setScale('universe'); return; }
      setStatus((scale === 'universe' ? 'UNIVERSE' : 'SOLAR') + ' · z ' + solarZoom.toFixed(2), true);
      return;
    }
    if (scale === 'planet' && globe) {
      const alt = getPlanetAltitude();
      const clamped = Math.max(80, Math.min(4.5e7, dir > 0 ? alt * 0.55 : alt * 1.85));
      zoomPlanetAltitude(clamped);
      if (clamped > 3.5e7) { setScale('solar'); solarZoom = 1.2; return; }
      setStatus('PLANET · ' + activePlanet.toUpperCase() + ' · ' + Math.round(clamped) + ' m', true);
    }
  }

  function zoomHome() {
    if (scale === 'planet') zoomPlanetAltitude(activePlanet === 'earth' ? 1.2e7 : 5e6);
    else { solarZoom = 1; if (solarCanvas && solarCanvas._setPan) solarCanvas._setPan(0, 0); }
    setStatus('RESET · ' + scale.toUpperCase(), true);
  }

  async function setScale(next) {
    scale = next;
    markChrome();
    try { localStorage.setItem('tm-scale', scale); localStorage.setItem('tm-planet', activePlanet); } catch (e) {}
    if (scale === 'universe' || scale === 'solar') {
      try { if (globe && globe.destroy) globe.destroy(); } catch (e) {}
      globe = null;
      showSolar(true);
      setStatus(scale === 'universe' ? 'UNIVERSE · scroll to Sol' : 'SOLAR SYSTEM · click Earth / Moon / Mars', true);
      return;
    }
    showSolar(false);
    setStatus('ENTERING ' + activePlanet.toUpperCase() + '…', true);
    try {
      await enterPlanet(activePlanet);
      closeSplash();
    } catch (err) {
      console.error(err);
      setStatus('PLANET FAILED · ' + (err.message || err), false);
      setScale('solar');
    }
  }

  injectChrome();
  try {
    scale = localStorage.getItem('tm-scale') || 'solar';
    activePlanet = localStorage.getItem('tm-planet') || 'earth';
  } catch (e) {}
  setStatus('STARTING UNIVERSAL 3D ENGINE…', true);
  setScale(scale === 'planet' ? 'planet' : 'solar').then(closeSplash).catch(function () { setScale('solar'); closeSplash(); });
  setTimeout(closeSplash, 5000);

  window.TrackMeNowEngine = {
    name: 'TrackMeNow Universal 3D',
    setScale: setScale,
    zoomBy: zoomBy,
    get scale() { return scale; },
    get planet() { return activePlanet; }
  };
})();
