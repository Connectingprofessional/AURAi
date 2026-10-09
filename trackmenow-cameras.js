/* trackmenow-cameras.js
 * Single owner of the `tm-cameras` map source + popup playback.
 * Load AFTER MapLibre and BEFORE trackmenow-ux-fix.js / visuals-ui.js.
 */
(function () {
  'use strict';

  var CONFIG = {
    CATALOGUE_URL:
      window.TM_CAMERA_CATALOGUE_URL ||
      ((window.TM_LIVE_DATA_BASE ||
        'https://raw.githubusercontent.com/connectingprofessional/trackmenow/live-data') +
        '/cameras.json'),
    PROXY: (window.TM_API_BASE || '') + '/api/hls?u=',
    SOURCE_ID: 'tm-cameras',
    LAYER_ID: 'tm-cameras-circles',
    HLS_JS: 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.8/hls.min.js',
    HIDE_TOKEN_REFRESH: true
  };

  var map = null;
  var loadPromise = null;
  var hlsLoader = null;
  var activeHls = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c];
    });
  }

  function safeUrl(u) {
    try {
      var x = new URL(u, location.href);
      return /^https?:$/.test(x.protocol) ? x.href : '';
    } catch (e) {
      return '';
    }
  }

  function normalise(e) {
    var p = e && e.properties ? e.properties : e || {};
    var coords = e && e.geometry && e.geometry.coordinates;
    var url = p.stream || p.url || p.src || p.link || p.playlist || p.m3u8 || '';
    var kind = (p.type || p.kind || p.format || '').toLowerCase();

    if (!kind) {
      if (/\.m3u8(\?|$)/i.test(url)) kind = 'hls';
      else if (/youtube\.com|youtu\.be/i.test(url)) kind = 'youtube';
      else kind = 'html';
    }
    if (kind === 'm3u8') kind = 'hls';

    return {
      lat: +(p.lat != null ? p.lat : p.latitude != null ? p.latitude : coords && coords[1]),
      lon: +(p.lon != null ? p.lon : p.lng != null ? p.lng : p.longitude != null ? p.longitude : coords && coords[0]),
      title: p.title || p.name || p.label || 'Camera',
      provider: p.provider || p.source || p.owner || '',
      kind: kind,
      url: url,
      stale: !!(p.token_refresh || p.tokenRefresh),
      cors: p.cors !== false
    };
  }

  function toGeoJSON(list) {
    return {
      type: 'FeatureCollection',
      features: list.map(function (c, i) {
        return {
          type: 'Feature',
          id: i,
          geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
          properties: {
            title: c.title,
            provider: c.provider,
            kind: c.kind,
            url: c.url,
            cors: c.cors
          }
        };
      })
    };
  }

  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoader) return hlsLoader;
    hlsLoader = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = CONFIG.HLS_JS;
      s.onload = function () { res(window.Hls); };
      s.onerror = function () { rej(new Error('hls.js failed to load')); };
      document.head.appendChild(s);
    });
    return hlsLoader;
  }

  function ytId(u) {
    var m = String(u).match(/(?:v=|youtu\.be\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : '';
  }

  function destroyPlayer() {
    if (activeHls) {
      try { activeHls.destroy(); } catch (e) {}
      activeHls = null;
    }
  }

  function popupHTML(p) {
    var url = safeUrl(p.url);
    var head =
      '<div class="tm-cam-pop"><strong>' + esc(p.title) + '</strong>' +
      (p.provider ? '<div>' + esc(p.provider) + '</div>' : '');
    var tail = '</div>';

    if (!url) return head + '<div>No stream URL</div>' + tail;

    if (p.kind === 'hls') {
      return head +
        '<video id="tm-cam-video" controls muted autoplay playsinline style="width:260px;max-width:100%;background:#000"></video>' +
        '<div id="tm-cam-msg" style="font-size:11px"></div>' +
        '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">OPEN SOURCE</a>' +
        tail;
    }

    if (p.kind === 'youtube') {
      var id = ytId(url);
      if (id) {
        return head +
          '<iframe width="260" height="160" style="border:0" allow="autoplay; encrypted-media" allowfullscreen ' +
          'src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&mute=1"></iframe>' +
          tail;
      }
    }

    return head +
      '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">OPEN CAMERA PAGE</a>' +
      tail;
  }

  function attachHls(url, cors) {
    if (!url) return;

    if (cors === false || cors === 'false') {
      url = CONFIG.PROXY + encodeURIComponent(url);
    }

    var video = document.getElementById('tm-cam-video');
    var msg = document.getElementById('tm-cam-msg');
    if (!video) return;

    var say = function (t) {
      if (msg) msg.textContent = t;
    };

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      return;
    }

    loadHls().then(function (Hls) {
      if (!Hls.isSupported()) return say('HLS not supported in this browser');

      destroyPlayer();
      activeHls = new Hls({ lowLatencyMode: true });
      activeHls.on(Hls.Events.ERROR, function (_, d) {
        if (d && d.fatal) {
          say('Stream unavailable (offline, expired token, or blocked by CORS)');
        }
      });
      activeHls.loadSource(url);
      activeHls.attachMedia(video);
    }).catch(function () {
      say('Could not load video player');
    });
  }

  function addToMap(list) {
    var data = toGeoJSON(list);
    var src = map.getSource(CONFIG.SOURCE_ID);

    if (src) {
      src.setData(data);
      return;
    }

    map.addSource(CONFIG.SOURCE_ID, { type: 'geojson', data: data });

    // Small camera silhouette so cameras are instantly distinguishable from places/vehicles.
    if (!map.hasImage('tm-camera-icon')) {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      var cx = cv.getContext('2d');
      cx.fillStyle = '#ffb703';
      cx.strokeStyle = '#111827';
      cx.lineWidth = 1.8;
      cx.beginPath();
      cx.roundRect(4, 10, 24, 15, 3);
      cx.moveTo(10, 10); cx.lineTo(13, 6); cx.lineTo(20, 6); cx.lineTo(22, 10);
      cx.closePath(); cx.fill(); cx.stroke();
      cx.fillStyle = '#071018';
      cx.beginPath(); cx.arc(16, 17.5, 5, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = '#dff8ff';
      cx.beginPath(); cx.arc(16, 17.5, 2.4, 0, Math.PI * 2); cx.fill();
      map.addImage('tm-camera-icon', cv.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
    }

    map.addLayer({
      id: CONFIG.LAYER_ID,
      type: 'symbol',
      source: CONFIG.SOURCE_ID,
      layout: {
        'icon-image': 'tm-camera-icon',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.28, 6, 0.42, 12, 0.62],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      }
    });

    map.on('mouseenter', CONFIG.LAYER_ID, function () {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', CONFIG.LAYER_ID, function () {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', CONFIG.LAYER_ID, function (ev) {
      var f = ev.features && ev.features[0];
      if (!f) return;

      var p = f.properties;
      destroyPlayer();

      var popup = new maplibregl.Popup({ maxWidth: '300px' })
        .setLngLat(f.geometry.coordinates)
        .setHTML(popupHTML(p))
        .addTo(map);

      popup.on('close', destroyPlayer);

      if (p.kind === 'hls') {
        attachHls(safeUrl(p.url), p.cors);
      }
    });
  }

  function load() {
    if (loadPromise) return loadPromise;

    loadPromise = fetch(CONFIG.CATALOGUE_URL, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('catalogue HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var raw = Array.isArray(j)
          ? j
          : (j.cameras || j.items || (Array.isArray(j.features) ? j.features : []));

        var list = raw.map(normalise).filter(function (c) {
          return isFinite(c.lat) &&
            isFinite(c.lon) &&
            c.url &&
            !(CONFIG.HIDE_TOKEN_REFRESH && c.stale);
        });

        addToMap(list);
        return list.length;
      })
      .catch(function (e) {
        console.warn('[cameras]', e);
        loadPromise = null;
        return 0;
      });

    return loadPromise;
  }

  function init(m) {
    map = m || window.map;

    if (!map) {
      return console.warn('[cameras] no map instance');
    }

    var go = function () { load(); };

    if (map.isStyleLoaded()) go();
    else map.once('load', go);

    map.on('style.load', function () {
      if (!map.getSource(CONFIG.SOURCE_ID)) {
        loadPromise = null;
        load();
      }
    });
  }

  window.TrackMeNowCameras = { init: init, load: load };
})();
