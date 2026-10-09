/* TrackMeNow — Earth camera navigation only.
 * Enables Earth-style pan/rotate/tilt, closer camera approach, compass and reset.
 * Imagery resolution remains limited by each tile provider's native zoom.
 */
(function () {
  'use strict';
  var map = null;
  var attached = null;
  var tiltHigh = false;
  var styleId = 'tm-earth-camera-controls';

  function addStyles() {
    if (document.getElementById(styleId + '-css')) return;
    var s = document.createElement('style');
    s.id = styleId + '-css';
    s.textContent =
      '#tm-zoom-stack .tm-earth-cam-btn{width:40px;height:40px;padding:0;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 16px system-ui;display:flex;align-items:center;justify-content:center;}' +
      '#tm-zoom-stack .tm-earth-cam-btn:hover{border-color:#4fd0a0;color:#4fd0a0;background:rgba(6,12,18,.98)}' +
      '#tm-earth-compass-needle{display:inline-block;transform-origin:50% 50%;font-size:18px;line-height:1}';
    document.head.appendChild(s);
  }

  function ease(options) {
    if (!map) return;
    map.easeTo(Object.assign({ duration: 550, easing: function (t) { return 1 - Math.pow(1 - t, 3); } }, options || {}));
  }

  function addButton(id, title, content, action) {
    var stack = document.getElementById('tm-zoom-stack');
    if (!stack || document.getElementById(id)) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = 'tm-earth-cam-btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = content;
    b.addEventListener('click', action);
    stack.appendChild(b);
  }

  function syncCompass() {
    var n = document.getElementById('tm-earth-compass-needle');
    if (n && map) n.style.transform = 'rotate(' + (-map.getBearing()) + 'deg)';
    var tilt = document.getElementById('tm-earth-tilt');
    if (tilt && map) {
      tilt.title = map.getPitch() > 10 ? 'Return to overhead view' : 'Tilt to 3D surface view';
      tilt.setAttribute('aria-label', tilt.title);
      tilt.style.color = map.getPitch() > 10 ? '#4fd0a0' : '#eaf4fa';
    }
  }

  function resetCamera() {
    if (!map) return;
    tiltHigh = false;
    ease({ center: [20, 15], zoom: 1.4, bearing: 0, pitch: 0 });
  }

  function install() {
    if (!map || attached === map) return;
    attached = map;
    try {
      if (map.dragPan && map.dragPan.enable) map.dragPan.enable();
      if (map.dragRotate && map.dragRotate.enable) map.dragRotate.enable();
      if (map.touchZoomRotate && map.touchZoomRotate.enableRotation) map.touchZoomRotate.enableRotation();
      if (map.setMaxPitch) map.setMaxPitch(85);
      if (map.setMaxZoom) map.setMaxZoom(22);
    } catch (e) {}

    addStyles();
    addButton('tm-earth-tilt', 'Tilt to 3D surface view', '⤢', function () {
      if (!map) return;
      tiltHigh = map.getPitch() <= 10;
      ease({ pitch: tiltHigh ? 68 : 0 });
    });
    addButton('tm-earth-compass', 'Reset bearing to north', '<span id="tm-earth-compass-needle">↑</span>', function () {
      if (map) ease({ bearing: 0 });
    });
    addButton('tm-earth-reset', 'Reset Earth camera', '◎', resetCamera);

    var home = document.getElementById('tm-zoom-home');
    if (home) {
      home.title = 'Reset Earth camera';
      home.setAttribute('aria-label', 'Reset Earth camera');
      home.onclick = resetCamera;
    }
    map.on('rotate', syncCompass);
    map.on('pitch', syncCompass);
    map.on('moveend', syncCompass);
    syncCompass();
  }

  function seekMap() {
    var attempts = 0;
    var timer = setInterval(function () {
      var candidate = window.map || window.maplibre;
      if (candidate && typeof candidate.easeTo === 'function' && typeof candidate.getPitch === 'function') {
        map = candidate;
        install();
        if (attached === map) clearInterval(timer);
      }
      if (++attempts > 120) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seekMap);
  else seekMap();

  window.TrackMeNowEarthCamera = { attach: function (m) { map = m; install(); }, reset: resetCamera };
})();