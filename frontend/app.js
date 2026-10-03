const map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([20, 0], 3);
const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' }).addTo(map);
const labels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' }).addTo(map);
const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{y}/{x}.png', { maxZoom: 17, attribution: '© OpenTopoMap contributors' });
L.control.layers({ Satellite: satellite, Streets: streets, Terrain: terrain }, { 'Satellite labels': labels }, { collapsed: true }).addTo(map);

const status = document.getElementById('status');
const search = document.getElementById('search');
let marker, accuracy, trail, sessionId, watchId;
const trailPoints = [];

async function createSession() {
  const r = await fetch('/api/sessions', { method: 'POST' });
  if (!r.ok) throw new Error('Unable to create tracking session');
  return (await r.json()).id;
}

async function sendPoint(p) {
  if (!sessionId) return;
  await fetch(`/api/sessions/${sessionId}/location`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(p) });
}

function renderPosition(pos) {
  const c = [pos.coords.latitude, pos.coords.longitude];
  if (!marker) marker = L.marker(c).addTo(map);
  else marker.setLatLng(c);
  if (!accuracy) accuracy = L.circle(c, { radius: pos.coords.accuracy || 0, weight: 1 }).addTo(map);
  else accuracy.setLatLng(c).setRadius(pos.coords.accuracy || 0);
  trailPoints.push(c);
  if (!trail) trail = L.polyline(trailPoints, { weight: 4 }).addTo(map); else trail.setLatLngs(trailPoints);
  map.setView(c, Math.max(map.getZoom(), 16), { animate:true });
  status.textContent = `LIVE GPS · ±${Math.round(pos.coords.accuracy || 0)} m · ${new Date().toLocaleTimeString()}`;
}

document.getElementById('gpsBtn').onclick = async () => {
  const btn = document.getElementById('gpsBtn');
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId); watchId = null;
    if (sessionId) fetch(`/api/sessions/${sessionId}/stop`, {method:'POST'});
    btn.textContent = 'Start Live GPS'; btn.classList.remove('stop'); status.textContent = 'READY · LIVE GPS OFF'; return;
  }
  if (!navigator.geolocation) return alert('This browser does not provide GPS location.');
  try { sessionId = await createSession(); } catch (e) { return alert(e.message); }
  watchId = navigator.geolocation.watchPosition(pos => {
    renderPosition(pos);
    sendPoint({ lat:pos.coords.latitude, lon:pos.coords.longitude, accuracy:pos.coords.accuracy, altitude:pos.coords.altitude, heading:pos.coords.heading, speed:pos.coords.speed, timestamp:new Date(pos.timestamp).toISOString() });
  }, err => { status.textContent = `GPS ERROR · ${err.message}`; }, { enableHighAccuracy:true, maximumAge:3000, timeout:15000 });
  btn.textContent = 'Stop Live GPS'; btn.classList.add('stop');
};

async function searchPlace() {
  const q = search.value.trim(); if (!q) return;
  const coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coord) { const c=[+coord[1],+coord[2]]; map.setView(c,16); L.marker(c).addTo(map).bindPopup('Search result').openPopup(); return; }
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`);
  const data = await r.json(); if (!data[0]) return alert('No place result found.');
  const c=[+data[0].lat,+data[0].lon]; map.setView(c,15); L.marker(c).addTo(map).bindPopup(data[0].display_name).openPopup();
}
document.getElementById('searchBtn').onclick = searchPlace;
search.addEventListener('keydown', e => { if(e.key==='Enter') searchPlace(); });