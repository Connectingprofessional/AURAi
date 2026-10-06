/* TrackMeNow — real-time traffic layer
 * Global live road traffic requires a provider key.
 * Free option: TomTom developer key (signup, free tier).
 * Set: localStorage.setItem('TM_TOMTOM_KEY', 'your_key')
 *   or window.TM_TOMTOM_KEY = 'your_key'
 * Without a key the toggle explains how to enable it.
 */
(function () {
  'use strict';
  var SRC = 'tm-traffic-flow';
  var LYR = 'tm-traffic-flow-layer';
  var on = false;
  var btn = null;

  function getKey() {
    try {
      return (window.TM_TOMTOM_KEY || localStorage.getItem('TM_TOMTOM_KEY') || '').trim();
    } catch (e) { return (window.TM_TOMTOM_KEY || '').trim(); }
  }

  function map() {
    try {
      if (window.TrackMeNowEngine && typeof window.TrackMeNowEngine.getMap === 'function') {
        return window.TrackMeNowEngine.getMap();
      }
    } catch (e) {}
    return window.maplibre || window.map || null;
  }

  function tileUrl(key) {
    return 'https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=' +
      encodeURIComponent(key) + '&thickness=8';
  }

  function ensureLayer(m, key) {
    if (!m || !m.addSource) return false;
    try {
      if (m.getSource(SRC)) {
        m.removeLayer(LYR);
        m.removeSource(SRC);
      }
    } catch (e) {}
    try {
      m.addSource(SRC, {
        type: 'raster',
        tiles: [tileUrl(key)],
        tileSize: 256,
        attribution: '\u00a9 TomTom Traffic',
        maxzoom: 22
      });
      m.addLayer({
        id: LYR,
        type: 'raster',
        source: SRC,
        paint: { 'raster-opacity': 0.72, 'raster-fade-duration': 0 }
      });
      return true;
    } catch (e) {
      console.warn('[TM traffic]', e);
      return false;
    }
  }

  function removeLayer(m) {
    if (!m) return;
    try { if (m.getLayer(LYR)) m.removeLayer(LYR); } catch (e) {}
    try { if (m.getSource(SRC)) m.removeSource(SRC); } catch (e) {}
  }

  function setStatus(msg, ok) {
    var st = document.getElementById('status');
    if (st) {
      st.classList.add('tm-show');
      st.innerHTML = (ok
        ? '<span style="color:#43e0a0">\u25cf</span> '
        : '<span style="color:#ffb347">\u25cf</span> ') + msg;
    }
    console.log('[TM traffic]', msg);
  }

  function setBtnState() {
    if (!btn) return;
    if (on) btn.classList.add('on');
    else btn.classList.remove('on');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function toggle() {
    var key = getKey();
    var m = map();
    if (!on) {
      if (!key) {
        setStatus(
          'TRAFFIC \u00b7 needs free TomTom key. Console: localStorage.setItem("TM_TOMTOM_KEY","YOUR_KEY"); then click Traffic again. Get key: https://developer.tomtom.com/',
          false
        );
        return;
      }
      if (!m) {
        setStatus('TRAFFIC \u00b7 map not ready \u2014 try again in a moment', false);
        return;
      }
      if (ensureLayer(m, key)) {
        on = true;
        setBtnState();
        setStatus('TRAFFIC \u00b7 live flow (TomTom) \u00b7 green free \u00b7 yellow slow \u00b7 red congested', true);
      } else {
        setStatus('TRAFFIC \u00b7 failed to add layer (map style loading?)', false);
      }
    } else {
      removeLayer(m);
      on = false;
      setBtnState();
      setStatus('TRAFFIC \u00b7 off', true);
    }
  }

  function injectButton() {
    if (document.getElementById('tm-traffic-btn')) return;
    var bar = document.querySelector('.tm-bar') || document.querySelector('[class*="tm-bar"]');
    btn = document.createElement('button');
    btn.id = 'tm-traffic-btn';
    btn.type = 'button';
    btn.className = 'tm-bar-btn';
    btn.textContent = 'Traffic';
    btn.title = 'Real-time road traffic flow';
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    };
    if (bar) {
      bar.appendChild(btn);
    } else {
      btn.style.cssText = 'position:fixed;bottom:90px;right:14px;z-index:40;padding:8px 12px;' +
        'background:#0d1a24;color:#edf4f8;border:1px solid #2a4a5c;border-radius:8px;cursor:pointer;font:600 12px system-ui';
      document.body.appendChild(btn);
    }
    var style = document.createElement('style');
    style.textContent = '#tm-traffic-btn.on{background:#1a3d4a;color:#43e0a0;border-color:#43e0a0}';
    document.head.appendChild(style);
  }

  var n = 0;
  var iv = setInterval(function () {
    n++;
    injectButton();
    if (document.getElementById('tm-traffic-btn') || n > 60) clearInterval(iv);
  }, 500);

  window.TrackMeNowTraffic = {
    toggle: toggle,
    isOn: function () { return on; },
    setKey: function (k) {
      try { localStorage.setItem('TM_TOMTOM_KEY', k); } catch (e) {}
      window.TM_TOMTOM_KEY = k;
      setStatus('TRAFFIC \u00b7 key saved \u2014 click Traffic to show live flow', true);
    }
  };
  console.log('[TM] traffic layer ready (TomTom free key via TM_TOMTOM_KEY / localStorage)');
})();
