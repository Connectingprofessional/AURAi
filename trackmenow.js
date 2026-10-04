/* TrackMeNow — day scrubber + continuous weather heatmaps */
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
  let dayNight = false;
  let openDrawer = null;
  let globe = null, og = null, maplibre = null;
  let solarZoom = 1, solarCanvas = null, solarCtx = null, animId = 0;
  let activeWx = {
    satellite: true, live: true, radar: false, dark: false,
    precip: false, wind: false, temp: false, humidity: false, pressure: false,
    events: true, quakes: true, fires: false
  };
  let rvHost = '', rvFrames = [], rvIndex = 0, playTimer = null, playing = false;
  let terminatorTimer = null, forecastTimer = null;
  let gibsDayOffset = -1;

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
    return { lon: 15 * (12 - utcH), lat: decl };
  }

  function normalizeLon(lon) {
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return lon;
  }

  function terminatorFeatures(date) {
    const sun = sunLonLat(date);
    const steps = 90;
    function offsetRing(deltaHa) {
      const r = [];
      for (let i = 0; i <= steps; i++) {
        const lat = -90 + (180 * i) / steps;
        const latRad = lat * Math.PI / 180;
        const sunLatRad = sun.lat * Math.PI / 180;
        let cosHA = -Math.tan(latRad) * Math.tan(sunLatRad);
        if (!isFinite(cosHA)) cosHA = 0;
        cosHA = Math.max(-1, Math.min(1, cosHA));
        const ha = Math.acos(cosHA) * 180 / Math.PI + deltaHa;
        r.push([normalizeLon(sun.lon + ha), lat]);
      }
      for (let i = steps; i >= 0; i--) {
        const lat = -90 + (180 * i) / steps;
        const latRad = lat * Math.PI / 180;
        const sunLatRad = sun.lat * Math.PI / 180;
        let cosHA = -Math.tan(latRad) * Math.tan(sunLatRad);
        if (!isFinite(cosHA)) cosHA = 0;
        cosHA = Math.max(-1, Math.min(1, cosHA));
        const ha = Math.acos(cosHA) * 180 / Math.PI + deltaHa;
        r.push([normalizeLon(sun.lon - ha), lat]);
      }
      r.push(r[0]);
      return r;
    }
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { soft: 0 }, geometry: { type: 'Polygon', coordinates: [offsetRing(0)] } },
        { type: 'Feature', properties: { soft: 1 }, geometry: { type: 'Polygon', coordinates: [offsetRing(-4)] } },
        { type: 'Feature', properties: { soft: 2 }, geometry: { type: 'Polygon', coordinates: [offsetRing(-8)] } }
      ]
    };
  }

  function gibsDateStr() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + gibsDayOffset);
    return d.toISOString().slice(0, 10);
  }

  function updateTimeLabel() {
    const el = $('tm-time-label');
    if (!el) return;
    if (rvFrames.length && activeWx.radar) {
      const d = new Date((rvFrames[rvIndex].time || 0) * 1000);
      el.textContent = d.toISOString().slice(0, 16).replace('T', ' ');
      return;
    }
    el.textContent = gibsDateStr();
  }

  function applyGibsDay() {
    updateTimeLabel();
    if (!maplibre || scale !== 'earth') return;
    const date = gibsDateStr();
    const gibsUrl = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' +
      date + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg';
    const fireUrl = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/' +
      date + '/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';
    try {
      if (maplibre.getSource('gibs')) {
        maplibre.getSource('gibs').setTiles([gibsUrl]);
        if (maplibre.getLayer('gibs-live')) {
          const vis = activeWx.live && !activeWx.dark ? 'visible' : 'none';
          maplibre.setLayoutProperty('gibs-live', 'visibility', 'none');
          setTimeout(function () {
            try { maplibre.setLayoutProperty('gibs-live', 'visibility', vis); } catch (e) {}
          }, 30);
        }
      }
      if (maplibre.getSource('fires')) maplibre.getSource('fires').setTiles([fireUrl]);
      setStatus('EARTH · imagery ' + date, true);
    } catch (e) {
      console.warn('applyGibsDay', e);
      if (scale === 'earth') enterEarth();
    }
  }

  async function loadActivity() {
    if (!maplibre) return;
    if (activeWx.events) {
      try {
        const r = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=80');
        const j = await r.json();
        const feats = [];
        (j.events || []).forEach(function (ev) {
          const cats = (ev.categories || []).map(function (c) { return c.title; }).join(', ');
          (ev.geometry || []).forEach(function (g) {
            if (g.type === 'Point' && g.coordinates) {
              feats.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] },
                properties: { title: ev.title, category: cats }
              });
            }
          });
        });
        if (maplibre.getSource('eonet')) maplibre.getSource('eonet').setData({ type: 'FeatureCollection', features: feats });
      } catch (e) { console.warn('eonet', e); }
    } else if (maplibre.getSource('eonet')) {
      maplibre.getSource('eonet').setData({ type: 'FeatureCollection', features: [] });
    }
    if (activeWx.quakes) {
      try {
        const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
        const j = await r.json();
        if (maplibre.getSource('quakes')) maplibre.getSource('quakes').setData(j);
      } catch (e) { console.warn('quakes', e); }
    } else if (maplibre.getSource('quakes')) {
      maplibre.getSource('quakes').setData({ type: 'FeatureCollection', features: [] });
    }
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
      '  <button id="tm-play" type="button" class="tm-play" title="Play">▶</button>',
      '  <button id="tm-day-prev" type="button" class="tm-tbtn" title="Previous day">◀ day</button>',
      '  <button id="tm-prev" type="button" class="tm-tbtn" title="Previous frame">◀</button>',
      '  <div id="tm-time-label" style="min-width:130px;text-align:center;font-weight:700">—</div>',
      '  <button id="tm-next" type="button" class="tm-tbtn" title="Next frame">▶</button>',
      '  <button id="tm-day-next" type="button" class="tm-tbtn" title="Next day">day ▶</button>',
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
      '#tm-time-label{min-width:130px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}',
      '#tm-time-slider{width:160px}',
      '.tm-play{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(69,168,255,.25);color:#fff;cursor:pointer}',
      '.tm-tbtn{width:auto;min-width:32px;height:32px;padding:0 8px}',
      '#tm-wx-readout{position:fixed;z-index:2200;left:12px;bottom:90px;padding:10px 12px;border-radius:10px;background:rgba(8,14,20,.9);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace;max-width:240px}',
      '#tm-zoom-stack{position:fixed;z-index:2200;right:14px;bottom:100px;display:flex;flex-direction:column;gap:6px}',
      '.tm-z{width:40px;height:40px;font-size:20px;font-weight:900;padding:0}',
      '#tm-solar-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010208;cursor:grab;z-index:2}',
      '</style>'
    ].join('');
    document.body.appendChild(box);

    box.querySelectorAll('[data-scale]').forEach(function (b) {
      b.onclick = function () { setScale(b.getAttribute('data-scale')); };
    });
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
          syncDrawerItems();
          applyLayers();
          refreshForecast();
          return;
        }
        syncDrawerItems();
        applyLayers();
        if (k === 'events' || k === 'quakes') loadActivity();
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
    if ($('tm-day-prev')) $('tm-day-prev').onclick = function () {
      gibsDayOffset = Math.max(-14, gibsDayOffset - 1);
      applyGibsDay();
    };
    if ($('tm-day-next')) $('tm-day-next').onclick = function () {
      gibsDayOffset = Math.min(0, gibsDayOffset + 1);
      applyGibsDay();
    };
    document.addEventListener('click', function (e) {
      if (!openDrawer) return;
      const t = e.target;
      if (t.closest && (t.closest('.tm-drawer') || t.closest('[data-bar="live"]') || t.closest('[data-bar="weather"]'))) return;
      toggleDrawer(null);
    });
  }

  function toggleDrawer(which) {
    openDrawer = which;
    const live = $('tm-drawer-live');
    const wx = $('tm-drawer-weather');
    if (live) live.style.display = which === 'live' ? 'block' : 'none';
    if (wx) wx.style.display = which === 'weather' ? 'block' : 'none';
    syncBar();
  }

  function syncBar() {
    document.querySelectorAll('[data-bar]').forEach(function (b) {
      const k = b.getAttribute('data-bar');
      let on = false;
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
    document.querySelectorAll('[data-wx]').forEach(function (b) {
      b.classList.toggle('on', !!activeWx[b.getAttribute('data-wx')]);
    });
  }

  function markChrome() {
    document.querySelectorAll('[data-scale]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-scale') === scale);
    });
    const show = scale === 'earth';
    const bar = $('tm-bottom-bar');
    if (bar) bar.style.display = show ? 'flex' : 'none';
    ['tm-timebar', 'tm-wx-readout'].forEach(function (id) {
      const el = $(id);
      if (el) el.style.display = show ? (id === 'tm-timebar' ? 'flex' : 'block') : 'none';
    });
    if (!show) toggleDrawer(null);
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

  function destroyViews() {
    if (playing) { playing = false; if (playTimer) clearInterval(playTimer); playTimer = null; }
    if (terminatorTimer) { clearInterval(terminatorTimer); terminatorTimer = null; }
    if (forecastTimer) { clearTimeout(forecastTimer); forecastTimer = null; }
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

  function updateTime() { updateTimeLabel(); }

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

  function applyDayNight() {
    if (!maplibre) return;
    try {
      if (maplibre.getSource('terminator')) {
        maplibre.getSource('terminator').setData(dayNight ? terminatorFeatures(new Date()) : { type: 'FeatureCollection', features: [] });
      }
      ['night-0', 'night-1', 'night-2'].forEach(function (id) {
        if (maplibre.getLayer(id))
          maplibre.setLayoutProperty(id, 'visibility', dayNight ? 'visible' : 'none');
      });
    } catch (e) {}
  }

  function activeForecastMode() {
    if (activeWx.precip) return 'precip';
    if (activeWx.wind) return 'wind';
    if (activeWx.temp) return 'temp';
    if (activeWx.humidity) return 'humidity';
    if (activeWx.pressure) return 'pressure';
    return null;
  }

  function forecastScale(mode) {
    if (mode === 'precip') return { prop: 'precip', stops: [0, '#1a2332', 0.5, '#2ecc71', 2, '#3498db', 8, '#9b59b6', 20, '#e74c3c', 40, '#ffffff'], label: 'Precipitation mm' };
    if (mode === 'wind') return { prop: 'wind', stops: [0, '#0d2137', 15, '#1a6b8a', 40, '#2ecc71', 70, '#f1c40f', 110, '#e67e22', 160, '#c0392b'], label: 'Wind km/h' };
    if (mode === 'temp') return { prop: 'temp', stops: [-30, '#2c0a6b', -10, '#3d5a9e', 0, '#5b9bd5', 12, '#7dcea0', 22, '#f4d03f', 32, '#e67e22', 42, '#c0392b'], label: 'Temperature °C' };
    if (mode === 'humidity') return { prop: 'humidity', stops: [0, '#c9a66b', 30, '#a8c686', 55, '#5dade2', 80, '#3498db', 100, '#1a3a8a'], label: 'Humidity %' };
    if (mode === 'pressure') return { prop: 'pressure', stops: [970, '#2980b9', 990, '#5dade2', 1013, '#f5e6c8', 1030, '#e74c3c', 1045, '#922b21'], label: 'Pressure hPa' };
    return { prop: 'temp', stops: [0, '#888', 40, '#fff'], label: '' };
  }

  function paintForecast() {
    if (!maplibre) return;
    const mode = activeForecastMode();
    const leg = $('tm-wx-legend');
    if (!mode) {
      try {
        if (maplibre.getLayer('forecast-heat')) maplibre.setLayoutProperty('forecast-heat', 'visibility', 'none');
        if (maplibre.getLayer('forecast-circles')) maplibre.setLayoutProperty('forecast-circles', 'visibility', 'none');
        if (maplibre.getSource('forecast')) maplibre.getSource('forecast').setData({ type: 'FeatureCollection', features: [] });
      } catch (e) {}
      if (leg) leg.style.display = 'none';
      return;
    }
    const sc = forecastScale(mode);
    if (!window._fcGrid || !window._fcGrid.points) return;
    const features = [];
    window._fcGrid.points.forEach(function (p) {
      const v = p[sc.prop];
      if (v == null || isNaN(v)) return;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { v: v }
      });
    });
    try {
      if (maplibre.getSource('forecast')) maplibre.getSource('forecast').setData({ type: 'FeatureCollection', features: features });
      if (maplibre.getLayer('forecast-heat')) {
        maplibre.setLayoutProperty('forecast-heat', 'visibility', 'visible');
        maplibre.setPaintProperty('forecast-heat', 'heatmap-weight', [
          'interpolate', ['linear'], ['get', 'v'],
          sc.stops[0], 0.05,
          sc.stops[sc.stops.length - 2], 1
        ]);
        const dens = ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)'];
        const cols = [];
        for (let i = 1; i < sc.stops.length; i += 2) cols.push(sc.stops[i]);
        const steps = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
        for (let i = 0; i < cols.length && i < steps.length; i++) dens.push(steps[i], cols[i]);
        maplibre.setPaintProperty('forecast-heat', 'heatmap-color', dens);
      }
      if (maplibre.getLayer('forecast-circles')) {
        maplibre.setLayoutProperty('forecast-circles', 'visibility', 'visible');
        maplibre.setPaintProperty('forecast-circles', 'circle-color',
          ['interpolate', ['linear'], ['get', 'v']].concat(sc.stops));
        maplibre.setPaintProperty('forecast-circles', 'circle-opacity', 0.4);
        maplibre.setPaintProperty('forecast-circles', 'circle-radius', 16);
      }
    } catch (e) { console.warn(e); }
    if (leg) {
      leg.style.display = 'block';
      leg.textContent = sc.label + ' · Open-Meteo';
    }
  }

  async function refreshForecast() {
    if (!maplibre || scale !== 'earth') return;
    const mode = activeForecastMode();
    if (!mode) {
      window._fcGrid = null;
      paintForecast();
      return;
    }
    setStatus('Loading ' + mode + ' map…', true);
    const c = maplibre.getCenter();
    const z = maplibre.getZoom();
    const step = z < 2 ? 14 : z < 3.5 ? 9 : z < 5 ? 6 : 4;
    const pts = [];
    for (let lat = Math.max(-55, c.lat - step * 2.2); lat <= Math.min(70, c.lat + step * 2.2); lat += step) {
      for (let lon = c.lng - step * 3; lon <= c.lng + step * 3; lon += step) {
        let L = lon;
        while (L > 180) L -= 360;
        while (L < -180) L += 360;
        pts.push({ lat: +lat.toFixed(2), lon: +L.toFixed(2) });
      }
    }
    const limited = pts.slice(0, 48);
    const results = await Promise.all(limited.map(async function (p) {
      try {
        const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat +
          '&longitude=' + p.lon +
          '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_gusts_10m,precipitation';
        const j = await (await fetch(u)).json();
        const cur = j.current || {};
        return {
          lat: p.lat, lon: p.lon,
          temp: cur.temperature_2m,
          humidity: cur.relative_humidity_2m,
          pressure: cur.surface_pressure,
          wind: cur.wind_gusts_10m != null ? cur.wind_gusts_10m : cur.wind_speed_10m,
          precip: cur.precipitation
        };
      } catch (e) { return null; }
    }));
    window._fcGrid = { points: results.filter(Boolean) };
    paintForecast();
    setStatus('Weather · ' + mode, true);
  }

  function applyLayers() {
    if (!maplibre) return;
    try {
      if (maplibre.getLayer('sat'))
        maplibre.setLayoutProperty('sat', 'visibility', activeWx.dark ? 'none' : 'visible');
      if (maplibre.getLayer('dark'))
        maplibre.setLayoutProperty('dark', 'visibility', activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('gibs-live'))
        maplibre.setLayoutProperty('gibs-live', 'visibility', activeWx.live && !activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('radar'))
        maplibre.setLayoutProperty('radar', 'visibility', activeWx.radar ? 'visible' : 'none');
      if (maplibre.getLayer('fires-layer'))
        maplibre.setLayoutProperty('fires-layer', 'visibility', activeWx.fires ? 'visible' : 'none');
      if (maplibre.getLayer('eonet-pts'))
        maplibre.setLayoutProperty('eonet-pts', 'visibility', activeWx.events ? 'visible' : 'none');
      if (maplibre.getLayer('quakes-pts'))
        maplibre.setLayoutProperty('quakes-pts', 'visibility', activeWx.quakes ? 'visible' : 'none');
    } catch (e) {}
    applyDayNight();
    paintForecast();
    refreshWx();
    syncBar();
    syncDrawerItems();
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

  async function enterEarth() {
    destroyViews();
    showSolar(false);
    if (!window.maplibregl) throw new Error('MapLibre missing');
    await loadRV();
    const radarPath = rvFrames.length ? rvHost + rvFrames[rvIndex].path + '/256/{z}/{x}/{y}/2/1_1.png' : null;
    const useGlobe = earthMode === 'globe';
    const date = gibsDateStr();
    updateTimeLabel();

    const style = {
      version: 8,
      sources: {
        sat: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          attribution: 'Esri'
        },
        dark: {
          type: 'raster', tileSize: 256, maxzoom: 19,
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}']
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
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}']
        },
        terminator: {
          type: 'geojson',
          data: dayNight ? terminatorFeatures(new Date()) : { type: 'FeatureCollection', features: [] }
        },
        forecast: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        eonet: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        quakes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        fires: {
          type: 'raster', tileSize: 256, maxzoom: 8,
          tiles: [
            'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/' +
              date + '/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'
          ],
          attribution: 'NASA GIBS fires'
        }
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
        { id: 'gibs-live', type: 'raster', source: 'gibs', layout: { visibility: activeWx.live ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.55 } },
        {
          id: 'night-0', type: 'fill', source: 'terminator',
          filter: ['==', ['get', 'soft'], 0],
          layout: { visibility: dayNight ? 'visible' : 'none' },
          paint: { 'fill-color': '#00060f', 'fill-opacity': 0.22 }
        },
        {
          id: 'night-1', type: 'fill', source: 'terminator',
          filter: ['==', ['get', 'soft'], 1],
          layout: { visibility: dayNight ? 'visible' : 'none' },
          paint: { 'fill-color': '#00060f', 'fill-opacity': 0.28 }
        },
        {
          id: 'night-2', type: 'fill', source: 'terminator',
          filter: ['==', ['get', 'soft'], 2],
          layout: { visibility: dayNight ? 'visible' : 'none' },
          paint: { 'fill-color': '#00060f', 'fill-opacity': 0.35 }
        },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
        {
          id: 'forecast-heat', type: 'heatmap', source: 'forecast',
          layout: { visibility: 'none' },
          paint: {
            'heatmap-radius': 42,
            'heatmap-intensity': 1.4,
            'heatmap-opacity': 0.85,
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,0,0)',
              0.15, '#2980b9',
              0.35, '#2ecc71',
              0.55, '#f1c40f',
              0.75, '#e67e22',
              1, '#c0392b'
            ]
          }
        },
        {
          id: 'forecast-circles', type: 'circle', source: 'forecast',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': 14, 'circle-color': '#4fd0a0', 'circle-opacity': 0.35,
            'circle-stroke-width': 0
          }
        },
        {
          id: 'fires-layer', type: 'raster', source: 'fires',
          layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.85 }
        },
        {
          id: 'eonet-pts', type: 'circle', source: 'eonet',
          paint: {
            'circle-radius': 7, 'circle-color': '#ff6b35',
            'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9
          }
        },
        {
          id: 'quakes-pts', type: 'circle', source: 'quakes',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 2.5, 4, 5, 8, 7, 14],
            'circle-color': ['interpolate', ['linear'], ['get', 'mag'], 2.5, '#f0d060', 4.5, '#ff9a3c', 6, '#e04040'],
            'circle-stroke-width': 1, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85
          }
        }
      ]
    };

    if (useGlobe) {
      style.projection = { type: 'globe' };
      style.fog = {
        color: 'rgb(8, 16, 32)', 'high-color': 'rgb(25, 45, 75)',
        'space-color': 'rgb(1, 2, 6)', 'horizon-blend': 0.1, range: [0.5, 12]
      };
    }

    if (radarPath) {
      style.sources.radar = { type: 'raster', tileSize: 256, tiles: [radarPath], attribution: 'RainViewer' };
      style.layers.splice(3, 0, {
        id: 'radar', type: 'raster', source: 'radar',
        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.7 }
      });
    }

    maplibre = new maplibregl.Map({
      container: 'map', style: style, center: [20, 15],
      zoom: useGlobe ? 1.4 : 2, minZoom: useGlobe ? 0.5 : 1, maxZoom: 18,
      maxPitch: useGlobe ? 85 : 60, attributionControl: false, failIfMajorPerformanceCaveat: false
    });
    window.map = maplibre;
    maplibre.addControl(new maplibregl.NavigationControl({ visualizePitch: useGlobe }), 'bottom-right');

    maplibre.on('load', function () {
      try { maplibre.resize(); } catch (e) {}
      applyLayers();
      loadActivity();
      setStatus('EARTH · ' + (useGlobe ? '3D' : 'FLAT') + (dayNight ? ' · DAY/NIGHT' : '') + ' · live feeds', true);
      if (dayNight) terminatorTimer = setInterval(function () { applyDayNight(); }, 60000);
    });
    maplibre.on('moveend', function () {
      if (forecastTimer) clearTimeout(forecastTimer);
      forecastTimer = setTimeout(function () {
        refreshWx();
        if (activeForecastMode()) refreshForecast();
      }, 500);
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
        cam.flyLonLat(new LonLat(ll ? ll.lon : 0, ll ? ll.lat : 10, Math.max(80, Math.min(2e7, dir > 0 ? alt * 0.55 : alt * 1.85))));
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
    name: 'TrackMeNow realtime',
    setScale: setScale,
    zoomBy: zoomBy,
    get scale() { return scale; }
  };
})();
