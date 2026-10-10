/* TrackMeNow — Google Maps Platform 3D Maps.
 * Uses Google's own photorealistic 3D map imagery; imagery capture dates and coverage are controlled by Google.
 * Provides in-map camera and imagery-mode controls plus a link to Google's official 3D Maps demo.
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
  var lastClickedPosition = null;
  var cameraControls = null;

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
      '#tm-earth-controls{position:absolute;z-index:5;right:12px;top:12px;display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:7px;border:1px solid rgba(170,210,235,.22);border-radius:10px;background:rgba(4,10,16,.9);box-shadow:0 6px 24px #0006}' +
      '#tm-earth-mode-controls{display:flex;gap:4px;flex-wrap:wrap;max-width:220px}' +
      '.tm-earth-mode-btn,.tm-earth-demo-btn{min-height:30px;border:1px solid #ffffff2c;border-radius:6px;padding:0 8px;background:#0b1823;color:#eaf7ff;font:800 9px system-ui;letter-spacing:.35px;cursor:pointer;touch-action:manipulation}' +
      '.tm-earth-mode-btn.on{border-color:#62d7ff;background:#12324a;color:#fff}' +
      '.tm-earth-demo-btn{display:block;text-align:center;text-decoration:none;background:#1a73e8;border-color:#4c95f5;color:#fff;padding:8px 10px}' +
      '.tm-earth-cam-btn{width:38px;height:34px;border:1px solid #ffffff25;border-radius:7px;background:#0b1823;color:#eaf7ff;font:700 16px system-ui;cursor:pointer;touch-action:manipulation}' +
      '.tm-earth-cam-btn:focus-visible,.tm-earth-mode-btn:focus-visible,.tm-earth-demo-btn:focus-visible{outline:2px solid #62d7ff;outline-offset:2px}' +
      '@media(max-width:600px){#tm-google-earth-overlay{inset:52px 0 var(--tm-dock-h,76px) 0}#tm-google-earth-status{left:8px;bottom:8px;max-width:calc(100vw - 76px)}#tm-earth-controls{right:7px;top:7px;gap:4px;padding:4px}#tm-earth-mode-controls{max-width:190px}.tm-earth-cam-btn{width:34px;height:32px}.tm-earth-mode-btn{padding:0 6px;font-size:8px}}';
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
    var controls = document.createElement('div');
    controls.id = 'tm-earth-controls';
    controls.setAttribute('aria-label', 'Google Maps Platform 3D map controls');
    var modeControls = document.createElement('div');
    modeControls.id = 'tm-earth-mode-controls';
    modeControls.setAttribute('aria-label', '3D imagery mode');
    [['HYBRID','HYBRID'],['SATELLITE','SATELLITE']].forEach(function(item){
      var b=document.createElement('button');b.type='button';b.className='tm-earth-mode-btn';b.textContent=item[0];b.dataset.mode=item[1];
      b.addEventListener('click',function(){setMapMode(item[1]);});modeControls.appendChild(b);
    });
    var demo=document.createElement('a');demo.className='tm-earth-demo-btn';demo.href='https://mapsplatform.google.com/demos/3d-maps/?utm_experiment=13103223';demo.target='_blank';demo.rel='noopener noreferrer';demo.textContent='OPEN GOOGLE 3D MAPS DEMO ↗';
    controls.appendChild(modeControls);controls.appendChild(demo);
    cameraControls = document.createElement('div');
    cameraControls.id = 'tm-earth-camera-controls';
    cameraControls.setAttribute('aria-label', 'Earth camera controls');
    [['＋','Zoom in',function(){adjustCamera('zoom',-0.65)}],['−','Zoom out',function(){adjustCamera('zoom',0.65)}],['↶','Rotate left',function(){adjustCamera('heading',-25)}],['↷','Rotate right',function(){adjustCamera('heading',25)}],['▲','Tilt up',function(){adjustCamera('tilt',10)}],['▼','Tilt down',function(){adjustCamera('tilt',-10)}],['⌂','Reset camera',resetCamera]].forEach(function(item){var b=document.createElement('button');b.type='button';b.className='tm-earth-cam-btn';b.textContent=item[0];b.title=item[1];b.setAttribute('aria-label',item[1]);b.addEventListener('click',item[2]);cameraControls.appendChild(b);});
    controls.appendChild(cameraControls);
    overlay.appendChild(controls);
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
        '&v=alpha&loading=async&libraries=maps3d';
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
    if (!map3d.__tmPegmanClickBound) {
      map3d.addEventListener('gmp-click', function(event){var p=event&&(event.position||event.latLng||(event.detail&&event.detail.position));if(!p)return;var lat=typeof p.lat==='function'?p.lat():p.lat;var lng=typeof p.lng==='function'?p.lng():(p.lng!==undefined?p.lng:p.longitude);if(Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))){lastClickedPosition={lat:Number(lat),lng:Number(lng)};if(window.TrackMeNowStreetView&&window.TrackMeNowStreetView.handleEarthClick)window.TrackMeNowStreetView.handleEarthClick(lastClickedPosition);}});
      map3d.__tmPegmanClickBound=true;
    }
    modeControlsUpdate(map3d.mode || 'HYBRID');
    setStatus('Google Maps Platform 3D Maps active. Use SATELLITE/HYBRID for imagery; building freshness depends on Google capture coverage. Drag Pegman for Street View.', false);
  }

  function setMapMode(mode) {
    if (!map3d) return;
    try { map3d.mode = mode; } catch (error) { setStatus('Could not switch 3D imagery mode. Check Maps 3D API access.', true); return; }
    if (modeControlsUpdate) modeControlsUpdate(mode);
    setStatus(mode + ' imagery selected. Building and imagery capture dates depend on Google coverage; Street View shows the latest panorama available for a location.', false);
  }
  var modeControlsUpdate = function(mode) {
    var nodes = document.querySelectorAll('#tm-earth-mode-controls .tm-earth-mode-btn');
    Array.prototype.forEach.call(nodes,function(b){b.classList.toggle('on',b.dataset.mode===mode);});
  };

  function adjustCamera(kind, amount) {
    if (!map3d) return;
    if (kind === 'zoom') map3d.range = Math.max(250, Math.min(38000000, (Number(map3d.range) || 20000000) * Math.pow(2, amount)));
    if (kind === 'heading') map3d.heading = ((Number(map3d.heading) || 0) + amount + 360) % 360;
    if (kind === 'tilt') map3d.tilt = Math.max(0, Math.min(85, (Number(map3d.tilt) || 45) + amount));
  }
  function resetCamera() { if (!map3d) return; var c=currentCamera(); map3d.range=rangeForZoom(c.zoom); map3d.heading=0; map3d.tilt=55; }

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
      getMap: function () { return map3d; },
      setStatus: function (message) { setStatus(message, false); },
      getDropPosition: function () { return lastClickedPosition || (map3d && map3d.center ? { lat: map3d.center.lat, lng: map3d.center.lng } : null); }
    };
    // Start with Google Maps Platform 3D Maps on the landing page; keep the legacy map underneath as fallback.
    window.setTimeout(function () { openEarth(); }, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();