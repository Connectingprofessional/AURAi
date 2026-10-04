/* TrackMeNow — MapLibre Global Intelligence
 * Loads last-known-good core, forces same-origin API (no Render),
 * then enables 3 view modes: Globe 3D / Satellite / Dark digital.
 */
(function(){
  const API = (typeof location !== 'undefined' && location.origin && !location.origin.startsWith('file:'))
    ? location.origin : '';
  window.__TM_API = API;

  const CORE_URL = 'https://cdn.jsdelivr.net/gh/Connectingprofessional/TrackMenow@810bcc4dd7102a33008f9ef083e6c7a70eed7e33/trackmenow.js';

  function injectViewModes(){
    /* Three Argos-style views — realtime zoom from orbital → building tops */
    if (!window.map || !window.maplibregl) return;
    const map = window.map;

    const VIEWS = {
      globe: {
        id: 'globe',
        label: '3D Globe',
        projection: 'globe',
        base: 'satellite',
        pitch: 0,
        minZoom: 0.5,
        maxZoom: 18,
        fog: { color: '#08131a', 'high-color': '#0a2230', 'space-color': '#02050b', 'horizon-blend': 0.16, range: [0.5, 10] }
      },
      satellite: {
        id: 'satellite',
        label: 'Satellite',
        projection: 'mercator',
        base: 'satellite',
        pitch: 0,
        minZoom: 0.8,
        maxZoom: 19,
        fog: null
      },
      dark: {
        id: 'dark',
        label: 'Dark Digital',
        projection: 'mercator',
        base: 'dark',
        pitch: 0,
        minZoom: 0.8,
        maxZoom: 19,
        fog: null
      }
    };

    let currentView = localStorage.getItem('tm-view') || 'globe';

    function setBaseLayers(mode){
      const showSat = mode === 'satellite' || mode === 'globe';
      const showDark = mode === 'dark';
      try {
        if (map.getLayer('base-satellite')) map.setLayoutProperty('base-satellite', 'visibility', showSat ? 'visible' : 'none');
        if (map.getLayer('base-dark')) map.setLayoutProperty('base-dark', 'visibility', showDark ? 'visible' : 'none');
        if (map.getLayer('base-labels')) map.setLayoutProperty('base-labels', 'visibility', 'visible');
        if (map.getLayer('base-terrain')) map.setLayoutProperty('base-terrain', 'visibility', 'none');
        if (map.getLayer('base-streets')) map.setLayoutProperty('base-streets', 'visibility', 'none');
        /* Globe skin (Natural Earth land/ocean) only in globe mode at low zoom */
        const globeSkin = mode === 'globe';
        ['globe-ocean','globe-land','globe-borders'].forEach(id => {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', globeSkin ? 'visible' : 'none');
        });
        if (map.getLayer('base-satellite') && mode === 'globe') {
          map.setPaintProperty('base-satellite', 'raster-opacity', 0.35);
        } else if (map.getLayer('base-satellite') && mode === 'satellite') {
          map.setPaintProperty('base-satellite', 'raster-opacity', 1);
        }
      } catch (e) { console.warn('[view] base layers', e); }
    }

    function applyView(id, opts){
      const v = VIEWS[id] || VIEWS.globe;
      currentView = v.id;
      try { localStorage.setItem('tm-view', currentView); } catch (e) {}
      try {
        map.setMinZoom(v.minZoom);
        map.setMaxZoom(v.maxZoom);
        if (map.setProjection) map.setProjection({ type: v.projection });
        if (map.setFog) map.setFog(v.fog);
        setBaseLayers(v.id);
        if (opts && opts.reset) {
          map.easeTo({ zoom: v.id === 'globe' ? 1.6 : 2.2, pitch: 0, bearing: 0, duration: 900 });
        }
      } catch (e) { console.warn('[view] apply', e); }
      document.querySelectorAll('[data-tm-view]').forEach(btn => {
        btn.classList.toggle('on', btn.getAttribute('data-tm-view') === currentView);
      });
      /* Expose for existing globe toggle */
      if (typeof window.globeOn !== 'undefined') window.globeOn = (currentView === 'globe');
      return currentView;
    }

    /* Continuous zoom: orbital (z≈0.5) → continent → city → building tops (z≈18–19) */
    map.setMinZoom(0.5);
    map.setMaxZoom(19);

    /* Wire existing UI buttons if present */
    const wire = () => {
      const globeBtn = document.getElementById('argos-globe');
      const satBtn = document.getElementById('argos-sat');
      const mapBtn = document.getElementById('argos-map');
      if (globeBtn) {
        globeBtn.setAttribute('data-tm-view', 'globe');
        globeBtn.onclick = () => applyView('globe', { reset: true });
      }
      if (satBtn) {
        satBtn.setAttribute('data-tm-view', 'satellite');
        satBtn.onclick = () => applyView('satellite', { reset: false });
      }
      if (mapBtn) {
        mapBtn.setAttribute('data-tm-view', 'dark');
        mapBtn.onclick = () => applyView('dark', { reset: false });
      }
      applyView(currentView, { reset: false });
    };

    if (map.isStyleLoaded && map.isStyleLoaded()) wire();
    else map.once('load', wire);
    map.on('style.load', wire);

    window.TrackMeNowViews = { applyView, VIEWS, get current() { return currentView; } };
  }

  function boot(){
    fetch(CORE_URL, { cache: 'force-cache' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(src => {
        /* Force same-origin API; strip old Render URL */
        src = src.replace(
          /const API\s*=\s*['"]https:\/\/trackmenow-5rez\.onrender\.com['"]\s*;/,
          "const API=(window.__TM_API||(typeof location!=='undefined'?location.origin:''));"
        );
        (0, eval)(src);
        /* After core maps init, enhance views */
        const tryInject = () => {
          if (window.map) { injectViewModes(); return true; }
          return false;
        };
        if (!tryInject()) {
          let n = 0;
          const t = setInterval(() => {
            if (tryInject() || ++n > 80) clearInterval(t);
          }, 100);
        }
      })
      .catch(e => {
        console.error('[TrackMeNow] core load failed', e);
        const el = document.getElementById('status');
        if (el) el.innerHTML = '<span style="color:#ff6672">●</span> FAILED TO LOAD MAP CORE — check network / jsDelivr';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
