/* TrackMeNow — Universe + Solar System immersive views */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const OG_VER = '0.28.7';
  const OG_JS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.es.js';
  const OG_CSS = 'https://cdn.jsdelivr.net/npm/@openglobus/og@' + OG_VER + '/lib/og.css';

  /* ───────── Real space data ─────────
   * Planets: NASA/JPL "Approximate Positions of the Planets" Keplerian elements (valid 1800–2050),
   *   evaluated for the current date, so positions are real, not drawn at made-up angles.
   *   el = [a AU, a/cy, e, e/cy, I deg, I/cy, L deg, L/cy, long.peri deg, /cy, long.node deg, /cy]
   * Small bodies, comets, close approaches, spacecraft, exoplanet hosts: ./data/nasa.json, fetched from
   *   NASA/JPL (Horizons, Small-Body DB, CNEOS) and the NASA Exoplanet Archive at deploy time. */
  const DEG = Math.PI / 180, AU_KM = 149597870.7, C_KMS = 299792.458, LD_AU = 0.00256955, LY_PER_PC = 3.26156;
  const PLANETS = [
    { id: 'sun', name: 'Sun', color: '#FDB813', r: 13, type: 'star', diam: 1392700 },
    { id: 'mercury', name: 'Mercury', color: '#B5B5B5', r: 3.2, type: 'planet', diam: 4879, el: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081] },
    { id: 'venus', name: 'Venus', color: '#E8CDA0', r: 4.6, type: 'planet', diam: 12104, el: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418] },
    { id: 'earth', name: 'Earth', color: '#3D8BFF', r: 4.8, engine: 'earth', type: 'planet', diam: 12756, el: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0, 0] },
    { id: 'mars', name: 'Mars', color: '#C1440E', r: 4, engine: 'mars', type: 'planet', diam: 6792, el: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343] },
    { id: 'jupiter', name: 'Jupiter', color: '#C88B3A', r: 9, type: 'planet', diam: 142984, el: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106] },
    { id: 'saturn', name: 'Saturn', color: '#E6D3A3', r: 8, type: 'planet', diam: 120536, el: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794] },
    { id: 'uranus', name: 'Uranus', color: '#7EC8E3', r: 6, type: 'planet', diam: 51118, el: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589] },
    { id: 'neptune', name: 'Neptune', color: '#3F54BA', r: 6, type: 'planet', diam: 49528, el: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664] },
    { id: 'pluto', name: 'Pluto', color: '#C9B8A8', r: 2.6, type: 'dwarf', diam: 2376, el: [39.48211675, -0.00031596, 0.24882730, 0.00005170, 17.14001206, 0.00004818, 238.92903833, 145.20780515, 224.06891629, -0.04062942, 110.30393684, -0.01183482] }
  ];
  PLANETS.forEach(function (p) { p.k = 'planet'; p.ref = p; });
  const MOON = { k: 'moon', ref: null, name: 'Moon', engine: 'moon', color: '#C8C8C8' }; MOON.ref = MOON;
  const SKY_GROUPS = [
    { key: 'belt', src: 'mainBelt', name: 'Main-belt asteroid', color: 'rgba(140,175,230,.7)', size: 1.1 },
    { key: 'trojans', src: 'trojans', name: 'Jupiter Trojan', color: 'rgba(90,220,190,.75)', size: 1.1 },
    { key: 'tno', src: 'tno', name: 'Trans-Neptunian / Centaur', color: 'rgba(190,140,255,.85)', size: 1.4 },
    { key: 'neo', src: 'neo', name: 'Near-Earth asteroid', color: 'rgba(255,180,80,.95)', size: 1.7 },
    { key: 'comets', src: 'comets', name: 'Comet', color: '#aef0ff', size: 2.2 }
  ];
  let NASA = null, nasaState = 'loading', nasaPromise = null, hostsGal = null;
  let simOffset = 0, simSpeed = 0, lastFrameT = 0, panX = 0, panY = 0, skySel = null, skyHits = [];
  const skyLayers = { orbits: true, belt: true, trojans: true, tno: true, neo: true, comets: true, craft: true, labels: true, hosts: true, star: true, neb: true, gal: true, bh: true, cl: true };

  /* Universe catalogue: published values (distances in parsecs). [name, type, RA°, Dec°, d_pc, label priority, note] */
  const UNI_CAT = [
    ['Proxima Centauri', 'star', 217.429, -62.680, 1.301, 1, 'Closest known star to the Sun. A red dwarf with a confirmed planet (Proxima b) in its habitable zone.'],
    ['Alpha Centauri', 'star', 219.900, -60.834, 1.34, 2, 'Nearest bright star system: a Sun-like pair orbiting each other every ~80 years.'],
    ["Barnard's Star", 'star', 269.452, 4.693, 1.828, 2, 'Red dwarf with the largest known proper motion of any star, about 6 light-years away.'],
    ['Sirius', 'star', 101.287, -16.716, 2.637, 1, "Brightest star in Earth's night sky; a binary with a white-dwarf companion."],
    ['Vega', 'star', 279.235, 38.784, 7.68, 2, 'Bright blue-white star in Lyra, long used as a reference for stellar brightness.'],
    ['Polaris', 'star', 37.955, 89.264, 133, 2, 'The current North Star; a Cepheid variable in a multiple-star system.'],
    ['Betelgeuse', 'star', 88.793, 7.407, 168, 1, 'Red supergiant in Orion. Distance estimates vary (about 500 to 700 light-years).'],
    ['Rigel', 'star', 78.634, -8.202, 264, 2, 'Blue supergiant in Orion, about 860 light-years away.'],
    ['Eta Carinae', 'star', 161.265, -59.684, 2350, 2, 'Massive, unstable star system that erupted in the 1840s, inside the Carina Nebula.'],
    ['Helix Nebula', 'neb', 337.411, -20.837, 200, 3, 'One of the closest planetary nebulae: the shell shed by a dying Sun-like star.'],
    ['Orion Nebula (M42)', 'neb', 83.822, -5.391, 412, 1, 'Nearest massive star-forming region, visible to the naked eye.'],
    ['Ring Nebula (M57)', 'neb', 283.396, 33.029, 700, 3, 'Planetary nebula in Lyra, about 2,300 light-years away.'],
    ['Eagle Nebula (M16)', 'neb', 274.700, -13.807, 1740, 2, 'Star-forming region containing the "Pillars of Creation".'],
    ['Crab Nebula (M1)', 'neb', 83.633, 22.015, 2000, 1, 'Remnant of the supernova recorded in 1054 AD, with a pulsar at its centre.'],
    ['Carina Nebula', 'neb', 161.250, -59.870, 2350, 2, 'Giant star-forming nebula and home of Eta Carinae.'],
    ['Gaia BH1', 'bh', 262.171, -0.581, 480, 2, 'One of the closest known black holes, about 10 solar masses, found in orbit with a Sun-like star.'],
    ['Cygnus X-1', 'bh', 299.590, 35.202, 2220, 1, 'One of the first black holes identified: about 21 solar masses, feeding on a blue supergiant companion.'],
    ['V404 Cygni', 'bh', 306.016, 33.867, 2390, 3, 'Black hole of about 9 solar masses in a binary, known for its bright 2015 outburst.'],
    ['Sagittarius A*', 'bh', 266.417, -29.008, 8178, 1, 'Supermassive black hole at the centre of the Milky Way, about 4.3 million solar masses.'],
    ['Large Magellanic Cloud', 'gal', 80.894, -69.756, 50000, 1, 'Satellite galaxy of the Milky Way; home of supernova SN 1987A.'],
    ['Small Magellanic Cloud', 'gal', 13.187, -72.829, 62000, 2, 'Dwarf satellite galaxy of the Milky Way.'],
    ['Andromeda Galaxy (M31)', 'gal', 10.685, 41.269, 765000, 1, 'Nearest large galaxy, about 2.5 million light-years away; on course to merge with the Milky Way in billions of years.'],
    ['Triangulum Galaxy (M33)', 'gal', 23.462, 30.660, 840000, 2, 'Third-largest galaxy in the Local Group.'],
    ['Centaurus A', 'gal', 201.365, -43.019, 3.8e6, 2, 'Nearest active radio galaxy, powered by a supermassive black hole.'],
    ['M81 (Bode\'s Galaxy)', 'gal', 148.888, 69.065, 3.6e6, 3, 'Grand-design spiral galaxy in Ursa Major.'],
    ['Pinwheel Galaxy (M101)', 'gal', 210.802, 54.349, 6.4e6, 3, 'Large face-on spiral galaxy in Ursa Major.'],
    ['Whirlpool Galaxy (M51)', 'gal', 202.470, 47.195, 8.6e6, 2, 'Face-on spiral interacting with a smaller companion galaxy.'],
    ['Sombrero Galaxy (M104)', 'gal', 189.998, -11.623, 9.55e6, 3, 'Spiral galaxy with a bright nucleus and a prominent dust lane.'],
    ['M87 (Virgo A)', 'gal', 187.706, 12.391, 1.64e7, 2, 'Giant elliptical galaxy and host of the first black hole ever imaged.'],
    ['M87*', 'bh', 187.706, 12.391, 1.64e7, 1, 'First black hole ever imaged (Event Horizon Telescope, 2019): about 6.5 billion solar masses.'],
    ['Virgo Cluster', 'cl', 186.750, 12.720, 1.65e7, 1, 'Nearest large galaxy cluster, with over a thousand member galaxies.'],
    ['Perseus Cluster', 'cl', 49.950, 41.512, 7.3e7, 2, 'Massive galaxy cluster embedded in a vast halo of hot gas seen by X-ray telescopes.'],
    ['Coma Cluster', 'cl', 194.953, 27.981, 9.9e7, 2, 'Rich cluster of thousands of galaxies, where dark matter was first inferred (Zwicky, 1933).'],
    ['3C 273', 'gal', 187.278, 2.052, 7.49e8, 1, 'Bright quasar: a feeding supermassive black hole outshining its host galaxy. About 2.4 billion light-years away.'],
    ['JADES-GS-z14-0', 'gal', 53.083, -27.857, 1.04e10, 1, 'Very distant galaxy seen by JWST as it was about 290 million years after the Big Bang (redshift 14.3). Distance shown is the approximate comoving distance.']
  ];
  const UNI_TYPES = { star: 'Star', neb: 'Nebula', gal: 'Galaxy', bh: 'Black hole', cl: 'Galaxy cluster' };
  UNI_CAT.forEach(function (o) { const g = galactic(o[2], o[3]); o.l = g.l; o.b = g.b; });

  let scale = 'earth', earthMode = 'flat', dayNight = false, openDrawer = null;
  let globe = null, og = null, maplibre = null;
  let solarZoom = 1, solarCanvas = null, solarCtx = null, animId = 0;
  let activeWx = { satellite: true, live: true, radar: false, dark: false, precip: false, wind: false, temp: false, humidity: false, pressure: false, events: true, quakes: true, fires: false };
  let rvHost = '', rvFrames = [], rvIndex = 0, playTimer = null, playing = false;
  let terminatorTimer = null, forecastTimer = null, gibsDayOffset = -1;

  function setStatus(msg, ok) {
    const el = $('status');
    if (!el) return;
    el.innerHTML = '<span style="color:' + (ok === false ? '#ff6672' : '#43e0a0') + '">●</span> ' + msg;
  }
  function ensureCss(href) {
    if (document.querySelector('link[data-og-css]')) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.setAttribute('data-og-css', '1');
    document.head.appendChild(l);
  }
  function sunLonLat(date) {
    const d = date || new Date();
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const day = (d - start) / 86400000;
    const decl = 23.44 * Math.sin((2 * Math.PI / 365) * (day - 81));
    const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    return { lon: 15 * (12 - utcH), lat: decl };
  }
  function normalizeLon(lon) {
    while (lon > 180) lon -= 360; while (lon < -180) lon += 360; return lon;
  }
  function terminatorFeatures(date) {
    const sun = sunLonLat(date); const steps = 90;
    function offsetRing(deltaHa) {
      const r = [];
      for (let i = 0; i <= steps; i++) {
        const lat = -90 + (180 * i) / steps;
        const latRad = lat * Math.PI / 180, sunLatRad = sun.lat * Math.PI / 180;
        let cosHA = -Math.tan(latRad) * Math.tan(sunLatRad);
        if (!isFinite(cosHA)) cosHA = 0; cosHA = Math.max(-1, Math.min(1, cosHA));
        r.push([normalizeLon(sun.lon + Math.acos(cosHA) * 180 / Math.PI + deltaHa), lat]);
      }
      for (let i = steps; i >= 0; i--) {
        const lat = -90 + (180 * i) / steps;
        const latRad = lat * Math.PI / 180, sunLatRad = sun.lat * Math.PI / 180;
        let cosHA = -Math.tan(latRad) * Math.tan(sunLatRad);
        if (!isFinite(cosHA)) cosHA = 0; cosHA = Math.max(-1, Math.min(1, cosHA));
        r.push([normalizeLon(sun.lon - Math.acos(cosHA) * 180 / Math.PI + deltaHa), lat]);
      }
      r.push(r[0]); return r;
    }
    return { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { soft: 0 }, geometry: { type: 'Polygon', coordinates: [offsetRing(0)] } },
      { type: 'Feature', properties: { soft: 1 }, geometry: { type: 'Polygon', coordinates: [offsetRing(-4)] } },
      { type: 'Feature', properties: { soft: 2 }, geometry: { type: 'Polygon', coordinates: [offsetRing(-8)] } }
    ]};
  }
  function gibsDateStr() {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + gibsDayOffset);
    return d.toISOString().slice(0, 10);
  }
  function updateTimeLabel() {
    const el = $('tm-time-label'); if (!el) return;
    if (rvFrames.length && activeWx.radar) {
      el.textContent = new Date((rvFrames[rvIndex].time || 0) * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return;
    }
    el.textContent = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · ' + gibsDateStr();
  }
  function applyGibsDay() {
    updateTimeLabel();
    if (!maplibre || scale !== 'earth') return;
    const date = gibsDateStr();
    try {
      if (maplibre.getSource('gibs')) {
        maplibre.getSource('gibs').setTiles(['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' + date + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg']);
        if (maplibre.getLayer('gibs-live')) {
          const vis = activeWx.live && !activeWx.dark ? 'visible' : 'none';
          maplibre.setLayoutProperty('gibs-live', 'visibility', 'none');
          setTimeout(function () { try { maplibre.setLayoutProperty('gibs-live', 'visibility', vis); } catch (e) {} }, 30);
        }
      }
      if (maplibre.getSource('fires')) maplibre.getSource('fires').setTiles(['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/' + date + '/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png']);
      setStatus('EARTH · imagery ' + date, true);
    } catch (e) { if (scale === 'earth') enterEarth(); }
  }

  async function loadActivity() {
    if (!maplibre) return;
    if (activeWx.events) {
      try {
        const j = await (await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=80')).json();
        const feats = [];
        (j.events || []).forEach(function (ev) {
          const cats = (ev.categories || []).map(function (c) { return c.title; }).join(', ');
          (ev.geometry || []).forEach(function (g) {
            if (g.type === 'Point' && g.coordinates) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [g.coordinates[0], g.coordinates[1]] }, properties: { title: ev.title, category: cats } });
          });
        });
        if (maplibre.getSource('eonet')) maplibre.getSource('eonet').setData({ type: 'FeatureCollection', features: feats });
      } catch (e) {}
    } else if (maplibre.getSource('eonet')) maplibre.getSource('eonet').setData({ type: 'FeatureCollection', features: [] });
    if (activeWx.quakes) {
      try {
        const j = await (await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')).json();
        if (maplibre.getSource('quakes')) maplibre.getSource('quakes').setData(j);
      } catch (e) {}
    } else if (maplibre.getSource('quakes')) maplibre.getSource('quakes').setData({ type: 'FeatureCollection', features: [] });
  }

  function injectChrome() {
    if ($('tm-universe-chrome')) return;
    const box = document.createElement('div');
    box.id = 'tm-universe-chrome';
    box.innerHTML = [
      '<div style="position:fixed;z-index:2200;left:50%;top:58px;transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:96vw">',
      '  <button data-scale="universe" class="tm-scale-btn">Universe</button>',
      '  <button data-scale="solar" class="tm-scale-btn">Solar System</button>',
      '  <button data-scale="earth" class="tm-scale-btn">Earth Live</button>',
      '  <button data-scale="moon" class="tm-scale-btn">Moon</button>',
      '  <button data-scale="mars" class="tm-scale-btn">Mars</button>',
      '</div>',
      '<div id="tm-drawer-live" class="tm-drawer" style="display:none">',
      '  <div class="tm-drawer-title">LIVE MAPS</div>',
      '  <button data-wx="live" class="tm-drawer-item on">Live clouds (VIIRS)</button>',
      '  <button data-wx="radar" class="tm-drawer-item">Radar</button>',
      '  <button data-wx="fires" class="tm-drawer-item">Active fires</button>',
      '  <button data-wx="events" class="tm-drawer-item on">EONET events</button>',
      '  <button data-wx="quakes" class="tm-drawer-item on">Earthquakes</button>',
      '  <button data-wx="dark" class="tm-drawer-item">Dark base</button>',
      '</div>',
      '<div id="tm-drawer-weather" class="tm-drawer" style="display:none">',
      '  <div class="tm-drawer-title">FORECAST MAPS</div>',
      '  <button data-wx="precip" class="tm-drawer-item">Precipitation</button>',
      '  <button data-wx="wind" class="tm-drawer-item">Wind</button>',
      '  <button data-wx="temp" class="tm-drawer-item">Temperature</button>',
      '  <button data-wx="humidity" class="tm-drawer-item">Humidity</button>',
      '  <button data-wx="pressure" class="tm-drawer-item">Pressure</button>',
      '</div>',
      '<div id="tm-bottom-bar">',
      '  <button data-bar="satellite" class="tm-bar-btn on">Satellite</button>',
      '  <button data-bar="live" class="tm-bar-btn">Live</button>',
      '  <button data-bar="flat" class="tm-bar-btn on">Flat</button>',
      '  <button data-bar="globe" class="tm-bar-btn">3D</button>',
      '  <button data-bar="weather" class="tm-bar-btn">Weather</button>',
      '  <button data-bar="daynight" class="tm-bar-btn">Day/Night</button>',
      '</div>',
      '<div id="tm-timebar" style="display:none">',
      '  <button id="tm-play" type="button" class="tm-play">▶</button>',
      '  <button id="tm-day-prev" type="button" class="tm-tbtn">◀ day</button>',
      '  <button id="tm-prev" type="button" class="tm-tbtn">◀</button>',
      '  <div id="tm-time-label" style="min-width:150px;text-align:center;font-weight:700">—</div>',
      '  <button id="tm-next" type="button" class="tm-tbtn">▶</button>',
      '  <button id="tm-day-next" type="button" class="tm-tbtn">day ▶</button>',
      '  <input id="tm-time-slider" type="range" min="0" max="0" value="0" style="width:160px">',
      '</div>',
      '<div id="tm-wx-readout" style="display:none"></div>',
      '<div id="tm-wx-legend" style="display:none;position:fixed;z-index:2280;left:14px;bottom:78px;padding:6px 12px;border-radius:8px;background:rgba(8,12,18,.92);border:1px solid rgba(255,255,255,.14);font:11px system-ui;color:#e8f0f6"></div>',
      '<div id="tm-zoom-stack">',
      '  <button id="tm-zoom-in" class="tm-z">+</button>',
      '  <button id="tm-zoom-out" class="tm-z">−</button>',
      '  <button id="tm-zoom-home" class="tm-z" style="font-size:12px">⌂</button>',
      '</div>',
      '<style>',
      '.tm-scale-btn,.tm-z,.tm-tbtn,.tm-bar-btn,.tm-drawer-item{border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(6,12,18,.92);color:#eaf4fa;cursor:pointer;font:700 11px system-ui}',
      '.tm-scale-btn{padding:8px 12px}',
      '.tm-scale-btn.on{border-color:#4fd0a0;color:#4fd0a0;box-shadow:0 0 12px #4fd0a044}',
      '#tm-bottom-bar{position:fixed;z-index:2300;left:50%;bottom:14px;transform:translateX(-50%);display:none;gap:6px;padding:8px 10px;border-radius:14px;background:rgba(8,12,18,.94);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);flex-wrap:wrap;justify-content:center;max-width:96vw}',
      '.tm-bar-btn{padding:10px 14px;border-radius:10px;white-space:nowrap}',
      '.tm-bar-btn.on{border-color:#4fd0a0;color:#4fd0a0;background:rgba(79,208,160,.12)}',
      '.tm-drawer{position:fixed;z-index:2290;left:50%;bottom:70px;transform:translateX(-50%);min-width:200px;max-width:90vw;padding:8px 0;border-radius:12px;background:rgba(18,14,12,.96);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);color:#f0e8e0}',
      '.tm-drawer-title{padding:4px 14px 6px;font:800 10px system-ui;letter-spacing:.6px;opacity:.65}',
      '.tm-drawer-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:#f0e8e0;padding:10px 14px;font:600 13px system-ui;border-radius:0}',
      '.tm-drawer-item:hover{background:rgba(255,255,255,.08)}',
      '.tm-drawer-item.on{background:rgba(255,255,255,.1);box-shadow:inset 3px 0 0 #4fd0a0}',
      '#tm-timebar{position:fixed;z-index:2280;left:50%;bottom:72px;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12px;background:rgba(8,12,18,.92);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace}',
      '#tm-time-label{min-width:150px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}',
      '.tm-play{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(69,168,255,.25);color:#fff;cursor:pointer}',
      '.tm-tbtn{width:auto;min-width:32px;height:32px;padding:0 8px}',
      '#tm-wx-readout{position:fixed;z-index:2200;left:12px;bottom:90px;padding:10px 12px;border-radius:10px;background:rgba(8,14,20,.9);border:1px solid rgba(255,255,255,.15);color:#e8f0f6;font:11px ui-monospace;max-width:240px}',
      '#tm-zoom-stack{position:fixed;z-index:2200;right:14px;bottom:100px;display:flex;flex-direction:column;gap:6px}',
      '.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-right{display:none!important}',
      '.tm-z{width:40px;height:40px;font-size:20px;font-weight:900;padding:0}',
      '#tm-solar-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;background:#010208;cursor:grab;z-index:2}',
      '</style>'
    ].join('');
    document.body.appendChild(box);
    box.querySelectorAll('[data-scale]').forEach(function (b) { b.onclick = function () { setScale(b.getAttribute('data-scale')); }; });
    box.querySelectorAll('[data-bar]').forEach(function (b) {
      b.onclick = function () {
        const k = b.getAttribute('data-bar');
        if (k === 'satellite') { activeWx.satellite = true; activeWx.dark = false; applyLayers(); syncBar(); }
        else if (k === 'live') toggleDrawer(openDrawer === 'live' ? null : 'live');
        else if (k === 'weather') toggleDrawer(openDrawer === 'weather' ? null : 'weather');
        else if (k === 'flat') { earthMode = 'flat'; if (scale === 'earth') enterEarth(); syncBar(); }
        else if (k === 'globe') { earthMode = 'globe'; if (scale === 'earth') enterEarth(); syncBar(); }
        else if (k === 'daynight') { dayNight = !dayNight; if (scale === 'earth') applyDayNight(); syncBar(); }
      };
    });
    box.querySelectorAll('[data-wx]').forEach(function (b) {
      b.onclick = function () {
        const k = b.getAttribute('data-wx');
        activeWx[k] = !activeWx[k];
        if (k === 'dark' && activeWx.dark) activeWx.satellite = true;
        if (k === 'live' && activeWx.live) activeWx.dark = false;
        if (['temp', 'humidity', 'pressure', 'wind', 'precip'].indexOf(k) >= 0) {
          ['temp','humidity','pressure','wind','precip'].forEach(function(m){ if(m!==k) activeWx[m]=false; });
          syncDrawerItems(); applyLayers(); refreshForecast(); return;
        }
        syncDrawerItems(); applyLayers();
        if (k === 'events' || k === 'quakes') loadActivity();
      };
    });
    $('tm-zoom-in').onclick = function () { zoomBy(1); };
    $('tm-zoom-out').onclick = function () { zoomBy(-1); };
    $('tm-zoom-home').onclick = function () {
      if (maplibre) maplibre.flyTo({ center: [20, 15], zoom: earthMode === 'globe' ? 1.5 : 2, duration: 800 });
      else if (scale === 'solar' || scale === 'universe') resetSky();
    };
    $('tm-play').onclick = togglePlay;
    $('tm-prev').onclick = function () { stepFrame(-1); };
    $('tm-next').onclick = function () { stepFrame(1); };
    $('tm-time-slider').oninput = function () { rvIndex = parseInt(this.value, 10) || 0; applyRadar(); updateTime(); };
    if ($('tm-day-prev')) $('tm-day-prev').onclick = function () { gibsDayOffset = Math.max(-14, gibsDayOffset - 1); applyGibsDay(); };
    if ($('tm-day-next')) $('tm-day-next').onclick = function () { gibsDayOffset = Math.min(0, gibsDayOffset + 1); applyGibsDay(); };
    document.addEventListener('click', function (e) {
      if (!openDrawer) return;
      const t = e.target;
      if (t.closest && (t.closest('.tm-drawer') || t.closest('[data-bar="live"]') || t.closest('[data-bar="weather"]'))) return;
      toggleDrawer(null);
    });
  }

  function toggleDrawer(which) {
    openDrawer = which;
    if ($('tm-drawer-live')) $('tm-drawer-live').style.display = which === 'live' ? 'block' : 'none';
    if ($('tm-drawer-weather')) $('tm-drawer-weather').style.display = which === 'weather' ? 'block' : 'none';
    syncBar();
  }
  function syncBar() {
    document.querySelectorAll('[data-bar]').forEach(function (b) {
      const k = b.getAttribute('data-bar'); let on = false;
      if (k === 'satellite') on = activeWx.satellite && !activeWx.dark;
      if (k === 'live') on = openDrawer === 'live' || activeWx.live || activeWx.radar || activeWx.events || activeWx.quakes;
      if (k === 'flat') on = earthMode === 'flat';
      if (k === 'globe') on = earthMode === 'globe';
      if (k === 'weather') on = openDrawer === 'weather' || activeWx.temp || activeWx.wind || activeWx.precip || activeWx.humidity || activeWx.pressure;
      if (k === 'daynight') on = dayNight;
      b.classList.toggle('on', on);
    });
  }
  function syncDrawerItems() {
    document.querySelectorAll('[data-wx]').forEach(function (b) { b.classList.toggle('on', !!activeWx[b.getAttribute('data-wx')]); });
  }
  function markChrome() {
    document.querySelectorAll('[data-scale]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-scale') === scale); });
    const show = scale === 'earth';
    if ($('tm-bottom-bar')) $('tm-bottom-bar').style.display = show ? 'flex' : 'none';
    ['tm-timebar', 'tm-wx-readout'].forEach(function (id) {
      const el = $(id); if (el) el.style.display = show ? (id === 'tm-timebar' ? 'flex' : 'block') : 'none';
    });
    if (!show) toggleDrawer(null);
  }

  /* ───────── orbital math ───────── */
  function galactic(ra, dec) { /* equatorial J2000 -> galactic longitude / latitude (degrees) */
    const aG = 192.85948 * DEG, dG = 27.12825 * DEG, lN = 122.93192 * DEG, a = ra * DEG, d = dec * DEG;
    const sb = Math.sin(d) * Math.sin(dG) + Math.cos(d) * Math.cos(dG) * Math.cos(a - aG);
    const l = lN - Math.atan2(Math.cos(d) * Math.sin(a - aG), Math.sin(d) * Math.cos(dG) - Math.cos(d) * Math.sin(dG) * Math.cos(a - aG));
    return { l: ((l / DEG) % 360 + 360) % 360, b: Math.asin(Math.max(-1, Math.min(1, sb))) / DEG };
  }
  function solveKepler(M, e) {
    let E = e < 0.8 ? M : Math.PI;
    for (let k = 0; k < 14; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-9) break; }
    return E;
  }
  /* heliocentric ecliptic J2000 position in AU from classical elements (degrees) */
  function keplerPos(a, e, I, Om, w, M) {
    M = ((M % 360) + 360) % 360; if (M > 180) M -= 360;
    const E = solveKepler(M * DEG, e);
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(w * DEG), sw = Math.sin(w * DEG), cO = Math.cos(Om * DEG), sO = Math.sin(Om * DEG), cI = Math.cos(I * DEG), sI = Math.sin(I * DEG);
    return [(cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
            (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
            (sw * sI) * xp + (cw * sI) * yp];
  }
  function planetElems(p, jd) {
    const T = (jd - 2451545) / 36525, q = p.el;
    const a = q[0] + q[1] * T, e = q[2] + q[3] * T, I = q[4] + q[5] * T, L = q[6] + q[7] * T, wb = q[8] + q[9] * T, Om = q[10] + q[11] * T;
    return { a: a, e: e, I: I, Om: Om, w: wb - Om, M: L - wb };
  }
  function planetPos(p, jd) {
    if (!p.el) return [0, 0, 0];
    const k = planetElems(p, jd); return keplerPos(k.a, k.e, k.I, k.Om, k.w, k.M);
  }
  const rowPos = (row, jd) => keplerPos(row[1], row[2], row[3], row[4], row[5], row[6] + 360 * (jd - row[7]) / row[8]);
  function craftPos(c, jd) { /* linear interpolation of JPL Horizons samples; frozen at the window edges */
    const n = c.p.length, f = (jd - c.jd0) / c.step, i = Math.max(0, Math.min(n - 2, Math.floor(f))), u = Math.max(0, Math.min(1, f - i));
    const A = c.p[i], B = c.p[i + 1];
    return { pos: [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u], inWindow: f >= -0.001 && f <= n - 0.999,
      v: Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) / c.step * AU_KM / 86400 };
  }
  const visViva = (r, a) => Math.sqrt(2.959122082855911e-4 * (2 / r - 1 / a)) * AU_KM / 86400;
  const vlen = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const nowJD = () => Date.now() / 86400000 + 2440587.5;
  const simJD = () => nowJD() + simOffset;
  const jdDate = (jd) => new Date((jd - 2440587.5) * 86400000);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  const nf = (v, d) => Number(v).toLocaleString(undefined, { maximumFractionDigits: d == null ? 0 : d });
  function lightTime(au) { const s = au * AU_KM / C_KMS; return s < 90 ? nf(s, 1) + ' s' : s < 5400 ? nf(s / 60, 1) + ' min' : s < 172800 ? nf(s / 3600, 1) + ' h' : nf(s / 86400, 1) + ' days'; }
  function dist(au) { return nf(au, au < 10 ? 3 : 1) + ' AU (' + nf(au * AU_KM / 1e6, au < 0.1 ? 2 : 1) + ' million km)'; }
  function period(days) { return days < 800 ? nf(days, 1) + ' days' : nf(days / 365.25, days / 365.25 < 10 ? 2 : 1) + ' years'; }
  function ldist(pc) { const ly = pc * LY_PER_PC; return ly < 1e4 ? nf(ly, ly < 100 ? 2 : 0) + ' light-years' : ly < 1e6 ? nf(ly / 1e3, 1) + ' thousand light-years' : ly < 1e9 ? nf(ly / 1e6, 1) + ' million light-years' : nf(ly / 1e9, 2) + ' billion light-years'; }
  function pcStr(pc) { return pc < 1e3 ? nf(pc, pc < 10 ? 2 : 0) + ' pc' : pc < 1e6 ? nf(pc / 1e3, 1) + ' kpc' : pc < 1e9 ? nf(pc / 1e6, 1) + ' Mpc' : nf(pc / 1e9, 2) + ' Gpc'; }

  /* ───────── NASA data feed ───────── */
  function loadNasa() {
    if (nasaPromise) return nasaPromise;
    nasaPromise = fetch('./data/nasa.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
      NASA = j; nasaState = 'ok';
      (j.exoplanetHosts || []).forEach(function (h) { const g = galactic(h[1], h[2]); h.l = g.l; h.lr = Math.log10(Math.max(0.3, h[3])); });
    }).catch(function (e) { nasaState = 'offline'; NASA = null; console.warn('NASA data feed unavailable:', e.message || e); }).then(function () { renderSkyPanel(); updateSkyStatus(); });
    return nasaPromise;
  }
  function feedAge() {
    if (!NASA || !NASA.meta) return '';
    const m = Math.max(0, (Date.now() - Date.parse(NASA.meta.generated)) / 60000);
    return m < 90 ? Math.round(m) + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  }
  function updateSkyStatus() {
    if (scale === 'solar') {
      const n = NASA ? ((NASA.mainBelt || []).length + (NASA.neo || []).length + (NASA.trojans || []).length + (NASA.tno || []).length + (NASA.comets || []).length) : 0;
      setStatus('SOLAR SYSTEM · ' + (NASA ? nf(n) + ' small bodies · ' + (NASA.spacecraft || []).length + ' spacecraft · NASA/JPL data ' + feedAge() : nasaState === 'loading' ? 'loading NASA/JPL data…' : 'planets from NASA/JPL elements · live feed offline'), nasaState !== 'offline');
    } else if (scale === 'universe') {
      const h = NASA && NASA.exoplanetHosts ? NASA.exoplanetHosts.length : 0;
      setStatus('UNIVERSE · ' + (h ? nf(h) + ' stars with confirmed planets (NASA Exoplanet Archive) · ' : '') + UNI_CAT.length + ' catalogue objects', true);
    }
  }

  /* ───────── side panel ───────── */
  function ensureSkyPanel() {
    let p = $('tm-sky-panel'); if (p) return p;
    const st = document.createElement('style');
    st.textContent = '#tm-sky-panel{position:fixed;left:12px;top:160px;width:268px;max-height:calc(100vh - 250px);overflow:auto;z-index:30;background:rgba(5,10,18,.86);border:1px solid rgba(120,160,210,.28);border-radius:12px;padding:10px 12px;color:#dbe7f3;font:12px/1.45 system-ui,sans-serif;backdrop-filter:blur(6px);display:none}' +
      '#tm-sky-panel b{color:#fff}#tm-sky-panel .sk-h{font:600 10px/1 ui-monospace,monospace;letter-spacing:.12em;color:#7fb6ff;margin:10px 0 6px;text-transform:uppercase}#tm-sky-panel .sk-h:first-child{margin-top:0}' +
      '#tm-sky-panel .sk-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;border-bottom:1px solid rgba(120,160,210,.1)}#tm-sky-panel .sk-row span:first-child{color:#8aa0b6}#tm-sky-panel .sk-row span:last-child{text-align:right}' +
      '#tm-sky-panel .sk-btns{display:flex;flex-wrap:wrap;gap:5px}#tm-sky-panel button{background:#0c1624;border:1px solid rgba(120,160,210,.3);color:#dbe7f3;border-radius:7px;padding:4px 8px;font:11px system-ui;cursor:pointer}#tm-sky-panel button.on{background:#12385e;border-color:#4aa3ff;color:#fff}' +
      '#tm-sky-panel label{display:inline-flex;align-items:center;gap:5px;margin:0 8px 4px 0;cursor:pointer;font-size:11px}#tm-sky-panel .sk-note{color:#8aa0b6;font-size:11px;margin-top:6px}#tm-sky-panel .sk-sw{width:9px;height:9px;border-radius:50%;display:inline-block}' +
      '#tm-sky-tip{position:fixed;z-index:31;pointer-events:none;background:rgba(5,10,18,.92);border:1px solid rgba(120,160,210,.35);color:#fff;font:11px system-ui;padding:3px 7px;border-radius:6px;display:none;white-space:nowrap}' +
      '@media(max-width:700px){#tm-sky-panel{top:auto;bottom:70px;left:8px;right:66px;width:auto;max-height:34vh}}';
    document.head.appendChild(st);
    p = document.createElement('div'); p.id = 'tm-sky-panel'; document.body.appendChild(p);
    const tip = document.createElement('div'); tip.id = 'tm-sky-tip'; document.body.appendChild(tip);
    p.addEventListener('click', function (e) {
      const t = e.target.closest('[data-sk]'); if (!t) return;
      const k = t.getAttribute('data-sk'), v = t.getAttribute('data-v');
      if (k === 'speed') { simSpeed = +v; if (!simSpeed && t.hasAttribute('data-now')) simOffset = 0; renderSkyPanel(); }
      else if (k === 'go') { setScale(v); }
      else if (k === 'sel') { skySel = null; renderSkyPanel(); }
    });
    p.addEventListener('change', function (e) { const t = e.target.closest('[data-lyr]'); if (t) { skyLayers[t.getAttribute('data-lyr')] = t.checked; } });
    return p;
  }
  const row = (k, v) => '<div class="sk-row"><span>' + k + '</span><span>' + v + '</span></div>';
  function cardFor(o) {
    if (!o) return '<div class="sk-note">Click any object to see its real data.</div>';
    const jd = simJD(), earth = planetPos(PLANETS[3], jd);
    let title = '', sub = '', rows = '', btn = '', src = '';
    if (o.k === 'planet') {
      const p = o.ref; title = p.name; sub = p.type === 'star' ? 'Star' : p.type === 'dwarf' ? 'Dwarf planet' : 'Planet';
      src = 'NASA/JPL approximate-position elements';
      rows += row('Diameter', nf(p.diam) + ' km');
      if (p.el) {
        const k = planetElems(p, jd), pos = keplerPos(k.a, k.e, k.I, k.Om, k.w, k.M), r = Math.hypot(pos[0], pos[1], pos[2]), de = vlen(pos, earth);
        rows += row('From Sun', dist(r)) + (p.id !== 'earth' ? row('From Earth', dist(de)) + row('Light time to Earth', lightTime(de)) : '') +
          row('Orbital speed', nf(visViva(r, k.a), 2) + ' km/s') + row('Orbit period', period(365.256 * Math.pow(k.a, 1.5))) + row('Eccentricity', nf(k.e, 4)) + row('Inclination', nf(Math.abs(k.I), 2) + '°');
      } else rows += row('Light time to Earth', lightTime(1));
      if (p.engine) btn = '<button data-sk="go" data-v="' + p.engine + '">Land on ' + esc(p.name) + ' →</button>';
    } else if (o.k === 'moon') {
      title = 'Moon'; sub = 'Earth’s natural satellite'; src = 'Mean lunar longitude (approximate direction)';
      rows += row('Distance from Earth', 'about 384,400 km') + row('Light time to Earth', '1.3 s') + row('Orbit period', '27.3 days');
      btn = '<button data-sk="go" data-v="moon">Land on the Moon →</button>';
    } else if (o.k === 'craft') {
      const c = o.ref, cp = craftPos(c, jd), r = Math.hypot(cp.pos[0], cp.pos[1], cp.pos[2]), de = vlen(cp.pos, earth);
      title = c.name; sub = 'Spacecraft'; src = 'NASA/JPL Horizons' + (NASA && NASA.meta ? ', updated ' + feedAge() : '');
      rows += row('From Sun', dist(r)) + row('From Earth', dist(de)) + row('Light time to Earth', lightTime(de)) + row('Speed vs Sun', nf(cp.v, 2) + ' km/s') +
        (cp.inWindow ? '' : row('Note', 'time travel beyond data window: shown at last real position'));
    } else if (o.k === 'small') {
      const w = o.ref, pos = rowPos(w, jd), r = Math.hypot(pos[0], pos[1], pos[2]), de = vlen(pos, earth);
      const isC = o.cls === 'Comet'; title = w[0]; sub = o.cls + (w[10] ? ' · potentially hazardous' : ''); src = 'NASA/JPL Small-Body Database';
      rows += row('From Sun', dist(r)) + row('From Earth', dist(de)) + row('Light time to Earth', lightTime(de)) + row('Orbital speed', nf(visViva(r, w[1]), 2) + ' km/s') +
        row('Orbit period', period(w[8])) + row('Closest to Sun', nf(w[1] * (1 - w[2]), 3) + ' AU') + row('Farthest from Sun', nf(w[1] * (1 + w[2]), 2) + ' AU') + row('Inclination', nf(w[3], 1) + '°') +
        (isC ? row('Perihelion', jdDate(w[7]).toISOString().slice(0, 10)) : (w[9] != null ? row('Absolute magnitude (H)', nf(w[9], 1)) : ''));
    } else if (o.k === 'uni') {
      const u = o.ref; title = u.title; sub = u.sub; src = u.src; rows = u.rows; btn = u.btn || '';
      return '<div class="sk-h">Selected <a data-sk="sel" style="float:right;color:#8aa0b6;cursor:pointer">clear ✕</a></div><div style="font-size:14px;margin-bottom:2px"><b>' + esc(title) + '</b></div><div class="sk-note" style="margin:0 0 6px">' + esc(sub) + '</div>' + (u.text ? '<div style="margin-bottom:6px">' + esc(u.text) + '</div>' : '') + rows + '<div class="sk-note">Source: ' + esc(src) + '</div>' + (btn ? '<div style="margin-top:8px">' + btn + '</div>' : '');
    }
    return '<div class="sk-h">Selected <a data-sk="sel" style="float:right;color:#8aa0b6;cursor:pointer">clear ✕</a></div><div style="font-size:14px;margin-bottom:2px"><b>' + esc(title) + '</b></div><div class="sk-note" style="margin:0 0 6px">' + esc(sub) + '</div>' + rows + '<div class="sk-note">Source: ' + esc(src) + '</div>' + (btn ? '<div style="margin-top:8px">' + btn + '</div>' : '');
  }
  function renderSkyPanel() {
    const p = ensureSkyPanel(); if (scale !== 'solar' && scale !== 'universe') { p.style.display = 'none'; return; }
    p.style.display = 'block';
    const chk = function (k, label, color) { return '<label><input type="checkbox" data-lyr="' + k + '"' + (skyLayers[k] ? ' checked' : '') + '>' + (color ? '<span class="sk-sw" style="background:' + color + '"></span>' : '') + label + '</label>'; };
    let h = '';
    if (scale === 'solar') {
      h += '<div class="sk-h">Time</div><div id="tm-sk-time" style="margin-bottom:6px"></div><div class="sk-btns">';
      [['Live', 0], ['1 day/s', 1], ['10 days/s', 10], ['1 year/s', 365.25], ['−1 year/s', -365.25]].forEach(function (b) { h += '<button data-sk="speed" data-v="' + b[1] + '"' + (b[1] === 0 ? ' data-now="1"' : '') + (simSpeed === b[1] ? ' class="on"' : '') + '>' + b[0] + '</button>'; });
      h += '</div><div class="sk-h">Show</div>' + chk('orbits', 'Orbits') + chk('labels', 'Labels') + chk('craft', 'Spacecraft', '#ffcc00') + chk('comets', 'Comets', '#aef0ff') + chk('neo', 'Near-Earth', '#ffb450') + chk('belt', 'Main belt', '#8cafe6') + chk('trojans', 'Trojans', '#5adcbe') + chk('tno', 'Kuiper belt', '#be8cff');
      h += '<div id="tm-sk-card">' + cardFor(skySel) + '</div>';
      const ca = NASA && NASA.closeApproaches;
      h += '<div class="sk-h">Next close approaches to Earth</div>';
      if (ca && ca.length) { ca.slice(0, 8).forEach(function (c) { h += row(esc(c.des) + '<br><span style="font-size:10px">' + esc(c.cd) + ' UTC</span>', nf(c.au / LD_AU, 1) + ' lunar dist.<br><span style="font-size:10px;color:#8aa0b6">' + nf(c.vrel, 1) + ' km/s</span>'); }); h += '<div class="sk-note">Source: NASA/JPL CNEOS</div>'; }
      else h += '<div class="sk-note">' + (nasaState === 'loading' ? 'Loading…' : 'NASA feed unavailable right now.') + '</div>';
      h += '<div class="sk-note">Radial scale is compressed (square root of distance) so every planet fits. Directions and orbit shapes are real.</div>';
    } else {
      h += '<div class="sk-h">Show</div>' + chk('hosts', 'Stars with planets (NASA)', '#ffe2b0') + chk('star', 'Stars', '#fff') + chk('neb', 'Nebulae', '#ff8fb8') + chk('gal', 'Galaxies', '#9fc4ff') + chk('cl', 'Clusters', '#c8a8ff') + chk('bh', 'Black holes', '#ff9a3c');
      h += '<div id="tm-sk-card">' + cardFor(skySel) + '</div>';
      h += '<div class="sk-note">Map centred on the Sun. Angle = galactic longitude, distance from centre = log scale of real distance. Click the Sun to enter the Solar System.</div>';
    }
    p.innerHTML = h;
  }
  function refreshCard() { const c = $('tm-sk-card'); if (c) c.innerHTML = cardFor(skySel); }
  function selectSky(o) { skySel = o; refreshCard(); }

  /* ───────── canvas, input ───────── */
  function ensureSolarCanvas() {
    const map = $('map'); if (!map) return null;
    let c = $('tm-solar-canvas');
    if (!c) {
      c = document.createElement('canvas'); c.id = 'tm-solar-canvas'; c.style.touchAction = 'none'; map.appendChild(c);
      c.addEventListener('wheel', function (e) { e.preventDefault(); zoomBy(e.deltaY > 0 ? -1 : 1); }, { passive: false });
      let dragging = false, lx = 0, ly = 0, moved = 0;
      c.addEventListener('pointerdown', function (e) { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; try { c.setPointerCapture(e.pointerId); } catch (x) {} });
      c.addEventListener('pointerup', function (e) {
        const wasClick = dragging && moved < 5; dragging = false;
        if (wasClick) { const rect = c.getBoundingClientRect(), hit = pickSky(e.clientX - rect.left, e.clientY - rect.top); if (hit) onSkyPick(hit); }
      });
      c.addEventListener('pointermove', function (e) {
        const tip = $('tm-sky-tip'), rect = c.getBoundingClientRect();
        if (dragging) { panX += e.clientX - lx; panY += e.clientY - ly; moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly); lx = e.clientX; ly = e.clientY; if (tip) tip.style.display = 'none'; return; }
        const hit = pickSky(e.clientX - rect.left, e.clientY - rect.top);
        c.style.cursor = hit ? 'pointer' : 'grab';
        if (tip) { if (hit) { tip.textContent = hit.name; tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; tip.style.display = 'block'; } else tip.style.display = 'none'; }
      });
      c.addEventListener('pointerleave', function () { const tip = $('tm-sky-tip'); if (tip) tip.style.display = 'none'; });
      c.addEventListener('dblclick', function (e) {
        const rect = c.getBoundingClientRect(), hit = pickSky(e.clientX - rect.left, e.clientY - rect.top);
        if (hit && hit.o.ref && hit.o.ref.engine) setScale(hit.o.ref.engine);
      });
    }
    return c;
  }
  function pickSky(mx, my) {
    let best = null, bd = 1e9;
    for (let i = skyHits.length - 1; i >= 0; i--) {
      const h = skyHits[i], d = Math.hypot(mx - h.x, my - h.y);
      if (d <= h.r + 5 && d - h.r < bd) { best = h; bd = d - h.r; }
    }
    return best;
  }
  function onSkyPick(h) {
    if (h.o.k === 'sun-home') { setScale('solar'); return; }
    selectSky(h.o);
  }
  function resetSky() { solarZoom = 1; panX = 0; panY = 0; }

  /* ───────── drawing ───────── */
  const hit = (x, y, r, o, name) => skyHits.push({ x: x, y: y, r: r, o: o, name: name });
  function backdrop(ctx, w, h, t, n) {
    ctx.fillStyle = scale === 'universe' ? '#000008' : '#010208'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const sx = (Math.sin(i * 12.9898 + 1.1) * 0.5 + 0.5) * w, sy = (Math.sin(i * 78.233 + 2.2) * 0.5 + 0.5) * h;
      ctx.fillStyle = 'rgba(210,222,245,' + (0.12 + (Math.sin(i * 3.7 + t * 0.4) * 0.5 + 0.5) * 0.25) + ')'; ctx.fillRect(sx, sy, i % 9 === 0 ? 1.6 : 1, i % 9 === 0 ? 1.6 : 1);
    }
  }
  function drawSolar() {
    if (!solarCanvas || !solarCtx || (scale !== 'solar' && scale !== 'universe')) return;
    const c = solarCanvas, ctx = solarCtx, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== (w * dpr | 0) || c.height !== (h * dpr | 0)) { c.width = w * dpr | 0; c.height = h * dpr | 0; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const nowT = performance.now(), dt = lastFrameT ? Math.min(0.1, (nowT - lastFrameT) / 1000) : 0; lastFrameT = nowT;
    skyHits = [];
    if (scale === 'universe') drawUniverse(ctx, w, h, nowT / 1000);
    else { simOffset += simSpeed * dt; drawSystem(ctx, w, h, nowT / 1000); }
    animId = requestAnimationFrame(drawSolar);
  }

  function drawSystem(ctx, w, h, t) {
    backdrop(ctx, w, h, t, 160);
    const cx = w / 2 + panX, cy = h / 2 + panY, jd = simJD();
    const unit = Math.min(w, h) * 0.46 / Math.sqrt(45) * solarZoom;
    const proj = function (p) { const r = Math.hypot(p[0], p[1]); if (r < 1e-9) return [cx, cy]; const k = Math.sqrt(r) * unit / r; return [cx + p[0] * k, cy - p[1] * k]; };
    const zs = Math.pow(solarZoom, 0.3);
    const earthPos = planetPos(PLANETS[3], jd);
    if (skyLayers.orbits) {
      ctx.lineWidth = 1;
      PLANETS.forEach(function (p) {
        if (!p.el) return; const k = planetElems(p, jd);
        ctx.strokeStyle = p.id === 'earth' ? 'rgba(110,170,255,.38)' : 'rgba(110,150,190,.22)'; ctx.beginPath();
        for (let m = 0; m <= 360; m += 3) { const s = proj(keplerPos(k.a, k.e, k.I, k.Om, k.w, m)); if (m) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); }
        ctx.stroke();
      });
    }
    if (NASA) {
      SKY_GROUPS.forEach(function (g) {
        if (!skyLayers[g.key]) return; const rows = NASA[g.src]; if (!rows) return;
        const isC = g.key === 'comets', big = g.size * Math.max(0.8, zs * 0.9);
        ctx.fillStyle = g.color;
        for (let i = 0; i < rows.length; i++) {
          const rw = rows[i], pos = rowPos(rw, jd), s = proj(pos);
          if (s[0] < -30 || s[0] > w + 30 || s[1] < -30 || s[1] > h + 30) continue;
          const o = { k: 'small', ref: rw, cls: g.name }, selected = skySel && skySel.ref === rw;
          if (isC) {
            const sun = proj([0, 0, 0]), dx = s[0] - sun[0], dy = s[1] - sun[1], dl = Math.hypot(dx, dy) || 1, r = Math.hypot(pos[0], pos[1], pos[2]);
            const tl = Math.min(46, 8 + 26 / Math.max(0.35, r)) * zs;
            const gr = ctx.createLinearGradient(s[0], s[1], s[0] + dx / dl * tl, s[1] + dy / dl * tl); gr.addColorStop(0, 'rgba(174,240,255,.85)'); gr.addColorStop(1, 'rgba(174,240,255,0)');
            ctx.strokeStyle = gr; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[0] + dx / dl * tl, s[1] + dy / dl * tl); ctx.stroke();
            ctx.fillStyle = g.color;
          }
          ctx.beginPath(); ctx.arc(s[0], s[1], selected ? big + 2 : (rw[10] ? big + 0.8 : big), 0, 6.2832); ctx.fill();
          if (rw[10]) { ctx.save(); ctx.strokeStyle = 'rgba(255,90,90,.9)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(s[0], s[1], big + 2.2, 0, 6.2832); ctx.stroke(); ctx.restore(); }
          hit(s[0], s[1], Math.max(4, big + 1), o, rw[0]);
          if (skyLayers.labels && (selected || (isC && solarZoom > 1.6) || (g.key === 'belt' && rw[9] != null && rw[9] < 4.5) || (g.key === 'tno' && rw[9] != null && rw[9] < 3.5))) {
            ctx.fillStyle = 'rgba(205,228,250,.85)'; ctx.font = '9px ui-monospace,monospace'; ctx.fillText(rw[0].replace(/^\d+\s+/, ''), s[0] + 6, s[1] - 4); ctx.fillStyle = g.color;
          }
        }
      });
      if (skyLayers.craft) (NASA.spacecraft || []).forEach(function (cf) {
        const cp = craftPos(cf, jd), s = proj(cp.pos), o = { k: 'craft', ref: cf }, selected = skySel && skySel.ref === cf;
        ctx.save(); ctx.translate(s[0], s[1]); ctx.rotate(Math.PI / 4); ctx.fillStyle = cf.color; ctx.fillRect(-3.5, -3.5, 7, 7);
        if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(-6, -6, 12, 12); } ctx.restore();
        hit(s[0], s[1], 7, o, cf.name);
        if (skyLayers.labels) { ctx.fillStyle = 'rgba(255,255,215,.92)'; ctx.font = '10px ui-monospace,monospace'; ctx.fillText(cf.name, s[0] + 9, s[1] + 3); }
      });
    }
    PLANETS.forEach(function (p) {
      const s = proj(planetPos(p, jd)), rad = Math.max(2.4, p.r * zs), selected = skySel && skySel.ref === p;
      if (p.id === 'sun') {
        const g2 = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], rad * 2.6); g2.addColorStop(0, '#fff8d0'); g2.addColorStop(0.3, '#FDB813'); g2.addColorStop(1, 'rgba(253,184,19,0)');
        ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(s[0], s[1], rad * 2.6, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(s[0], s[1], rad, 0, 6.2832); ctx.fill();
      if (p.id === 'saturn') { ctx.strokeStyle = 'rgba(230,211,163,.75)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(s[0], s[1], rad * 1.9, rad * 0.5, -0.35, 0, 6.2832); ctx.stroke(); }
      if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s[0], s[1], rad + 5, 0, 6.2832); ctx.stroke(); }
      hit(s[0], s[1], rad, { k: 'planet', ref: p }, p.name);
      if (skyLayers.labels || selected) { ctx.fillStyle = '#e8f0f8'; ctx.font = (p.type === 'dwarf' ? '9px' : '11px') + ' ui-monospace,monospace'; ctx.fillText(p.name, s[0] + rad + 5, s[1] + 3); }
      if (p.id === 'earth') { /* Moon: real direction from mean lunar longitude, offset exaggerated for visibility */
        const ang = (218.316 + 13.176396 * (jd - 2451545)) * DEG, mx = s[0] + Math.cos(ang) * (rad + 11), my = s[1] - Math.sin(ang) * (rad + 11);
        ctx.fillStyle = '#c8c8c8'; ctx.beginPath(); ctx.arc(mx, my, 1.8, 0, 6.2832); ctx.fill();
        hit(mx, my, 3, { k: 'moon', ref: MOON }, 'Moon');
        if (skyLayers.labels && solarZoom > 1.4) { ctx.fillStyle = 'rgba(210,210,210,.8)'; ctx.font = '9px ui-monospace,monospace'; ctx.fillText('Moon', mx + 4, my - 3); }
      }
    });
    ctx.fillStyle = 'rgba(180,200,220,.5)'; ctx.font = '10px system-ui'; ctx.fillText('Top-down view of the ecliptic plane · positions for ' + jdDate(jd).toISOString().replace('T', ' ').slice(0, 16) + ' UTC', 12, h - 14);
    const tl = $('tm-sk-time'); if (tl) { const txt = jdDate(jd).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' + (simOffset ? ' (' + (simOffset > 0 ? '+' : '') + nf(simOffset, 1) + ' days)' : ' · now'); if (tl.textContent !== txt) tl.textContent = txt; }
  }

  function uniColor(t) { return t == null ? '#cfd8e8' : t > 7500 ? '#bcd2ff' : t > 5200 ? '#fff4e0' : '#ffb27a'; }
  function drawUniverse(ctx, w, h, t) {
    backdrop(ctx, w, h, t, 260);
    const cx = w / 2 + panX, cy = h / 2 + panY, K = Math.min(w, h) * 0.46 / 10.4 * solarZoom, L0 = Math.log10(0.5);
    const R = function (pc) { return Math.max(0, (Math.log10(Math.max(0.5, pc)) - L0) * K); };
    ctx.font = '10px ui-monospace,monospace';
    [[1, '1 pc (3 ly)'], [10, '10 pc'], [100, '100 pc'], [1e3, '1,000 pc (3,300 ly)'], [1e4, '10 kpc'], [1e5, '100 kpc'], [1e6, '1 Mpc (3.3 Mly)'], [1e7, '10 Mpc'], [1e8, '100 Mpc'], [1e9, '1 Gpc (3.3 Gly)'], [1e10, '10 Gpc']].forEach(function (rg) {
      const r = R(rg[0]); ctx.strokeStyle = 'rgba(90,130,180,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.stroke();
      ctx.fillStyle = 'rgba(130,165,205,.65)'; ctx.fillText(rg[1], cx + 4, cy - r - 3);
    });
    ctx.strokeStyle = 'rgba(90,130,180,.18)'; [0, 90, 180, 270].forEach(function (l) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(l * DEG) * R(2e10), cy - Math.sin(l * DEG) * R(2e10)); ctx.stroke(); });
    const edge = Math.min(w, h) * 0.5;
    ctx.fillStyle = 'rgba(150,175,205,.6)'; ctx.fillText('l = 0° · towards Galactic centre', cx + Math.min(R(2e10), w / 2 - 190) , cy - 6 > 12 ? cy - 6 : 12);
    ctx.fillText('l = 90°', cx + 6, cy - Math.min(R(2e10), cy - 14) + 0); ctx.fillText('l = 180°', Math.max(6, cx - Math.min(R(2e10), cx - 60)), cy - 6); ctx.fillText('l = 270°', cx + 6, cy + Math.min(R(2e10), h - cy - 8));
    /* Milky Way disc extent */
    ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(180,170,255,.45)'; ctx.beginPath(); ctx.arc(cx, cy, R(15000), 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(190,180,255,.75)'; ctx.fillText('Milky Way disc extent (~15 kpc)', cx - 70, cy + R(15000) + 13);
    /* NASA exoplanet host stars */
    if (skyLayers.hosts && NASA && NASA.exoplanetHosts) {
      const zs = Math.max(0.8, Math.pow(solarZoom, 0.35)), hs = NASA.exoplanetHosts;
      for (let i = 0; i < hs.length; i++) {
        const s = hs[i], r = (s.lr - L0) * K, x = cx + Math.cos(s.l * DEG) * r, y = cy - Math.sin(s.l * DEG) * r;
        if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
        const sz = (0.9 + Math.min(s[4], 5) * 0.28) * zs; ctx.fillStyle = uniColor(s[5]); ctx.globalAlpha = 0.85; ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        if (solarZoom > 1.3 || s[4] >= 5) { hit(x, y, Math.max(2, sz / 2), { k: 'uni', ref: hostCard(s) }, s[0]); }
        if (selUni(s[0]) || (skyLayers.labels !== false && (s[4] >= 6 || (solarZoom > 3 && s[4] >= 3)))) { ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,235,200,.8)'; ctx.font = '9px ui-monospace,monospace'; ctx.fillText(s[0], x + 5, y - 3); }
      }
      ctx.globalAlpha = 1;
    }
    /* catalogue objects */
    UNI_CAT.forEach(function (u) {
      if (!skyLayers[u[1]]) return;
      const r = (Math.log10(Math.max(0.5, u[4])) - L0) * K, x = cx + Math.cos(u.l * DEG) * r, y = cy - Math.sin(u.l * DEG) * r;
      if (x < -30 || x > w + 30 || y < -30 || y > h + 30) return;
      const selected = selUni(u[0]), zs = Math.max(0.8, Math.pow(solarZoom, 0.3));
      drawUniSymbol(ctx, u[1], x, y, zs, t, selected);
      hit(x, y, 9, { k: 'uni', ref: catCard(u) }, u[0]);
      if (skyLayers.labels !== false && (selected || u[5] === 1 || (u[5] === 2 && solarZoom > 1.5) || solarZoom > 3)) { ctx.fillStyle = selected ? '#fff' : 'rgba(215,228,248,.85)'; ctx.font = '10px system-ui'; ctx.fillText(u[0], x + 11, y + 3); }
    });
    /* Sun */
    ctx.fillStyle = 'rgba(253,184,19,.3)'; ctx.beginPath(); ctx.arc(cx, cy, 11, 0, 6.2832); ctx.fill(); ctx.fillStyle = '#FDB813'; ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#ffe9a8'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Solar System · click the Sun to enter', cx, cy + 24); ctx.textAlign = 'left';
    hit(cx, cy, 11, { k: 'sun-home', ref: null }, 'Solar System — click to enter');
  }
  const selUni = (name) => skySel && skySel.k === 'uni' && skySel.ref && skySel.ref.title === name;
  function drawUniSymbol(ctx, type, x, y, zs, t, sel) {
    if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 11 * zs, 0, 6.2832); ctx.stroke(); }
    if (type === 'star') {
      ctx.fillStyle = '#fff'; ctx.beginPath(); const R1 = 5.5 * zs, R2 = 1.6 * zs; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? R2 : R1; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    } else if (type === 'neb') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 12 * zs); g.addColorStop(0, 'rgba(255,130,180,.75)'); g.addColorStop(1, 'rgba(255,130,180,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 12 * zs, 0, 6.2832); ctx.fill();
    } else if (type === 'gal') {
      ctx.save(); ctx.translate(x, y); ctx.rotate(0.6); ctx.fillStyle = 'rgba(160,196,255,.55)'; ctx.beginPath(); ctx.ellipse(0, 0, 8 * zs, 3.2 * zs, 0, 0, 6.2832); ctx.fill(); ctx.fillStyle = '#f4f8ff'; ctx.beginPath(); ctx.arc(0, 0, 1.6 * zs, 0, 6.2832); ctx.fill(); ctx.restore();
    } else if (type === 'cl') {
      ctx.fillStyle = 'rgba(200,168,255,.9)'; for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 5.5 * zs, y + Math.sin(a) * 5.5 * zs, 1.5 * zs, 0, 6.2832); ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, 1.8 * zs, 0, 6.2832); ctx.fill();
    } else if (type === 'bh') {
      ctx.strokeStyle = 'rgba(255,154,60,.9)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, 6 * zs, 0, 6.2832); ctx.stroke(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, 4 * zs, 0, 6.2832); ctx.fill();
    }
  }
  const cardCache = {};
  function catCard(u) {
    if (cardCache[u[0]]) return cardCache[u[0]];
    const rows = row('Distance', ldist(u[4]) + ' (' + pcStr(u[4]) + ')') + row('Galactic longitude', nf(u.l, 1) + '°') + row('Galactic latitude', nf(u.b, 1) + '°') + row('Sky position (J2000)', 'RA ' + nf(u[2] / 15, 2) + ' h, Dec ' + nf(u[3], 2) + '°');
    return (cardCache[u[0]] = { title: u[0], sub: UNI_TYPES[u[1]], text: u[6], rows: rows, src: 'published catalogue values (NASA/ESA/ESO, NED/SIMBAD)' });
  }
  function hostCard(s) {
    if (cardCache['h:' + s[0]]) return cardCache['h:' + s[0]];
    const rows = row('Confirmed planets', s[4]) + row('Distance', ldist(s[3]) + ' (' + pcStr(s[3]) + ')') + (s[5] ? row('Star temperature', nf(s[5]) + ' K') : '') + (s[6] != null ? row('Apparent brightness (V)', nf(s[6], 2)) : '') + row('Sky position (J2000)', 'RA ' + nf(s[1] / 15, 2) + ' h, Dec ' + nf(s[2], 2) + '°');
    return (cardCache['h:' + s[0]] = { title: s[0], sub: 'Star with confirmed planet' + (s[4] > 1 ? 's' : ''), text: '', rows: rows, src: 'NASA Exoplanet Archive (Caltech/IPAC)' });
  }

  function showSolar(show) {
    const c = ensureSolarCanvas(); if (!c) return;
    solarCanvas = c; solarCtx = c.getContext('2d');
    c.style.display = show ? 'block' : 'none';
    if (show) { skySel = null; lastFrameT = 0; loadNasa(); renderSkyPanel(); updateSkyStatus(); cancelAnimationFrame(animId); drawSolar(); }
    else { cancelAnimationFrame(animId); const p = $('tm-sky-panel'); if (p) p.style.display = 'none'; const tp = $('tm-sky-tip'); if (tp) tp.style.display = 'none'; }
  }

  function destroyViews() {
    if (playing) { playing = false; if (playTimer) clearInterval(playTimer); playTimer = null; }
    if (terminatorTimer) { clearInterval(terminatorTimer); terminatorTimer = null; }
    if (forecastTimer) { clearTimeout(forecastTimer); forecastTimer = null; }
    try { wxStop(); } catch (e) {}
    try { if (globe && globe.destroy) globe.destroy(); } catch (e) {}
    globe = null;
    try { if (maplibre) maplibre.remove(); } catch (e) {}
    maplibre = null;
    const target = $('map');
    if (target) Array.from(target.children).forEach(function (ch) { if (ch.id !== 'tm-solar-canvas') ch.remove(); });
  }

  async function loadRV() {
    try {
      const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
      rvHost = j.host || 'https://tilecache.rainviewer.com';
      rvFrames = (j.radar && j.radar.past) || [];
      rvIndex = Math.max(0, rvFrames.length - 1);
      const s = $('tm-time-slider');
      if (s) { s.max = Math.max(0, rvFrames.length - 1); s.value = rvIndex; }
      updateTime();
    } catch (e) { rvFrames = []; }
  }
  function updateTime() { updateTimeLabel(); }
  function applyRadar() {
    if (!maplibre || !rvFrames.length) return;
    try { if (maplibre.getSource('radar')) maplibre.getSource('radar').setTiles([rvHost + rvFrames[rvIndex].path + '/256/{z}/{x}/{y}/2/1_1.png']); } catch (e) {}
  }
  function stepFrame(d) {
    if (!rvFrames.length) return;
    rvIndex = Math.max(0, Math.min(rvFrames.length - 1, rvIndex + d));
    if ($('tm-time-slider')) $('tm-time-slider').value = rvIndex;
    applyRadar(); updateTime();
  }
  function togglePlay() {
    if (playing) { playing = false; if (playTimer) clearInterval(playTimer); playTimer = null; if ($('tm-play')) $('tm-play').textContent = '▶'; return; }
    if (!rvFrames.length) return;
    playing = true; if ($('tm-play')) $('tm-play').textContent = '⏸';
    playTimer = setInterval(function () {
      rvIndex = rvIndex >= rvFrames.length - 1 ? 0 : rvIndex + 1;
      if ($('tm-time-slider')) $('tm-time-slider').value = rvIndex;
      applyRadar(); updateTime();
    }, 600);
  }
  function applyDayNight() {
    if (!maplibre) return;
    try {
      if (maplibre.getSource('terminator')) maplibre.getSource('terminator').setData(dayNight ? terminatorFeatures(new Date()) : { type: 'FeatureCollection', features: [] });
      ['night-0', 'night-1', 'night-2'].forEach(function (id) {
        if (maplibre.getLayer(id)) maplibre.setLayoutProperty(id, 'visibility', dayNight ? 'visible' : 'none');
      });
    } catch (e) {}
  }

  function activeForecastMode() {
    if (activeWx.precip) return 'precip'; if (activeWx.wind) return 'wind'; if (activeWx.temp) return 'temp';
    if (activeWx.humidity) return 'humidity'; if (activeWx.pressure) return 'pressure'; return null;
  }
  function forecastScale(mode) {
    if (mode === 'precip') return { prop: 'precip', stops: [0, 'rgba(0,0,0,0)', 0.2, '#7ec8ff', 1, '#3D8BFF', 4, '#7b5cff', 12, '#ff4d6d', 30, '#ffffff'], label: 'Rain' };
    if (mode === 'wind') return { prop: 'wind', stops: [0, '#0a1f3d', 20, '#1a6b9a', 45, '#2ecc71', 80, '#f1c40f', 120, '#e67e22', 180, '#c0392b'], label: 'Wind km/h' };
    if (mode === 'temp') return { prop: 'temp', stops: [-30, '#3b0a7a', -15, '#3d5a9e', 0, '#5b9bd5', 10, '#7dcea0', 20, '#f4d03f', 30, '#e67e22', 42, '#c0392b'], label: 'Temp °C' };
    if (mode === 'humidity') return { prop: 'humidity', stops: [0, '#c9a66b', 25, '#d4c06a', 45, '#7dcea0', 65, '#5dade2', 85, '#3498db', 100, '#1a4a8a'], label: 'Humidity %' };
    if (mode === 'pressure') return { prop: 'pressure', stops: [970, '#1a5fb4', 990, '#5dade2', 1005, '#a8d5e5', 1013, '#f5e6c8', 1025, '#e8a090', 1040, '#c0392b'], label: 'Pressure hPa' };
    return { prop: 'temp', stops: [0, '#888', 40, '#fff'], label: '' };
  }
  function setWeatherBaseDim(on) {
    if (!maplibre) return;
    try {
      if (maplibre.getLayer('sat')) maplibre.setPaintProperty('sat', 'raster-opacity', on ? 0.3 : 1);
      if (maplibre.getLayer('gibs-live')) maplibre.setPaintProperty('gibs-live', 'raster-opacity', on ? 0.15 : 0.55);
    } catch (e) {}
  }
  /* ───────── Weather engine ─────────
   * One global grid (10°) is fetched from Open-Meteo in a few batched requests and cached for 20 minutes
   * (so panning/zooming never refetches). The grid drives a smooth colour field covering the whole view and a
   * real animation per category: wind = particle streamlines advected by the wind field, temperature and humidity =
   * the same flow coloured by that variable, pressure = isobars + H/L centres over the flow, rain = falling streaks
   * where the model has precipitation, over the looping radar. Everything is drawn on overlay canvases above the map. */
  const WX_TTL = 20 * 60000, WX_LATS = [], WX_LONS = [];
  for (let la = -80; la <= 80; la += 10) WX_LATS.push(la);
  for (let lo = -180; lo < 180; lo += 10) WX_LONS.push(lo);
  const WX_NX = WX_LONS.length, WX_NY = WX_LATS.length, WX_KEYS = ['temp', 'hum', 'pres', 'spd', 'u', 'v', 'pr'];
  let wxGrid = null, wxLoading = null, wxField = null, wxFlow = null, wxRaf = 0, wxView = '', wxMovedAt = 0, wxFieldAt = 0, wxMoving = false;
  let wxParts = [], wxRain = [], wxBuf = null, wxBufW = 0, wxBufH = 0, wxOff = null, wxRadarAuto = false, wxRampCache = {}, wxBucketCache = {};

  function wxUnpack(c) { const g = { t: c.t }; WX_KEYS.forEach(function (k) { g[k] = Float32Array.from(c[k].map(function (v) { return v == null ? NaN : v; })); }); return g; }
  function wxPack(g) { const c = { t: g.t }; WX_KEYS.forEach(function (k) { c[k] = Array.from(g[k], function (v) { return isNaN(v) ? null : Math.round(v * 10) / 10; }); }); return c; }
  function loadWxGrid() {
    if (wxGrid && Date.now() - wxGrid.t < WX_TTL) return Promise.resolve(wxGrid);
    if (wxLoading) return wxLoading;
    try { const c = JSON.parse(sessionStorage.getItem('tm-wxgrid-v1') || 'null'); if (c && Date.now() - c.t < WX_TTL && c.temp && c.temp.length === WX_NX * WX_NY) { wxGrid = wxUnpack(c); return Promise.resolve(wxGrid); } } catch (e) {}
    const N = WX_NX * WX_NY, g = { t: Date.now() }; WX_KEYS.forEach(function (k) { g[k] = new Float32Array(N).fill(NaN); });
    const chunks = []; for (let s = 0; s < N; s += 100) chunks.push(s);
    let ok = 0, next = 0, lastErr = '';
    function worker() {
      if (next >= chunks.length) return Promise.resolve();
      const s = chunks[next++], idx = []; for (let k = s; k < Math.min(N, s + 100); k++) idx.push(k);
      const la = idx.map(function (k) { return WX_LATS[Math.floor(k / WX_NX)]; }).join(','), lo = idx.map(function (k) { return WX_LONS[k % WX_NX]; }).join(',');
      return fetch('https://api.open-meteo.com/v1/forecast?latitude=' + la + '&longitude=' + lo + '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=ms')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          const arr = Array.isArray(j) ? j : [j];
          arr.forEach(function (o, n) {
            const c = o && o.current, k = idx[n]; if (!c || k == null) return;
            const sp = +c.wind_speed_10m, dir = +c.wind_direction_10m * Math.PI / 180;
            g.temp[k] = +c.temperature_2m; g.hum[k] = +c.relative_humidity_2m; g.pres[k] = +c.surface_pressure; g.pr[k] = +c.precipitation;
            g.spd[k] = sp * 3.6; g.u[k] = -sp * Math.sin(dir); g.v[k] = -sp * Math.cos(dir); ok++;
          });
        }).catch(function (e) { lastErr = e.message || String(e); }).then(worker);
    }
    wxLoading = Promise.all([worker(), worker(), worker()]).then(function () {
      wxLoading = null;
      if (ok < N * 0.5) { if (wxGrid) return wxGrid; throw new Error(lastErr || 'weather service returned no data'); }
      wxGrid = g; try { sessionStorage.setItem('tm-wxgrid-v1', JSON.stringify(wxPack(g))); } catch (e) {}
      return g;
    });
    return wxLoading;
  }
  function wxSample(a, lon, lat) {
    const fx = (((lon + 180) % 360) + 360) % 360 / 10, fy = (Math.max(-80, Math.min(80, lat)) + 80) / 10;
    const j0 = Math.floor(fx) % WX_NX, j1 = (j0 + 1) % WX_NX, i0 = Math.min(WX_NY - 2, Math.floor(fy)), i1 = i0 + 1, tx = fx - Math.floor(fx), ty = fy - i0;
    const v = [a[i0 * WX_NX + j0], a[i0 * WX_NX + j1], a[i1 * WX_NX + j0], a[i1 * WX_NX + j1]], w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    let s = 0, ws = 0; for (let k = 0; k < 4; k++) if (v[k] === v[k]) { s += v[k] * w[k]; ws += w[k]; }
    return ws > 0 ? s / ws : NaN;
  }
  function wxParse(c) {
    if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
    const m = c.slice(c.indexOf('(') + 1, c.indexOf(')')).split(',').map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1];
  }
  function wxRamp(mode) {
    if (wxRampCache[mode]) return wxRampCache[mode];
    const sc = forecastScale(mode), v = [], c = []; for (let i = 0; i < sc.stops.length; i += 2) { v.push(sc.stops[i]); c.push(wxParse(sc.stops[i + 1])); }
    for (let i = 0; i < c.length - 1; i++) if (c[i][3] === 0) { c[i][0] = c[i + 1][0]; c[i][1] = c[i + 1][1]; c[i][2] = c[i + 1][2]; }
    return (wxRampCache[mode] = { v: v, c: c, label: sc.label });
  }
  function wxColor(r, val, out) {
    const n = r.v.length; if (val <= r.v[0]) { for (let k = 0; k < 4; k++) out[k] = r.c[0][k]; return out; }
    if (val >= r.v[n - 1]) { for (let k = 0; k < 4; k++) out[k] = r.c[n - 1][k]; return out; }
    let i = 1; while (r.v[i] < val) i++;
    const t = (val - r.v[i - 1]) / (r.v[i] - r.v[i - 1]), a = r.c[i - 1], b = r.c[i];
    for (let k = 0; k < 4; k++) out[k] = a[k] + (b[k] - a[k]) * t; return out;
  }
  const WX_FIELD = { temp: ['temp', 0.72], humidity: ['hum', 0.66], pressure: ['pres', 0.55], wind: ['spd', 0.5], precip: ['pr', 0.85] };

  function wxEnsure() {
    const host = $('map'); if (!host) return false;
    if (!wxField || wxField.parentNode !== host) {
      const mk = function (id) { const c = document.createElement('canvas'); c.id = id; c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3'; host.appendChild(c); return c; };
      wxField = mk('tm-wx-field'); wxFlow = mk('tm-wx-flow'); wxParts = []; wxRain = [];
    }
    const W = host.clientWidth, H = host.clientHeight;
    [wxField, wxFlow].forEach(function (c) { if (c.width !== W || c.height !== H) { c.width = W; c.height = H; wxView = ''; } });
    return true;
  }
  function wxStart() { if (!wxRaf) wxRaf = requestAnimationFrame(wxLoop); }
  function wxStop() {
    if (wxRaf) { cancelAnimationFrame(wxRaf); wxRaf = 0; }
    [wxField, wxFlow].forEach(function (c) { if (c && c.parentNode) c.parentNode.removeChild(c); });
    wxField = wxFlow = null; wxParts = []; wxRain = []; wxView = '';
  }
  const wxGlobe = () => earthMode === 'globe';
  function wxVisible(lon, lat, cLon, cLat) { /* front hemisphere test for globe projection */
    const d = Math.PI / 180; return Math.sin(lat * d) * Math.sin(cLat * d) + Math.cos(lat * d) * Math.cos(cLat * d) * Math.cos((lon - cLon) * d) > 0.04;
  }
  function wxPaintField(mode) {
    if (!wxField || !wxGrid || !maplibre) return;
    const W = wxField.width, H = wxField.height, sc = 6, bw = Math.ceil(W / sc), bh = Math.ceil(H / sc), info = WX_FIELD[mode], arr = wxGrid[info[0]], ramp = wxRamp(mode);
    if (!wxOff || wxOff.width !== bw || wxOff.height !== bh) { wxOff = document.createElement('canvas'); wxOff.width = bw; wxOff.height = bh; }
    const octx = wxOff.getContext('2d'), img = octx.createImageData(bw, bh), d = img.data, col = [0, 0, 0, 1], globe = wxGlobe(), cen = maplibre.getCenter();
    if (!wxBuf || wxBuf.length !== bw * bh) { wxBuf = new Float32Array(bw * bh); } wxBufW = bw; wxBufH = bh;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const px = x * sc + sc / 2, py = y * sc + sc / 2, o = (y * bw + x) * 4; let ll;
      try { ll = maplibre.unproject([px, py]); } catch (e) { continue; }
      if (!ll || !isFinite(ll.lng) || !isFinite(ll.lat)) continue;
      if (globe) { if (!wxVisible(ll.lng, ll.lat, cen.lng, cen.lat)) continue; const pp = maplibre.project(ll); if (Math.abs(pp.x - px) > 1.5 || Math.abs(pp.y - py) > 1.5) continue; }
      const v = wxSample(arr, ll.lng, ll.lat); if (v !== v) continue;
      wxBuf[y * bw + x] = mode === 'precip' ? v : 0;
      wxColor(ramp, v, col); d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = Math.round(255 * col[3] * info[1]);
    }
    octx.putImageData(img, 0, 0);
    const ctx = wxField.getContext('2d'); ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(wxOff, 0, 0, W, H);
    if (mode === 'pressure') wxIsobars(ctx, globe, cen);
    wxFieldAt = performance.now();
  }
  function wxIsobars(ctx, globe, cen) { /* marching squares over the global grid, projected onto the map */
    const a = wxGrid.pres, P = function (i, j, t, dir) { return null; };
    const W = wxField.width, H = wxField.height; ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.font = '10px ui-monospace,monospace';
    const pr = function (lon, lat) {
      if (globe && !wxVisible(lon, lat, cen.lng, cen.lat)) return null;
      const copies = []; for (let k = -1; k <= 1; k++) { const p = maplibre.project([lon + 360 * k, lat]); if (p.x > -60 && p.x < W + 60 && p.y > -60 && p.y < H + 60) copies.push(p); } return copies;
    };
    for (let lev = 960; lev <= 1052; lev += 4) {
      ctx.beginPath(); let labeled = 0;
      for (let i = 0; i < WX_NY - 1; i++) for (let j = 0; j < WX_NX; j++) {
        const j1 = (j + 1) % WX_NX, v0 = a[i * WX_NX + j], v1 = a[i * WX_NX + j1], v2 = a[(i + 1) * WX_NX + j1], v3 = a[(i + 1) * WX_NX + j];
        if (v0 !== v0 || v1 !== v1 || v2 !== v2 || v3 !== v3) continue;
        const pts = [], lat0 = WX_LATS[i], lon0 = WX_LONS[j];
        const cross = function (va, vb, x0, y0, x1, y1) { if ((va < lev) === (vb < lev)) return; const t = (lev - va) / (vb - va); pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]); };
        cross(v0, v1, lon0, lat0, lon0 + 10, lat0); cross(v1, v2, lon0 + 10, lat0, lon0 + 10, lat0 + 10); cross(v3, v2, lon0, lat0 + 10, lon0 + 10, lat0 + 10); cross(v0, v3, lon0, lat0, lon0, lat0 + 10);
        for (let k = 0; k + 1 < pts.length; k += 2) {
          const A = pr(pts[k][0], pts[k][1]), B = pr(pts[k + 1][0], pts[k + 1][1]); if (!A || !B) continue;
          for (let c = 0; c < Math.min(A.length, B.length); c++) { ctx.moveTo(A[c].x, A[c].y); ctx.lineTo(B[c].x, B[c].y); }
          if (!labeled && j % 6 === 0 && A.length) { ctx.stroke(); ctx.fillText(String(lev), A[0].x + 3, A[0].y - 2); ctx.beginPath(); labeled = 1; }
        }
      }
      ctx.stroke();
    }
    ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center';
    for (let i = 1; i < WX_NY - 1; i++) for (let j = 0; j < WX_NX; j++) {
      const v = a[i * WX_NX + j]; if (v !== v) continue; let hi = true, lo = true;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { if (!di && !dj) continue; const n = a[(i + di) * WX_NX + ((j + dj + WX_NX) % WX_NX)]; if (n === n) { if (n >= v) hi = false; if (n <= v) lo = false; } }
      if (!(hi && v >= 1018) && !(lo && v <= 1008)) continue;
      const p = pr(WX_LONS[j], WX_LATS[i]); if (!p) continue;
      p.forEach(function (q) { ctx.fillStyle = hi ? '#ff8a70' : '#7fc4ff'; ctx.fillText(hi ? 'H' : 'L', q.x, q.y); ctx.font = '10px ui-monospace,monospace'; ctx.fillText(Math.round(v), q.x, q.y + 12); ctx.font = 'bold 15px system-ui'; });
    }
    ctx.textAlign = 'left';
  }
  function wxBuckets(mode) {
    if (wxBucketCache[mode]) return wxBucketCache[mode];
    const ramp = wxRamp(mode), lo = ramp.v[0], hi = ramp.v[ramp.v.length - 1], out = [], c = [0, 0, 0, 1];
    for (let i = 0; i < 8; i++) {
      if (mode === 'pressure') { out.push('rgba(225,238,255,' + (0.35 + i * 0.07) + ')'); continue; }
      wxColor(ramp, lo + (hi - lo) * (i + 0.5) / 8, c);
      const m = function (x) { return Math.round(x + (255 - x) * 0.4); };
      out.push('rgba(' + m(c[0]) + ',' + m(c[1]) + ',' + m(c[2]) + ',0.9)');
    }
    return (wxBucketCache[mode] = { colors: out, lo: lo, hi: hi });
  }
  function wxRandPoint(W, H, cen, globe) {
    for (let t = 0; t < 6; t++) {
      let ll; try { ll = maplibre.unproject([Math.random() * W, Math.random() * H]); } catch (e) { continue; }
      if (ll && isFinite(ll.lng) && isFinite(ll.lat) && (!globe || wxVisible(ll.lng, ll.lat, cen.lng, cen.lat))) return ll;
    }
    return null;
  }
  function wxFlowStep(mode) {
    const ctx = wxFlow.getContext('2d'), W = wxFlow.width, H = wxFlow.height, globe = wxGlobe(), cen = maplibre.getCenter();
    if (mode === 'precip') { /* falling rain streaks where the model has precipitation */
      ctx.clearRect(0, 0, W, H);
      if (wxBuf) for (let t = 0; t < 260 && wxRain.length < 2600; t++) {
        const x = Math.random() * W, y = Math.random() * H, bx = Math.min(wxBufW - 1, (x / 6) | 0), by = Math.min(wxBufH - 1, (y / 6) | 0), v = wxBuf[by * wxBufW + bx];
        if (v > 0.02 && Math.random() < Math.min(1, v / 1.2)) wxRain.push({ x: x, y: y, vy: 15 + Math.random() * 9, life: 14 + (Math.random() * 8 | 0) });
      }
      ctx.strokeStyle = 'rgba(170,212,255,.65)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let i = wxRain.length - 1; i >= 0; i--) { const r = wxRain[i]; ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - 2.4, r.y - r.vy * 0.55); r.x += 2.4; r.y += r.vy; if (--r.life <= 0 || r.y > H) wxRain.splice(i, 1); }
      ctx.stroke(); return;
    }
    if (wxMoving) ctx.clearRect(0, 0, W, H); else { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.075)'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    const want = Math.min(window.innerWidth < 700 ? 1500 : 4200, Math.round(W * H / 330));
    while (wxParts.length < want) { const ll = wxRandPoint(W, H, cen, globe); if (!ll) break; wxParts.push({ lon: ll.lng, lat: ll.lat, age: Math.random() * 80 | 0, life: 70 + (Math.random() * 70 | 0) }); }
    if (wxParts.length > want) wxParts.length = want;
    const z = maplibre.getZoom(), T = 78000 * Math.pow(2, 2 - z) * (1 / 60), bk = wxBuckets(mode), buckets = [[], [], [], [], [], [], [], []];
    const valArr = mode === 'temp' ? wxGrid.temp : mode === 'humidity' ? wxGrid.hum : mode === 'pressure' ? wxGrid.pres : wxGrid.spd, cosK = Math.PI / 180;
    for (let i = 0; i < wxParts.length; i++) {
      const p = wxParts[i];
      if (++p.age > p.life) { const ll = wxRandPoint(W, H, cen, globe); if (ll) { p.lon = ll.lng; p.lat = ll.lat; } p.age = 0; continue; }
      const u = wxSample(wxGrid.u, p.lon, p.lat), v = wxSample(wxGrid.v, p.lon, p.lat); if (u !== u || v !== v) { p.age = p.life; continue; }
      const a = maplibre.project([p.lon, p.lat]);
      p.lat += v * T / 111320; p.lon += u * T / (111320 * Math.max(0.15, Math.cos(p.lat * cosK)));
      if (p.lat > 84 || p.lat < -84) { p.age = p.life; continue; }
      if (globe && !wxVisible(p.lon, p.lat, cen.lng, cen.lat)) { p.age = p.life; continue; }
      const b = maplibre.project([p.lon, p.lat]);
      if (a.x < -20 || a.x > W + 20 || a.y < -20 || a.y > H + 20) { p.age = p.life; continue; }
      const val = mode === 'wind' ? wxSample(valArr, p.lon, p.lat) : mode === 'pressure' ? Math.hypot(u, v) * 3.6 : wxSample(valArr, p.lon, p.lat);
      const lo = mode === 'pressure' ? 0 : bk.lo, hi = mode === 'pressure' ? 90 : bk.hi, bi = Math.max(0, Math.min(7, ((val - lo) / (hi - lo) * 8) | 0));
      buckets[bi].push(a.x, a.y, b.x, b.y);
    }
    ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    for (let b = 0; b < 8; b++) { const s = buckets[b]; if (!s.length) continue; ctx.strokeStyle = bk.colors[b]; ctx.beginPath(); for (let k = 0; k < s.length; k += 4) { ctx.moveTo(s[k], s[k + 1]); ctx.lineTo(s[k + 2], s[k + 3]); } ctx.stroke(); }
  }
  function wxLoop(ts) {
    wxRaf = requestAnimationFrame(wxLoop);
    const mode = activeForecastMode(); if (!mode || !wxGrid || !maplibre || scale !== 'earth') return;
    if (!wxEnsure()) return;
    const c = maplibre.getCenter(), key = c.lng.toFixed(3) + '|' + c.lat.toFixed(3) + '|' + maplibre.getZoom().toFixed(3) + '|' + maplibre.getBearing().toFixed(1) + '|' + maplibre.getPitch().toFixed(1) + '|' + wxField.width + '|' + mode;
    if (key !== wxView) {
      const modeChanged = wxView.split('|')[6] !== mode; wxView = key; wxMovedAt = ts; wxMoving = true;
      if (modeChanged) { wxParts = []; wxRain = []; }
      if (ts - wxFieldAt > 110) wxPaintField(mode);
    } else if (wxMoving && ts - wxMovedAt > 140) { wxMoving = false; wxPaintField(mode); }
    wxFlowStep(mode);
  }

  function paintForecast() {
    if (!maplibre) return;
    const mode = activeForecastMode(), leg = $('tm-wx-legend');
    try { ['forecast-heat', 'forecast-circles'].forEach(function (id) { if (maplibre.getLayer(id)) maplibre.setLayoutProperty(id, 'visibility', 'none'); }); } catch (e) {}
    if (!mode) {
      wxStop(); if (leg) leg.style.display = 'none'; setWeatherBaseDim(false);
      if (wxRadarAuto) { wxRadarAuto = false; activeWx.radar = false; if (playing) togglePlay(); try { if (maplibre.getLayer('radar')) maplibre.setLayoutProperty('radar', 'visibility', 'none'); } catch (e) {} }
      return;
    }
    if (mode !== 'precip' && wxRadarAuto) { wxRadarAuto = false; activeWx.radar = false; if (playing) togglePlay(); try { if (maplibre.getLayer('radar')) maplibre.setLayoutProperty('radar', 'visibility', 'none'); } catch (e) {} }
    setWeatherBaseDim(true);
    const ramp = wxRamp(mode), lo = ramp.v[0], hi = ramp.v[ramp.v.length - 1];
    const grad = ramp.v.map(function (v, i) { const c = ramp.c[i]; return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (mode === 'precip' && i === 0 ? 0.15 : 1) + ') ' + Math.round((v - lo) / (hi - lo) * 100) + '%'; }).join(',');
    if (leg) {
      leg.style.display = 'block'; leg.style.bottom = '184px';
      leg.innerHTML = '<b>' + ramp.label + '</b>' + (wxGrid ? ' · updated ' + new Date(wxGrid.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ' · loading…') +
        '<div style="width:190px;height:8px;border-radius:4px;margin:6px 0 3px;background:linear-gradient(90deg,' + grad + ')"></div><div style="display:flex;justify-content:space-between;width:190px"><span>' + lo + '</span><span>' + hi + '</span></div>';
    }
    if (!wxEnsure()) return; wxStart(); wxView = '';
  }
  async function refreshForecast() {
    if (!maplibre || scale !== 'earth') return;
    const mode = activeForecastMode();
    if (!mode) { paintForecast(); return; }
    if (mode === 'precip' && maplibre.getLayer('radar')) {
      try { maplibre.setLayoutProperty('radar', 'visibility', 'visible'); if (!activeWx.radar) wxRadarAuto = true; activeWx.radar = true; if (!playing && rvFrames.length > 1) togglePlay(); } catch (e) {}
    }
    setWeatherBaseDim(true); paintForecast();
    const fresh = wxGrid && Date.now() - wxGrid.t < WX_TTL;
    if (!fresh) setStatus('Loading ' + mode + ' field…', true);
    try { await loadWxGrid(); } catch (e) {
      const leg = $('tm-wx-legend'); if (leg) leg.innerHTML = '<b>Weather service busy</b><br>Try again in a minute (' + esc(e.message) + ')';
      setStatus('Weather service unavailable · ' + esc(e.message), false); return;
    }
    if (activeForecastMode() !== mode) return;
    wxView = ''; paintForecast();
    setStatus('Weather · ' + mode + (wxGrid ? ' · updated ' + new Date(wxGrid.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''), true);
  }
  function applyLayers() {
    if (!maplibre) return;
    try {
      if (maplibre.getLayer('sat')) maplibre.setLayoutProperty('sat', 'visibility', activeWx.dark ? 'none' : 'visible');
      if (maplibre.getLayer('dark')) maplibre.setLayoutProperty('dark', 'visibility', activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('gibs-live')) maplibre.setLayoutProperty('gibs-live', 'visibility', activeWx.live && !activeWx.dark ? 'visible' : 'none');
      if (maplibre.getLayer('radar')) maplibre.setLayoutProperty('radar', 'visibility', activeWx.radar ? 'visible' : 'none');
      if (maplibre.getLayer('fires-layer')) maplibre.setLayoutProperty('fires-layer', 'visibility', activeWx.fires ? 'visible' : 'none');
      if (maplibre.getLayer('eonet-pts')) maplibre.setLayoutProperty('eonet-pts', 'visibility', activeWx.events ? 'visible' : 'none');
      if (maplibre.getLayer('quakes-pts')) maplibre.setLayoutProperty('quakes-pts', 'visibility', activeWx.quakes ? 'visible' : 'none');
    } catch (e) {}
    applyDayNight(); paintForecast(); refreshWx(); syncBar(); syncDrawerItems();
  }
  function refreshWx() {
    const el = $('tm-wx-readout'); if (!el || !maplibre) return;
    const c = maplibre.getCenter();
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c.lat.toFixed(3) + '&longitude=' + c.lng.toFixed(3) + '&current=temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,precipitation')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        const cur = j.current || {};
        el.innerHTML = ['CENTER · ' + c.lat.toFixed(2) + '°, ' + c.lng.toFixed(2) + '°',
          '<b>Temp</b> ' + (cur.temperature_2m != null ? cur.temperature_2m + ' °C' : '—'),
          '<b>Humidity</b> ' + (cur.relative_humidity_2m != null ? cur.relative_humidity_2m + ' %' : '—'),
          '<b>Pressure</b> ' + (cur.surface_pressure != null ? Math.round(cur.surface_pressure) + ' hPa' : '—'),
          '<b>Wind</b> ' + (cur.wind_speed_10m != null ? cur.wind_speed_10m + ' km/h' : '—'),
          '<b>Precip</b> ' + (cur.precipitation != null ? cur.precipitation + ' mm' : '—')].join('<br>');
      }).catch(function () {});
  }

  async function enterEarth() {
    destroyViews(); showSolar(false);
    if (!window.maplibregl) throw new Error('MapLibre missing');
    await loadRV();
    const radarPath = rvFrames.length ? rvHost + rvFrames[rvIndex].path + '/256/{z}/{x}/{y}/2/1_1.png' : null;
    const useGlobe = earthMode === 'globe'; const date = gibsDateStr(); updateTimeLabel();
    const style = {
      version: 8,
      sources: {
        sat: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] },
        dark: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'] },
        gibs: { type: 'raster', tileSize: 256, maxzoom: 9, tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/' + date + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg'] },
        labels: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'] },
        terminator: { type: 'geojson', data: dayNight ? terminatorFeatures(new Date()) : { type: 'FeatureCollection', features: [] } },
        forecast: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        eonet: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        quakes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        fires: { type: 'raster', tileSize: 256, maxzoom: 8, tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/' + date + '/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'] }
      },
      layers: [
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
        { id: 'gibs-live', type: 'raster', source: 'gibs', layout: { visibility: activeWx.live ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.55 } },
        { id: 'night-0', type: 'fill', source: 'terminator', filter: ['==', ['get', 'soft'], 0], layout: { visibility: dayNight ? 'visible' : 'none' }, paint: { 'fill-color': '#00060f', 'fill-opacity': 0.12 } },
        { id: 'night-1', type: 'fill', source: 'terminator', filter: ['==', ['get', 'soft'], 1], layout: { visibility: dayNight ? 'visible' : 'none' }, paint: { 'fill-color': '#00060f', 'fill-opacity': 0.16 } },
        { id: 'night-2', type: 'fill', source: 'terminator', filter: ['==', ['get', 'soft'], 2], layout: { visibility: dayNight ? 'visible' : 'none' }, paint: { 'fill-color': '#00060f', 'fill-opacity': 0.22 } },
        { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
        { id: 'forecast-heat', type: 'heatmap', source: 'forecast', layout: { visibility: 'none' }, paint: { 'heatmap-radius': 55, 'heatmap-intensity': 1.8, 'heatmap-opacity': 0.9, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.15, '#2980b9', 0.35, '#2ecc71', 0.55, '#f1c40f', 0.75, '#e67e22', 1, '#c0392b'] } },
        { id: 'forecast-circles', type: 'circle', source: 'forecast', layout: { visibility: 'none' }, paint: { 'circle-radius': 36, 'circle-color': '#4fd0a0', 'circle-opacity': 0.55, 'circle-blur': 0.9, 'circle-stroke-width': 0 } },
        { id: 'fires-layer', type: 'raster', source: 'fires', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } },
        { id: 'eonet-pts', type: 'circle', source: 'eonet', paint: { 'circle-radius': 7, 'circle-color': '#ff6b35', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.9 } },
        { id: 'quakes-pts', type: 'circle', source: 'quakes', paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 2.5, 4, 5, 8, 7, 14], 'circle-color': ['interpolate', ['linear'], ['get', 'mag'], 2.5, '#f0d060', 4.5, '#ff9a3c', 6, '#e04040'], 'circle-stroke-width': 1, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85 } }
      ]
    };
    if (useGlobe) { style.projection = { type: 'globe' }; style.fog = { color: 'rgb(8, 16, 32)', 'high-color': 'rgb(25, 45, 75)', 'space-color': 'rgb(1, 2, 6)', 'horizon-blend': 0.1, range: [0.5, 12] }; }
    if (radarPath) {
      style.sources.radar = { type: 'raster', tileSize: 256, tiles: [radarPath] };
      style.layers.splice(3, 0, { id: 'radar', type: 'raster', source: 'radar', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75 } });
    }
    maplibre = new maplibregl.Map({ container: 'map', style: style, center: [20, 15], zoom: useGlobe ? 1.4 : 2, minZoom: useGlobe ? 0.5 : 1, maxZoom: 20, maxPitch: useGlobe ? 85 : 60, attributionControl: false, failIfMajorPerformanceCaveat: false });
    window.map = maplibre;
    maplibre.on('load', function () {
      try { maplibre.resize(); } catch (e) {}
      applyLayers(); loadActivity();
      setStatus('EARTH · ' + (useGlobe ? '3D' : 'FLAT') + ' · live feeds', true);
      if (dayNight) terminatorTimer = setInterval(function () { applyDayNight(); }, 60000);
    });
    maplibre.on('moveend', function () {
      if (forecastTimer) clearTimeout(forecastTimer);
      forecastTimer = setTimeout(function () { refreshWx(); if (activeForecastMode()) refreshForecast(); }, 500);
    });
    setTimeout(function () { try { maplibre.resize(); } catch (e) {} }, 300);
  }

  async function loadOg() {
    if (og) return og;
    ensureCss(OG_CSS);
    og = await import(/* webpackIgnore: true */ OG_JS);
    return og;
  }
  async function enterPlanet(planetId) {
    destroyViews(); showSolar(false);
    const mod = await loadOg();
    const Globe = mod.Globe, XYZ = mod.XYZ, LonLat = mod.LonLat, control = mod.control;
    const EmptyTerrain = mod.EmptyTerrain, RgbTerrain = mod.RgbTerrain;
    const moonEll = mod.moon, marsEll = mod.mars, quadTreeStrategyType = mod.quadTreeStrategyType;
    const target = $('map'); let layers = [], terrain = null;
    const opts = { target: target, name: planetId, autoActivate: true, maxGridSize: 128 };
    if (planetId === 'moon') {
      layers = [new XYZ('LRO', { isBaseLayer: true, url: 'https://{s}.terrain.openglobus.org/moon/sat/{z}/{x}/{y}.png', visibility: true, maxNativeZoom: 10 })];
      try { terrain = new RgbTerrain(null, { geoidSrc: null, maxZoom: 7, url: 'https://{s}.terrain.openglobus.org/moon/dem/{z}/{x}/{y}.png', heightFactor: 0.5 }); } catch (e) { terrain = new EmptyTerrain(); }
      opts.ellipsoid = moonEll; opts.atmosphereEnabled = false; opts.nightTextureSrc = null; opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    } else {
      layers = [new XYZ('OnMars', { isBaseLayer: true, url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/MDIM/MapServer/tile/{z}/{y}/{x}?blankTile=false', visibility: true })];
      try { terrain = new RgbTerrain('Mars', { geoidSrc: null, maxZoom: 8, url: 'https://{s}.terrain.openglobus.org/mars/dem/{z}/{x}/{y}.png', heightFactor: 1.1 }); } catch (e) { try { terrain = new EmptyTerrain(); } catch (e2) { terrain = null; } }
      if (marsEll) opts.ellipsoid = marsEll; opts.atmosphereEnabled = false; opts.nightTextureSrc = null; opts.specularTextureSrc = null;
      if (quadTreeStrategyType && quadTreeStrategyType.equi) opts.quadTreeStrategyPrototype = quadTreeStrategyType.equi;
    }
    opts.layers = layers; opts.terrain = terrain || new EmptyTerrain();
    globe = new Globe(opts); window.globe = globe;
    try {
      if (globe.planet.camera) { globe.planet.camera.minAltitude = 5; globe.planet.camera.maxAltitude = 8e6; }
      if (control && control.ZoomControl) globe.planet.addControl(new control.ZoomControl());
      if (globe.planet.camera.flyLonLat) globe.planet.camera.flyLonLat(new LonLat(0, 10, planetId === 'mars' ? 5e6 : 2.5e6));
    } catch (e) {}
    setStatus(planetId.toUpperCase() + ' · NASA mosaic', true);
  }

  function zoomBy(dir) {
    if (scale === 'universe' || scale === 'solar') {
      solarZoom = Math.max(0.25, Math.min(scale === 'solar' ? 14 : 12, solarZoom * (dir > 0 ? 1.2 : 0.83)));
      if (scale === 'solar' && solarZoom > 12) setScale('earth');
      else if (scale === 'solar' && solarZoom < 0.3) setScale('universe');
      return;
    }
    if (maplibre) {
      maplibre.easeTo({ zoom: Math.max(0.5, Math.min(20, maplibre.getZoom() + (dir > 0 ? 1.0 : -1.0))), duration: 250 });
      return;
    }
    if (globe && og) {
      try {
        const cam = globe.planet.camera; const LonLat = og.LonLat;
        const ll = cam.getLonLat && cam.getLonLat(); const alt = (ll && ll.height) || 5e6;
        cam.flyLonLat(new LonLat(ll ? ll.lon : 0, ll ? ll.lat : 10, Math.max(5, Math.min(2e7, dir > 0 ? alt * 0.5 : alt * 2))));
      } catch (e) {}
    }
  }

  async function setScale(next) {
    scale = next; markChrome();
    try { localStorage.setItem('tm-scale', scale); } catch (e) {}
    if (scale === 'universe' || scale === 'solar') {
      destroyViews(); resetSky(); showSolar(true);
      return;
    }
    showSolar(false); setStatus('LOADING ' + scale.toUpperCase() + '…', true);
    try {
      if (scale === 'earth') await enterEarth();
      else if (scale === 'moon' || scale === 'mars') await enterPlanet(scale);
      else await enterEarth();
    } catch (err) { console.error(err); setStatus('FAILED · ' + (err.message || err), false); }
  }

  injectChrome();
  try { scale = localStorage.getItem('tm-scale') || 'earth'; } catch (e) {}
  if (['moon', 'mars', 'solar', 'universe'].indexOf(scale) < 0) scale = 'earth';
  setStatus('STARTING…', true);
  setScale(scale);
  setInterval(function () { if (!activeWx.radar) updateTimeLabel(); }, 1000);
  window.TrackMeNowEngine = { name: 'TrackMeNow realtime', setScale: setScale, zoomBy: zoomBy, get scale() { return scale; } };
})();
