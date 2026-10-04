/* TrackMeNow — working Earth satellite map (flat Esri) + layers */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  let scale = 'earth';
  let maplibre = null;
  let activeWx = { satellite: true, dark: false, radar: false, live: false, storms: false, precip: false, wind: false, temp: false, humidity: false, pressure: false };
  let rvHost = '', rvFrames = [], rvIndex = 0, playTimer = null, playing = false;

  function setStatus(msg, ok) {
    const el = $('status');
    if (!el) return;
    el.innerHTML = '<span style="color:' + (ok === false ? '#ff6672' : '#43e0a0') + '">●</span> ' + msg;
  }

  function injectChrome() {
    if ($('tm-universe-chrome')) return;
    const box = document.createElement('div');
    box.id = 'tm-universe-chrome';
    box.innerHTML = [
      '<div style="position:fixed;z-index:2200;left:50%;top:58px;transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center">',
      '  <button data-scale="earth" class="tm-scale-btn on">Earth Live</button>',
      '</div>',
      '<div id="tm-ze-menu" style="position:fixed;z-index:2200;left:12px;top:100px;width:200px;padding:10px 0;border-radius:12px;background:rgba(28,20,18,.9);border:1px solid rgba(255,255,255,.12);color:#f0e8e0;font:12px system-ui">',
      '  <div style="padding:4px 14px;font-weight:800;opacity:.7;font-size:10px">LIVE MAPS</div>',
      '  <button data-wx="satellite" class="tm-ze-item on">Satellite</button>',
      '  <button data-wx="dark" class="tm-ze-item">Dark</button>',
      '  <button data-wx="radar" class="tm-ze-item">Radar</button>',
      '  <div style="padding:12px 14px 4px;font-weight:800;opacity:.7;font-size:10px">FORECAST</div>',
      '  <button data-wx="temp" class="tm-ze-item">Temperature</button>',
      '  <button data-wx="wind" class="tm-ze-item">Wind</button>',
      '  <button data-wx="humidity" class="tm-ze-item">Humidity</button>',
      '  <button data-wx="pressure" class="tm-ze-item">Pressure</button>',
      '  <button data-wx="precip" class="tm-ze-item">Precipitation</button>',
      '</div>',
      '<div id="tm-timebar" style="position:fixed;z-index:2200;left:50%;bottom:52px;transform:translateX(-50%);min-width:260px;padding:8px 12px;border-radius:12px;background:rgba(8,12,18,.92);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace">',
      '  <div style="display:flex;align-items:center;gap:8px;justify-content:center">',
      '    <button id="tm-play" type="button" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(69,168,255,.25);color:#fff;cursor:pointer">▶</button>',
      '    <button id="tm-prev" type="button" class="tm-tbtn">◀</button>',
      '    <div id="tm-time-label" style="min-width:110px;text-align:center;font-weight:700">—</div>',
      '    <button id="tm-next" type="button" class="tm-tbtn">▶</button>',
      '  </div>',
      '  <input id="tm-time-slider" type="range" min="0" max="0" value="0" style="width:100%;margin-top:6px">',
      '</div>',
      '<div id="tm-wx-readout" style="position:fixed;z-index:2200;left:12px;bottom:56px;padding:10px 12px;border-radius:10px;background:rgba(8,14,20,.9);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace"></div>',
      '<div style="position:fixed;z-index:2200;right:14px;bottom:120px;display:flex;flex-direction:column;gap:6px">',
      '  <button id="tm-zoom-in" class="tm-z">+</button><button id="tm-zoom-out" class="tm-z">−</button><button id="tm-zoom-home" class="tm-z" style="font-size:12px">⌂</button>',
      '</div>',
      '<style>',
      '.tm-scale-btn,.tm-z,.tm-tbtn{border:1px solid rgba(255,255,255,.2);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui;padding:8px 12px}',
      '.tm-scale-btn.on{border-color:#4fd0a0;color:#4fd0a0}',
      '.tm-z{width:40px;height:40px;font-size:20px;font-weight:900;padding:0}',
      '.tm-tbtn{width:32px;height:32px;padding:0}',
      '.tm-ze-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:#f0e8e0;padding:9px 14px;cursor:pointer;font:600 13px system-ui}',
      '.tm-ze-item.on{background:rgba(255,255,255,.12);box-shadow:inset 3px 0 0 #4fd0a0}',
      '</style>'
    ].join('');
    document.body.appendChild(box);
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
        if (['temp','wind','humidity','pressure','precip'].indexOf(k) >= 0) refreshWx();
      };
    });
    $('tm-zoom-in').onclick = function () { if (maplibre) maplibre.zoomIn(); };
    $('tm-zoom-out').onclick = function () { if (maplibre) maplibre.zoomOut(); };
    $('tm-zoom-home').onclick = function () {
      if (maplibre) maplibre.flyTo({ center: [20, 15], zoom: 2, duration: 800 });
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
    if (!rvFrames.length) { el.textContent = new Date().toISOString().slice(0, 16).replace('T', ' '); return; }
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
    } catch (e) {}
    refreshWx();
  }

  function refreshWx() {
    const el = $('tm-wx-readout');
    if (!el || !maplibre) return;
    const c = maplibre.getCenter();
    el.innerHTML = 'CENTER · ' + c.lat.toFixed(2) + ', ' + c.lng.toFixed(2) + '<br>Loading…';
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
      }).catch(function () { el.textContent = 'Weather unavailable'; });
  }

  async function startMap() {
    if (!window.maplibregl) {
      setStatus('MapLibre missing', false);
      return;
    }
    await loadRV();
    const radarPath = rvFrames.length
      ? rvHost + rvFrames[rvIndex].path + '/256/{z}/{x}/{y}/2/1_1.png'
      : null;

    const style = {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tileSize: 256,
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          attribution: 'Esri'
        },
        dark: {
          type: 'raster',
          tileSize: 256,
          tiles: [
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
          ],
          attribution: 'Esri'
        },
        labels: {
          type: 'raster',
          tileSize: 256,
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
          ]
        }
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } }
      ]
    };

    if (radarPath) {
      style.sources.radar = {
        type: 'raster', tileSize: 256,
        tiles: [radarPath], attribution: 'RainViewer'
      };
      style.layers.push({
        id: 'radar', type: 'raster', source: 'radar',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.7 }
      });
    }

    try { if (maplibre) maplibre.remove(); } catch (e) {}

    maplibre = new maplibregl.Map({
      container: 'map',
      style: style,
      center: [20, 15],
      zoom: 2,
      minZoom: 1,
      maxZoom: 18,
      attributionControl: false
    });
    window.map = maplibre;
    maplibre.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    maplibre.on('load', function () {
      try { maplibre.resize(); } catch (e) {}
      applyLayers();
      setStatus('EARTH · satellite map ready', true);
    });
    maplibre.on('moveend', function () { refreshWx(); });
    setTimeout(function () { try { maplibre.resize(); } catch (e) {} }, 250);
    setTimeout(function () { try { maplibre.resize(); } catch (e) {} }, 1000);
  }

  injectChrome();
  setStatus('Loading Earth…', true);
  startMap();

  window.TrackMeNowEngine = { name: 'TrackMeNow Earth', get scale() { return scale; } };
})();
