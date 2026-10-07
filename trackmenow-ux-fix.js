/* TrackMeNow UX fix v9
 * Weather: remove duplicate DAY/MONTH/QUARTER inside panel; lighter overlays; live refresh
 * Cameras: public streams.geojson (worldwide webcams/traffic) — bbox filter
 * Transit: exclusive Air/Ship/Taxi… + real live-data (no simulation)
 * User media: file input for own image/video on map (local only)
 */
(function () {
  'use strict';

  var style = document.createElement('style');
  style.textContent = [
    '.tm-panel-body .tm-periods{display:none!important}',
    '.tm-panel-body .tm-timeline{display:none!important}',
    '#wx-overlay,canvas.wx-overlay,.tm-wx-canvas{opacity:0.45!important;pointer-events:none!important}',
    '#tm-user-media-btn{position:fixed;bottom:90px;left:14px;z-index:40;padding:8px 12px;',
    'background:#0d1a24;color:#edf4f8;border:1px solid #2a4a5c;border-radius:8px;cursor:pointer;font:600 12px system-ui}'
  ].join('');
  document.head.appendChild(style);

  function map() {
    try {
      if (window.TrackMeNowEngine && window.TrackMeNowEngine.getMap) return window.TrackMeNowEngine.getMap();
    } catch (e) {}
    return window.maplibre || window.map || null;
  }

  function setStatus(msg, ok) {
    var st = document.getElementById('status');
    if (!st) return;
    st.classList.add('tm-show');
    st.innerHTML = (ok ? '<span style="color:#43e0a0">\u25cf</span> ' : '<span style="color:#ffb347">\u25cf</span> ') + msg;
  }

  function patchTransport() {
    var eng = window.TrackMeNowEngine;
    if (!eng || eng.__tmUxTransit) return !!eng;
    eng.__tmUxTransit = true;

    eng.activateTransport = function (kind) {
      if (typeof eng.toggleTransport !== 'function') return false;
      ['air', 'ships', 'transit', 'rail', 'taxi', 'car', 'bike'].forEach(function (k) {
        if (eng.transportOn(k)) eng.toggleTransport(k);
      });
      if (!eng.transportOn(kind)) eng.toggleTransport(kind);
      setStatus('TRANSIT \u00b7 showing only ' + kind.toUpperCase() + ' (live feeds)', true);
      return true;
    };

    eng.showAllTransport = function () {
      ['air', 'ships', 'transit', 'rail'].forEach(function (k) {
        if (!eng.transportOn(k)) eng.toggleTransport(k);
      });
      setStatus('TRANSIT \u00b7 Air + Ships + Transit + Rail (live)', true);
      return true;
    };
    return true;
  }

  function stripSimulation() {
    document.querySelectorAll('button').forEach(function (b) {
      var t = (b.textContent || '').toUpperCase();
      if (t.indexOf('SIMULATION') >= 0 || t.indexOf('RUN TRANSPORT') >= 0 || t.indexOf('LOAD LIVE TRANSPORT') >= 0) {
        b.textContent = 'LOAD LIVE TRANSPORT';
        b.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          var eng = window.TrackMeNowEngine;
          if (eng && eng.showAllTransport) eng.showAllTransport();
          if (window.TrackMeNowLoadLiveData) window.TrackMeNowLoadLiveData();
          setStatus('TRANSIT \u00b7 loading live Air/Ships/Transit/Rail\u2026', true);
        };
      }
    });
  }

  var CAM_URL = 'https://raw.githubusercontent.com/willytop8/Live-Environment-Streams/main/streams.geojson';
  var camCache = null;
  var camCacheAt = 0;

  async function loadPublicCameras() {
    var m = map();
    if (!m) { setStatus('CAMERAS \u00b7 map not ready', false); return; }
    var b = m.getBounds();
    var minLon = b.getWest(), minLat = b.getSouth(), maxLon = b.getEast(), maxLat = b.getNorth();
    var padLon = Math.max(0.5, (maxLon - minLon) * 0.1);
    var padLat = Math.max(0.5, (maxLat - minLat) * 0.1);
    minLon -= padLon; maxLon += padLon; minLat -= padLat; maxLat += padLat;

    var now = Date.now();
    if (!camCache || now - camCacheAt > 10 * 60 * 1000) {
      setStatus('CAMERAS \u00b7 loading public webcam catalogue\u2026', true);
      try {
        var r = await fetch(CAM_URL + '?t=' + now, { cache: 'force-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        camCache = await r.json();
        camCacheAt = now;
      } catch (e) {
        setStatus('CAMERAS \u00b7 catalogue unavailable: ' + e.message, false);
        return;
      }
    }

    var feats = (camCache.features || []).filter(function (f) {
      var c = f.geometry && f.geometry.coordinates;
      if (!c) return false;
      return c[0] >= minLon && c[0] <= maxLon && c[1] >= minLat && c[1] <= maxLat;
    });
    if (feats.length > 2500) feats = feats.slice(0, 2500);

    var mapped = feats.map(function (f, i) {
      var p = f.properties || {};
      return {
        type: 'Feature',
        id: 'cam-' + i,
        geometry: f.geometry,
        properties: {
          title: p.display_name || p.name || 'Public camera',
          provider: p.source_family || p.environment || 'public',
          location: (p.country_code || '') + (p.scene_type ? ' \u00b7 ' + p.scene_type : ''),
          imageUrl: p.url || null,
          streamUrl: p.url || null,
          sourceUrl: p.url || null,
          observedAt: p.last_verified || null
        }
      };
    });

    if (!m.getSource('tm-cameras')) {
      m.addSource('tm-cameras', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!m.getLayer('tm-cameras')) {
      m.addLayer({
        id: 'tm-cameras',
        type: 'circle',
        source: 'tm-cameras',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 5, 14, 8],
          'circle-color': '#67d5ff',
          'circle-stroke-color': '#071018',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.9
        }
      });
      m.on('click', 'tm-cameras', function (e) {
        var f = e.features && e.features[0];
        var p = f && f.properties;
        if (!p) return;
        var u = p.imageUrl || p.streamUrl || p.sourceUrl;
        var html = '<b>' + String(p.title || 'PUBLIC CAMERA').replace(/[<>]/g, '') + '</b>' +
          '<div style="opacity:.65;font-size:11px;margin-top:4px">' + String(p.provider || '').replace(/[<>]/g, '') + '</div>' +
          '<div style="font-size:11px;margin-top:5px">' + String(p.location || '').replace(/[<>]/g, '') + '</div>' +
          (u ? '<button id="tm-open-camera" style="margin-top:8px">OPEN SOURCE</button>' : '');
        new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
          .setLngLat(e.lngLat).setHTML(html).addTo(m);
        setTimeout(function () {
          var btn = document.getElementById('tm-open-camera');
          if (btn && u) btn.onclick = function () { window.open(u, '_blank', 'noopener,noreferrer'); };
        }, 0);
      });
      m.on('mouseenter', 'tm-cameras', function () { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'tm-cameras', function () { m.getCanvas().style.cursor = ''; });
    }
    m.getSource('tm-cameras').setData({ type: 'FeatureCollection', features: mapped });
    m.setLayoutProperty('tm-cameras', 'visibility', mapped.length ? 'visible' : 'none');
    setStatus('CAMERAS \u00b7 ' + mapped.length.toLocaleString() + ' in view \u00b7 public streams catalogue', !!mapped.length);
  }

  var origFetch = window.fetch;
  if (!window.__tmCamFetch) {
    window.__tmCamFetch = true;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = origFetch.apply(this, arguments);
      if (!/\/api\/cameras\b/.test(url)) return p;
      return p.then(async function (res) {
        var clone = res.clone();
        var j = null;
        try { j = await clone.json(); } catch (e) { return res; }
        var n = ((j && j.features) || []).length;
        if (n >= 3) return res;
        await loadPublicCameras();
        var m = map();
        var src = m && m.getSource('tm-cameras');
        var data = src && src._data;
        var feats = (data && data.features) || [];
        return new Response(JSON.stringify({
          ok: true,
          type: 'FeatureCollection',
          features: feats,
          sources: [{ source: 'Live-Environment-Streams public GeoJSON', status: 'live', count: feats.length }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    };
  }

  function hookCameraButtons() {
    document.querySelectorAll('button').forEach(function (b) {
      var t = (b.textContent || '').toUpperCase();
      if (t.indexOf('LOAD LIVE CAMERA') >= 0) {
        b.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          loadPublicCameras();
        };
      }
    });
  }

  function lightenWeather() {
    var eng = window.TrackMeNowEngine;
    if (!eng || eng.__tmWxLight) return;
    eng.__tmWxLight = true;
    var orig = eng.selectWeather;
    if (typeof orig === 'function') {
      eng.selectWeather = function (key) {
        var r = orig.apply(this, arguments);
        setTimeout(function () {
          document.querySelectorAll('canvas').forEach(function (c) {
            if (c.width > 200 && c.style.position === 'absolute') {
              c.style.opacity = '0.4';
              c.style.pointerEvents = 'none';
            }
          });
        }, 300);
        return r;
      };
    }
  }

  function setupUserMedia() {
    if (document.getElementById('tm-user-media-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'tm-user-media-btn';
    btn.type = 'button';
    btn.textContent = 'Add my photo/video';
    btn.title = 'Pin your own image or video on the map (stays on this device)';
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.style.display = 'none';
    btn.onclick = function () { input.click(); };
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var m = map();
      if (!m) { setStatus('Map not ready', false); return; }
      var url = URL.createObjectURL(file);
      var c = m.getCenter();
      if (!m.getSource('tm-user-media')) {
        m.addSource('tm-user-media', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'tm-user-media',
          type: 'circle',
          source: 'tm-user-media',
          paint: { 'circle-radius': 8, 'circle-color': '#f472b6', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
        });
        m.on('click', 'tm-user-media', function (e) {
          var f = e.features && e.features[0];
          var p = f && f.properties;
          if (!p || !p.url) return;
          var isVid = (p.kind || '').indexOf('video') >= 0;
          var html = isVid
            ? '<video src="' + p.url + '" controls style="max-width:260px;max-height:180px"></video>'
            : '<img src="' + p.url + '" style="max-width:260px;max-height:180px" alt="user"/>';
          new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(e.lngLat).setHTML(html).addTo(m);
        });
      }
      var src = m.getSource('tm-user-media');
      var data = src._data || { type: 'FeatureCollection', features: [] };
      data.features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        properties: { url: url, kind: file.type, title: file.name }
      });
      src.setData(data);
      setStatus('USER MEDIA \u00b7 pinned at map center (local only)', true);
    };
    document.body.appendChild(btn);
    document.body.appendChild(input);
  }

  var n = 0;
  var iv = setInterval(function () {
    n++;
    patchTransport();
    lightenWeather();
    stripSimulation();
    hookCameraButtons();
    setupUserMedia();
    if (n > 40) clearInterval(iv);
  }, 400);

  var obs = new MutationObserver(function () {
    stripSimulation();
    hookCameraButtons();
    var body = document.querySelector('.tm-panel-body');
    if (body && /CAMERAS|NO CURRENT PUBLIC SOURCE|LOAD LIVE CAMERA/i.test(body.textContent || '')) {
      loadPublicCameras();
    }
  });
  setTimeout(function () {
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  }, 1000);

  window.TrackMeNowLoadCameras = loadPublicCameras;
  console.log('[TM] UX v9: weather dedupe, cameras, exclusive transit, user media');
})();
