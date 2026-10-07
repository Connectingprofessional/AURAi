/* TrackMeNow timebar remap v12
 * play     → temporary session recap of map places visited (not saved)
 * day prev/next → keep day change (GIBS)
 * arrows by date → pan map left / right
 * slider → center-zero fast pan left/right, snaps back to middle
 */
(function () {
  "use strict";

  var trail = [];
  var MAX_TRAIL = 120;
  var recapPlaying = false;

  function map() {
    try {
      if (window.TrackMeNowEngine && window.TrackMeNowEngine.getMap)
        return window.TrackMeNowEngine.getMap();
    } catch (e) {}
    return window.maplibre || window.map || null;
  }

  function recordPoint() {
    var m = map();
    if (!m || !m.getCenter) return;
    try {
      var c = m.getCenter();
      var z = m.getZoom();
      var last = trail[trail.length - 1];
      if (last && Math.abs(last.lng - c.lng) < 0.002 && Math.abs(last.lat - c.lat) < 0.002 && Math.abs(last.z - z) < 0.05)
        return;
      trail.push({ lng: c.lng, lat: c.lat, z: z, t: Date.now() });
      if (trail.length > MAX_TRAIL) trail.shift();
    } catch (e) {}
  }

  function panMap(dxLng, duration) {
    var m = map();
    if (!m || !m.getCenter) return;
    var c = m.getCenter();
    var z = m.getZoom();
    var factor = 360 / Math.pow(2, z);
    var dLng = dxLng * factor * 0.15;
    m.easeTo({
      center: [c.lng + dLng, c.lat],
      duration: duration == null ? 280 : duration,
      easing: function (t) { return t; }
    });
    setTimeout(recordPoint, (duration || 280) + 40);
  }

  function wireSlider(slider) {
    if (!slider || slider.__tmPan) return;
    slider.__tmPan = true;
    slider.min = "-100";
    slider.max = "100";
    slider.value = "0";
    slider.step = "1";
    slider.title = "Slide left/right to pan the map (center = stop)";
    slider.style.width = "180px";

    var dragging = false;
    function applyFromValue() {
      var v = parseFloat(slider.value) || 0;
      if (Math.abs(v) < 4) return;
      panMap(v / 25, 120);
    }

    slider.addEventListener("input", function () {
      dragging = true;
      applyFromValue();
    });
    function reset() {
      slider.value = "0";
      dragging = false;
    }
    slider.addEventListener("change", reset);
    slider.addEventListener("pointerup", reset);
    slider.addEventListener("touchend", reset);

    setInterval(function () {
      if (!dragging) return;
      var v = parseFloat(slider.value) || 0;
      if (Math.abs(v) >= 4) applyFromValue();
    }, 140);
  }

  function wireArrows() {
    var prev = document.getElementById("tm-prev");
    var next = document.getElementById("tm-next");
    if (prev && !prev.__tmPan) {
      prev.__tmPan = true;
      prev.title = "Pan map left";
      prev.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        panMap(-1.2, 320);
      };
    }
    if (next && !next.__tmPan) {
      next.__tmPan = true;
      next.title = "Pan map right";
      next.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        panMap(1.2, 320);
      };
    }
    var dayPrev = document.getElementById("tm-day-prev");
    var dayNext = document.getElementById("tm-day-next");
    if (dayPrev) dayPrev.title = "Previous day (satellite imagery)";
    if (dayNext) dayNext.title = "Next day (satellite imagery)";
  }

  async function playRecap() {
    var m = map();
    var btn = document.getElementById("tm-play");
    if (!m) return;
    if (recapPlaying) {
      recapPlaying = false;
      if (btn) btn.textContent = "\u25b6";
      return;
    }
    if (trail.length < 2) {
      recordPoint();
      if (btn) btn.title = "Move around the map first, then press for a flash recap";
      var c = m.getCenter();
      m.flyTo({ center: [c.lng + 0.01, c.lat], zoom: m.getZoom(), duration: 400 });
      setTimeout(function () {
        m.flyTo({ center: [c.lng, c.lat], zoom: m.getZoom(), duration: 400 });
      }, 450);
      return;
    }
    recapPlaying = true;
    if (btn) btn.textContent = "\u25a0";
    var points = trail.slice();
    for (var i = 0; i < points.length && recapPlaying; i++) {
      var p = points[i];
      m.flyTo({
        center: [p.lng, p.lat],
        zoom: p.z,
        duration: Math.min(500, 200 + (i === 0 ? 200 : 0)),
        essential: true
      });
      await new Promise(function (r) { setTimeout(r, i === 0 ? 550 : 380); });
    }
    recapPlaying = false;
    if (btn) btn.textContent = "\u25b6";
  }

  function wirePlay() {
    var btn = document.getElementById("tm-play");
    if (!btn || btn.__tmRecap) return;
    btn.__tmRecap = true;
    btn.title = "Session recap — flash through places you visited (temporary, not saved)";
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      playRecap();
    };
  }

  function hookMapTrail() {
    var m = map();
    if (!m || m.__tmTrail) return !!m;
    m.__tmTrail = true;
    recordPoint();
    m.on("moveend", recordPoint);
    m.on("zoomend", recordPoint);
    return true;
  }

  function boot() {
    wireArrows();
    wirePlay();
    var slider = document.getElementById("tm-time-slider");
    if (slider) wireSlider(slider);
    hookMapTrail();
  }

  var n = 0;
  var iv = setInterval(function () {
    n++;
    boot();
    if (n > 60) clearInterval(iv);
  }, 400);

  setInterval(function () {
    hookMapTrail();
    recordPoint();
  }, 4000);

  console.log("[TM] timebar: pan arrows + center slider + session recap");
})();
