/* TrackMeNow — Universe + Solar System immersive views */
(function () {
  'use strict';
  // BOOTSTRAP: full engine temporarily loaded from last good commit while large-file push is completed.
  // Hardens API base to Cloudflare Worker (GitHub Pages has no /api routes).
  window.TM_API_BASE = window.TM_API_BASE || 'https://wispy-bush-9aee.recreationeeraj.workers.dev';
  window.TM_MOVEMENT_API_BASE = window.TM_MOVEMENT_API_BASE || window.TM_API_BASE;
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/gh/Connectingprofessional/TrackMenow@c67140b4cf94072d243a551232594c23e18394e3/trackmenow.js';
  s.async = false;
  document.head.appendChild(s);
})();
