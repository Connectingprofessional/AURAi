/* TrackMeNow — Google Photorealistic 3D Earth map mode.
 * This is an in-page map mode selected from MAP subtabs, not a separate page.
 * It never opens automatically and never adds a city-centre marker.
 */
(function () {
  'use strict';

  var KEY = function () {
    return String(window.TM_GOOGLE_MAPS_3D_API_KEY || '').trim();
  };
  var overlay = null;
  var stage = null;
  var button = null; // Reserved for compatibility; navigation is handled by MAP subtabs.
  var status = null;
  var map3d = null;
  var apiPromise = null;
  var active = false;

  function getLegacyMap() {
    var m = window.map || window.maplibre;
    return m && typeof m.getCenter === 'function' && typeof m.getZoom === 'function' ? m : null;
  }

  function currentCamera() {
    var m = getLegacyMap();
    if (!m) return { lat: 0, lng: 0, zoom: 1.5, heading: 0, tilt: 45 };
    var c = m.getCenter();
    var z = Number(m.getZoom()) || 1.5;
    return {
      lat: Number(c.lat) || 20,
      lng: Number(c.lng) || 15,
      zoom: z,
      heading: typeof m.getBearing === 'function' ? (Number(m.getBearing()) || 0) : 0,
      tilt: z < 5 ? 35 : 65
    };
  }

  function rangeForZoom(zoom) {
    var range = 40075016 / Math.pow(2, Math.max(0, Number(zoom) || 1.5));
    return Math.max(350, Math.min(38000000, range));
  }

  function setStatus(message, isError) {
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? '#ff9a9a' : '#b8d9e8';
    status.hidden = !message;
  }

  function ensureUI() {
    if (overlay) return;
    var style = document.createElement('style');
    style.id = 'tm-google-earth-css';
    style.textContent =
      '#tm-google-earth-overlay{position:fixed;inset:58px 0 var(--tm-dock-h,76px) 0;z-index:3;background:#03070b;display:none;overflow:hidden}' +
      '#tm-google-earth-stage{position:absolute;inset:0;width:100%;height:100%;background:#03070b}' +
      '#tm-google-earth-stage gmp-map-3d{display:block;width:100%;height:100%;min-height:100%;outline:0}' +
      '#tm-google-earth-status{position:absolute;left:14px;bottom:16px;max-width:min(560px,calc(100vw - 28px));padding:9px 12px;border:1px solid rgba(150,190,220,.2);border-radius:8px;background:rgba(4,10,16,.86);font:12px/1.5 system-ui,sans-serif;z-index:2}' +
      '#tm-google-earth-status[hidden]{display:none}' +
      '#tm-google-earth-status a{color:#62d7ff}' +
      '@media(max-width:600px){#tm-google-earth-overlay{inset:52px 0 var(--tm-dock-h,76px) 0}#tm-google-earth-status{left:8px;bottom:8px}}';
    document.head.appendChild(style);

    overlay = document.createElement('section');
    overlay.id = 'tm-google-earth-overlay';
    overlay.setAttribute('aria-label', 'Google Photorealistic 3D Earth map');
    stage = document.createElement('div');
    stage.id = 'tm-google-earth-stage';
    status = document.createElement('div');
    status.id = 'tm-google-earth-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    overlay.appendChild(stage);
    overlay.appendChild(status);
    document.body.appendChild(overlay);

    // Earth is activated only through MAP → GOOGLE EARTH; no floating button or second page.
  }

  async function resolveKey() {
    var key = KEY();
    if (key) return key;
    try {
      var response = await fetch((window.TM_API_BASE || 'https://wispy-bush-9aee.recreationeeraj.workers.dev') + '/api/google/maps-config', { cache: 'no-store' });
      var config = await response.json();
      if (config && config.configured && config.key) {
        window.TM_GOOGLE_MAPS_API_KEY = String(config.key);
        window.TM_GOOGLE_MAPS_3D_API_KEY = String(config.key);
        return String(config.key);
      }
    } catch (error) {}
    return '';
  }

  async function loadGoogleApi() {
    if (window.google && window.google.maps && typeof window.google.maps.importLibrary === 'function') {
      return;
    }
    if (apiPromise) return apiPromise;
    var key = await resolveKey();
    if (!key) throw new Error('Google 3D Maps browser key is unavailable from both the published build and Worker configuration.');
    apiPromise = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-tm-google-3d-api]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', function () { reject(new Error('Google Maps JavaScript API failed to load.')); }, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.dataset.tmGoogle3dApi = '1';
      script.async = true;
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) +
        '&v=beta&loading=async&libraries=maps3d';
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Google Maps JavaScript API failed to load. Check key restrictions and API access.')); };
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  async function createOrUpdateMap() {
    var camera = currentCamera();
    await loadGoogleApi();
    if (!window.google || !window.google.maps || typeof window.google.maps.importLibrary !== 'function') {
      throw new Error('Google Maps API loaded without the 3D Maps library.');
    }
    var lib = await window.google.maps.importLibrary('maps3d');
    if (!lib || !lib.Map3DElement) throw new Error('The Maps 3D library is unavailable for this API key.');
    if (!map3d) {
      map3d = new lib.Map3DElement({
        center: { lat: camera.lat, lng: camera.lng, altitude: 0 },
        range: rangeForZoom(camera.zoom),
        heading: camera.heading,
        tilt: camera.tilt,
        mode: 'HYBRID',
        defaultUIHidden: false,
        gestureHandling: 'auto'
      });
      map3d.setAttribute('aria-label', 'Google Photorealistic 3D Earth');
      stage.appendChild(map3d);
    } else {
      map3d.center = { lat: camera.lat, lng: camera.lng, altitude: 0 };
      map3d.range = rangeForZoom(camera.zoom);
      map3d.heading = camera.heading;
      map3d.tilt = camera.tilt;
    }
    setStatus('Google 3D Earth is active. Use the MAP subtabs to switch views; coverage and detail vary by location.', false);
  }

  async function openEarth() {
    ensureUI();
    active = true;
    overlay.style.display = 'block';
    setStatus('Loading Google 3D Earth…', false);
    try {
      await createOrUpdateMap();
    } catch (err) {
      setStatus((err && err.message ? err.message : 'Google 3D Earth could not be loaded.') +
        ' The existing TrackMeNow map remains underneath. Select another MAP subtab to return. Check Maps JavaScript API and Maps 3D access for this key.', true);
    }
  }

  function closeEarth() {
    active = false;
    if (overlay) overlay.style.display = 'none';
  }

  function init() {
    ensureUI();
    window.TrackMeNowGoogleEarth = {
      open: openEarth,
      close: closeEarth,
      isActive: function () { return active; },
      getMap: function () { return map3d; }
    };
    // Intentionally do not auto-open or force a city-centre view on page load. The user selects the Earth subtab.
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();