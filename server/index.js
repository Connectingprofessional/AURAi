import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const sessions = new Map();

function session(id) {
  if (!sessions.has(id)) sessions.set(id, { id, status: 'active', createdAt: new Date().toISOString(), points: [] });
  return sessions.get(id);
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) if (client.readyState === 1) client.send(payload);
}

app.get('/health', (_, res) => res.json({ ok: true, service: 'trackmenow-api' }));

app.post('/api/sessions', (_, res) => {
  const id = crypto.randomUUID();
  const item = session(id);
  res.status(201).json(item);
});

app.post('/api/sessions/:id/location', (req, res) => {
  const item = session(req.params.id);
  if (item.status !== 'active') return res.status(409).json({ error: 'session is stopped' });
  const point = {
    id: crypto.randomUUID(),
    lat: Number(req.body.lat),
    lon: Number(req.body.lon),
    accuracy: req.body.accuracy == null ? null : Number(req.body.accuracy),
    altitude: req.body.altitude == null ? null : Number(req.body.altitude),
    heading: req.body.heading == null ? null : Number(req.body.heading),
    speed: req.body.speed == null ? null : Number(req.body.speed),
    source: req.body.source || 'browser-gps',
    timestamp: req.body.timestamp || new Date().toISOString()
  };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return res.status(400).json({ error: 'invalid coordinates' });
  item.points.push(point);
  broadcast({ type: 'location', sessionId: item.id, point });
  res.status(201).json(point);
});

app.get('/api/sessions/:id/history', (req, res) => {
  const item = sessions.get(req.params.id);
  res.json(item?.points || []);
});

app.post('/api/sessions/:id/stop', (req, res) => {
  const item = sessions.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'session not found' });
  item.status = 'stopped';
  item.stoppedAt = new Date().toISOString();
  broadcast({ type: 'session-stopped', sessionId: item.id });
  res.json(item);
});

wss.on('connection', socket => {
  socket.send(JSON.stringify({ type: 'ready', service: 'trackmenow' }));
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html')));

const port = process.env.PORT || 8787;
server.listen(port, () => console.log(`TrackMeNow listening on ${port}`));