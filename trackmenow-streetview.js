/* TrackMeNow — immersive Google Street View.
 * Click the Pegman button, then click a location on the TrackMeNow map.
 * Uses the Maps JavaScript API Street View panorama (not a small Embed API iframe),
 * so the panorama fills the viewport and supports Google-style navigation controls.
 */
(function () {
  'use strict';

  var map = null;
  var attached = null;
  var active = false;
  var overlay = null;
  var panoramaHost = null;
  var statusEl = null;
  var toggle = null;
  var closeBtn = null;
  var panorama = null;
  var apiPromise = null;
  var requestToken = 0;

  function key() {
    return String(window.TM_GOOGLE_MAPS_API_KEY || window.TM_GOOGLE_MAPS_3D_API_KEY || '').trim();
  }

  function ensureDom() {
    if (overlay) return;
    var style = document.createElement('style');
    style.id = 'tm-streetview-css';
    style.textContent =
      '#tm-streetview-toggle{position:fixed;z-index:10021;right:14px;top:98px;width:40px;height:40px;padding:0;border:1px solid rgba(255,255,255,.22);border-radius:8px;background:rgba(6,12,18,.94);color:#eaf4fa;cursor:pointer;font:700 18px system-ui;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.35)}' +
      '#tm-streetview-toggle.on{border-color:#62d7ff;color:#62d7ff}' +
      '#tm-streetview-overlay{position:fixed;inset:0 0 var(--tm-dock-h,76px) 0;z-index:10010;background:#05080c;display:none}' +
      '#tm-streetview-overlay.open{display:block}' +
      '#tm-streetview-panorama{position:absolute;inset:0;width:100%;height:100%;background:#080d12}' +
      '#tm-streetview-head{position:absolute;left:12px;top:12px;z-index:5;display:flex;align-items:center;gap:10px;max-width:calc(100% - 24px);padding:8px 10px;border:1px solid rgba(180,210,230,.2);border-radius:9px;background:rgba(4,10,16,.88);color:#dff4ff;font:700 11px system-ui;box-shadow:0 4px 20px rgba(0,0,0,.25)}' +
      '#tm-streetview-title{max-width:min(62vw,520px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#tm-streetview-close{border:0;border-radius:5px;padding:5px 8px;background:rgba(255,255,255,.1);color:#fff;font:700 14px system-ui;cursor:pointer}' +
      '#tm-streetview-status{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:6;max-width:min(560px,calc(100% - 32px));padding:14px 16px;border:1px solid rgba(160,200,225,.22);border-radius:10px;background:rgba(4,10,16,.95);color:#cfe3ee;font:13px/1.55 system-ui;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4)}' +
      '#tm-streetview-status[hidden]{display:none}' +
      '#tm-streetview-status a{color:#62d7ff}' +
      '@media(max-width:600px){#tm-streetview-toggle{right:8px;top:92px}#tm-streetview-head{left:8px;top:8px}#tm-streetview-overlay{inset:0}}';
    document.head.appendChild(style);

    overlay = document.createElement('section');
    overlay.id = 'tm-streetview-overlay';
    overlay.setAttribute('aria-label', 'Google Street View panorama');
    panoramaHost = document.createElement('div');
    panoramaHost.id = 'tm-streetview-panorama';
    var head = document.createElement('div');
    head.id = 'tm-streetview-head';
    var title = document.createElement('span');
    title.id = 'tm-streetview-title';
    title.textContent = 'GOOGLE STREET VIEW';
    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.id = 'tm-streetview-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close Street View');
    statusEl = document.createElement('div');
    statusEl.id = 'tm-streetview-status';
    statusEl.setAttribute('role', 'status');
    statusEl.hidden = true;
    head.appendChild(title);
    head.appendChild(closeBtn);
    overlay.appendChild(panoramaHost);
    overlay.appendChild(head);
    overlay.appendChild(statusEl);
    document.body.appendChild(overlay);

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'tm-streetview-toggle';
    toggle.textContent = '👤';
    toggle.title = 'Street View: activate, then click a road or place on the map';
    toggle.setAttribute('aria-label', 'Activate Google Street View');
    document.body.appendChild(toggle);

    toggle.addEventListener('click', function () {
      if (active) {
        active = false;
        toggle.classList.remove('on');
        toggle.title = 'Street View: activate, then click a road or place on the map';
        toggle.setAttribute('aria-label', 'Activate Google Street View');
        if (map) map.getCanvas().style.cursor = '';
        hideView();
      } else {
        active = true;
        toggle.classList.add('on');
        toggle.title = 'Street View is active — click a road or place on the map';
        toggle.setAttribute('aria-label', 'Street View active; click a location on the map');
        if (map) map.getCanvas().style.cursor = 'crosshair';
        showStatus('Street View is ready. Click a road or place on the map to open the nearest available panorama.');
      }
    });
    closeBtn.addEventListener('click', hideView);
  }

  function showStatus(message, html) {
    if (!statusEl) return;
    statusEl.replaceChildren();
    if (html) statusEl.innerHTML = message;
    else statusEl.textContent = message;
    statusEl.hidden = false;
  }

  function hideStatus() {
    if (statusEl) statusEl.hidden = true;
  }

  function hideView() {
    if (overlay) overlay.classList.remove('open');
    hideStatus();
    if (panorama && typeof panorama.setVisible === 'function') panorama.setVisible(false);
    if (map && map.getCanvas) map.getCanvas().style.cursor = active ? 'crosshair' : '';
  }

  function loadGoogleApi() {
    if (window.google && window.google.maps && typeof window.google.maps.importLibrary === 'function') {
      return Promise.resolve();
    }
    if (apiPromise) return apiPromise;
    var k = key();
    if (!k) return Promise.reject(new Error('Google Maps API key is not present in the published build. The deployment must inject TM_GOOGLE_MAPS_API_KEY or TM_GOOGLE_MAPS_3D_API_KEY.'));
    apiPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-tm-google-3d-api]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', function () { reject(new Error('Google Maps JavaScript API failed to load. Check key restrictions and enabled APIs.')); }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.dataset.tmGoogle3dApi = '1';
      script.async = true;
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(k) + '&v=weekly&loading=async&libraries=maps3d';
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Google Maps JavaScript API failed to load. Check the browser key restrictions and API access.')); };
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  async function showAt(lat, lon) {
    ensureDom();
    var token = ++requestToken;
    overlay.classList.add('open');
    panoramaHost.style.display = 'block';
    hideStatus();
    var title = document.getElementById('tm-streetview-title');
    title.textContent = 'GOOGLE STREET VIEW · ' + Number(lat).toFixed(5) + ', ' + Number(lon).toFixed(5);
    showStatus('Finding the nearest available Google Street View panorama…');

    try {
      await loadGoogleApi();
      if (token !== requestToken) return;
      var lib = await window.google.maps.importLibrary('streetView');
      if (token !== requestToken) return;
      var StreetViewPanorama = lib.StreetViewPanorama;
      var StreetViewService = lib.StreetViewService;
      var StreetViewStatus = lib.StreetViewStatus;
      if (!StreetViewPanorama || !StreetViewService) {
        throw new Error('Google Street View library is unavailable. Confirm Maps JavaScript API is enabled for this key.');
      }

      if (!panorama) {
        panorama = new StreetViewPanorama(panoramaHost, {
          position: { lat: Number(lat), lng: Number(lon) },
          pov: { heading: 0, pitch: 0 },
          zoom: 0,
          addressControl: true,
          fullscreenControl: true,
          linksControl: true,
          panControl: true,
          zoomControl: true,
          motionTracking: false,
          visible: false
        });
      }

      var service = new StreetViewService();
      var request = {
        location: { lat: Number(lat), lng: Number(lon) },
        radius: 100,
        source: window.google.maps.StreetViewSource ? window.google.maps.StreetViewSource.DEFAULT : undefined
      };
      var result = await service.getPanorama(request).catch(function () { return null; });
      var resultStatus = result && result.status;
      if (!result || (resultStatus && resultStatus !== 'OK' && (!StreetViewStatus || resultStatus !== StreetViewStatus.OK))) {
        // A map click may be a little away from a road. Retry a wider search before declaring no coverage.
        request.radius = 1000;
        result = await service.getPanorama(request).catch(function () { return null; });
      }

      if (token !== requestToken) return;
      var data = result && result.data ? result.data : result;
      var status = result && result.status;
      if (!result) throw new Error('Google could not find a Street View panorama within 1 km. Try a nearby road or another location.');
      if (status && StreetViewStatus && status !== StreetViewStatus.OK && status !== 'OK') {
        throw new Error('No Street View panorama is available within 1 km of this point. Try a nearby road or another location.');
      }
      var location = data && data.location;
      if (!location || !location.latLng) {
        // Some API versions resolve the panorama result directly; accept only a real panorama ID.
        if (!data || !data.location || !data.location.pano) {
          throw new Error('Google returned no Street View panorama here. Street View coverage varies by road and country.');
        }
      }
      panorama.setPano(data.location.pano);
      panorama.setPov({ heading: 0, pitch: 0 });
      panorama.setVisible(true);
      panoramaHost.style.display = 'block';
      hideStatus();
    } catch (err) {
      if (token !== requestToken) return;
      panoramaHost.style.display = 'none';
      var message = err && err.message ? err.message : 'Street View could not be loaded.';
      showStatus(message + ' Google key: ' + (key() ? 'PRESENT' : 'MISSING') + '. If authorization is reported, check Maps JavaScript API, billing, and HTTP-referrer restrictions for the deployed TrackMeNow domain.');
    }
  }

  function onMapClick(ev) {
    if (!active || !ev || !ev.lngLat) return;
    showAt(ev.lngLat.lat, ev.lngLat.lng);
  }

  function install() {
    if (!map || attached === map) return;
    if (attached && attached.off) attached.off('click', onMapClick);
    attached = map;
    ensureDom();
    map.on('click', onMapClick);
  }

  function seekMap() {
    var attempts = 0;
    var timer = setInterval(function () {
      var candidate = window.map || window.maplibre;
      if (candidate && typeof candidate.on === 'function' && typeof candidate.getCanvas === 'function') {
        map = candidate;
        install();
        if (attached === map) clearInterval(timer);
      }
      if (++attempts > 120) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seekMap);
  else seekMap();

  window.TrackMeNowStreetView = {
    attach: function (m) { map = m; install(); },
    show: showAt,
    hide: hideView
  };
})();
