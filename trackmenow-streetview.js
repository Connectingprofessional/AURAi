/* TrackMeNow — Street View panel.
 * Uses Google's official Maps Embed API (iframe, ToS-compliant) to show a real street-level
 * panorama for a clicked point. This is NOT satellite zoom and does not replace the base map —
 * Street View only exists where Google's cars have actually driven, so it's an on-demand panel,
 * exactly like the "Street View" pegman in Google Maps itself.
 *
 * Requires window.TM_GOOGLE_MAPS_API_KEY to be set in index.html (left blank until configured).
 * Get one: console.cloud.google.com -> new project -> enable "Maps Embed API" -> Credentials ->
 * Create API key -> restrict it to Maps Embed API + your site's domain.
 */
(function () {
  'use strict';
  var map = null;
  var attached = null;
  var active = false;
  var panel = null;
  var frame = null;
  var closeBtn = null;
  var titleEl = null;

  function key() { return window.TM_GOOGLE_MAPS_API_KEY || ''; }

  function ensureDom() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'tm-streetview-panel';
    panel.innerHTML =
      '<div id="tm-sv-head">' +
        '<span id="tm-sv-title">STREET VIEW</span>' +
        '<button type="button" id="tm-sv-close" aria-label="Close street view">✕</button>' +
      '</div>' +
      '<div id="tm-sv-body"></div>';
    document.body.appendChild(panel);

    var style = document.createElement('style');
    style.textContent =
      '#tm-streetview-panel{position:fixed;z-index:7000;right:12px;top:52px;width:min(420px,calc(100vw - 24px));' +
        'background:rgba(5,10,16,.96);border:1px solid rgba(150,190,220,.18);border-radius:10px;overflow:hidden;' +
        'box-shadow:0 10px 30px rgba(0,0,0,.4);display:none;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}' +
      '#tm-streetview-panel.open{display:block}' +
      '#tm-sv-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;' +
        'font:700 11px system-ui;letter-spacing:1px;color:#cfe3ee;border-bottom:1px solid rgba(150,190,220,.14)}' +
      '#tm-sv-close{background:none;border:0;color:#cfe3ee;font-size:14px;cursor:pointer;line-height:1;padding:2px 4px}' +
      '#tm-sv-close:hover{color:#ff7a7a}' +
      '#tm-sv-body{position:relative;width:100%;aspect-ratio:16/10;background:#0a1016}' +
      '#tm-sv-body iframe{width:100%;height:100%;border:0;display:block}' +
      '#tm-sv-msg{padding:14px;font:12px/1.5 system-ui;color:#9fb4c2}' +
      '#tm-sv-msg a{color:#62d7ff}' +
      '#tm-streetview-toggle{width:40px;height:40px;padding:0;border:1px solid rgba(255,255,255,.18);border-radius:8px;' +
        'background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 15px system-ui;display:flex;' +
        'align-items:center;justify-content:center;margin-top:6px}' +
      '#tm-streetview-toggle.on{border-color:#62d7ff;color:#62d7ff}' +
      '@media(max-width:800px){#tm-streetview-panel{right:6px;left:6px;width:auto}}';
    document.head.appendChild(style);

    titleEl = panel.querySelector('#tm-sv-title');
    closeBtn = panel.querySelector('#tm-sv-close');
    frame = panel.querySelector('#tm-sv-body');
    closeBtn.addEventListener('click', hidePanel);
  }

  function hidePanel() {
    panel.classList.remove('open');
    frame.innerHTML = '';
  }

  function showAt(lat, lon) {
    ensureDom();
    titleEl.textContent = 'STREET VIEW · ' + lat.toFixed(5) + ', ' + lon.toFixed(5);
    var k = key();
    if (!k) {
      frame.innerHTML =
        '<div id="tm-sv-msg">No Google Maps API key configured yet, so Street View can’t load. ' +
        'Set <code>window.TM_GOOGLE_MAPS_API_KEY</code> in index.html to a key with the ' +
        '<strong>Maps Embed API</strong> enabled, then try again. ' +
        '<a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener noreferrer">Get a key</a></div>';
    } else {
      var src = 'https://www.google.com/maps/embed/v1/streetview?key=' + encodeURIComponent(k) +
        '&location=' + lat + ',' + lon + '&heading=0&pitch=0&fov=90';
      frame.innerHTML = '<iframe src="' + src + '" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>';
    }
    panel.classList.add('open');
  }

  function onMapClick(ev) {
    if (!active) return;
    showAt(ev.lngLat.lat, ev.lngLat.lng);
  }

  function addToggle() {
    var stack = document.getElementById('tm-zoom-stack');
    if (document.getElementById('tm-streetview-toggle')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'tm-streetview-toggle';
    b.title = 'Street View: click a point on the map';
    b.setAttribute('aria-label', 'Toggle Street View click mode');
    b.textContent = '👤'; // pegman-ish placeholder glyph
    b.addEventListener('click', function () {
      active = !active;
      b.classList.toggle('on', active);
      if (map) map.getCanvas().style.cursor = active ? 'crosshair' : '';
      if (!active) hidePanel();
    });
    if (stack) {
      stack.appendChild(b);
    } else {
      // The current TrackMeNow layout has no #tm-zoom-stack; keep Street View reachable.
      b.style.position = 'fixed';
      b.style.right = '14px';
      b.style.top = '98px';
      b.style.zIndex = '10021';
      b.style.boxShadow = '0 4px 20px rgba(0,0,0,.35)';
      document.body.appendChild(b);
    }
  }

  function install() {
    if (!map || attached === map) return;
    attached = map;
    ensureDom();
    addToggle();
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

  window.TrackMeNowStreetView = { attach: function (m) { map = m; install(); }, show: showAt, hide: hidePanel };
})();
