/* TrackMeNow — 3D building extrusions.
 * Adds real OpenStreetMap building footprints as extruded 3D shapes when the user is zoomed in
 * close enough (city-block scale), so the map reads like solid buildings rather than flat
 * satellite texture — the biggest legitimate step toward a Google-Earth-like close view.
 * Source: TrackMeNow Worker -> OpenStreetMap/Overpass, zoom-gated server-side. No Google data,
 * no proprietary imagery — this is independent OSM building geometry with estimated heights.
 */
(function () {
  'use strict';
  var map = null;
  var attached = null;
  var API = (window.TM_API_BASE || '') + '/api/buildings';
  var SOURCE_ID = 'tm-buildings';
  var LAYER_ID = 'tm-buildings-3d';
  var MIN_ZOOM = 15.3; // below this, a bbox query would be too large / not useful at this scale
  var loading = false;
  var lastKey = '';
  var debounceTimer = null;

  function bboxOf(m) {
    var b = m.getBounds();
    return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(function (n) {
      return Math.round(n * 1e4) / 1e4;
    }).join(',');
  }

  function ensureLayer() {
    if (!map || map.getSource(SOURCE_ID)) return;
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: LAYER_ID,
      type: 'fill-extrusion',
      source: SOURCE_ID,
      minzoom: MIN_ZOOM - 0.3,
      paint: {
        'fill-extrusion-color': [
          'interpolate', ['linear'], ['get', 'height'],
          0, '#9fb4c2',
          15, '#b9c7d1',
          40, '#d6dee3',
          100, '#eef3f5'
        ],
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 9],
        'fill-extrusion-base': ['coalesce', ['get', 'minHeight'], 0],
        'fill-extrusion-opacity': 0.88,
        'fill-extrusion-vertical-gradient': true
      }
    });
  }

  function load() {
    if (!map || loading) return;
    var z = map.getZoom();
    if (z < MIN_ZOOM) {
      var src = map.getSource(SOURCE_ID);
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      lastKey = '';
      return;
    }
    var key = bboxOf(map);
    if (key === lastKey) return;
    lastKey = key;
    loading = true;
    fetch(API + '?bbox=' + encodeURIComponent(key), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        ensureLayer();
        var src = map.getSource(SOURCE_ID);
        if (src && j && Array.isArray(j.features)) src.setData(j);
      })
      .catch(function (e) { console.warn('[buildings]', e); })
      .finally(function () { loading = false; });
  }

  function debouncedLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(load, 450);
  }

  function install() {
    if (!map || attached === map) return;
    attached = map;
    var go = function () {
      ensureLayer();
      load();
    };
    if (map.isStyleLoaded()) go();
    else map.once('load', go);
    map.on('style.load', function () { lastKey = ''; go(); });
    map.on('moveend', debouncedLoad);
    map.on('zoomend', debouncedLoad);
  }

  function seekMap() {
    var attempts = 0;
    var timer = setInterval(function () {
      var candidate = window.map || window.maplibre;
      if (candidate && typeof candidate.getBounds === 'function' && typeof candidate.addSource === 'function') {
        map = candidate;
        install();
        if (attached === map) clearInterval(timer);
      }
      if (++attempts > 120) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', seekMap);
  else seekMap();

  window.TrackMeNowBuildings = { attach: function (m) { map = m; install(); }, reload: function () { lastKey = ''; load(); } };
})();
