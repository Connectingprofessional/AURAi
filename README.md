# TrackMeNow

Real-time consent-based GPS tracking and map intelligence foundation.

## Current foundation
- Full-screen map with no overlay panels
- Satellite imagery + labels, street and terrain layers
- Browser GPS using navigator.geolocation.watchPosition
- Accuracy circle, heading/speed and movement trail
- Place/coordinate search
- WebSocket telemetry endpoint
- Session/history API
- PostgreSQL/PostGIS-ready database schema
- Explicit separation between LIVE GPS, LIVE RADIO and PUBLIC CELL DATABASE

## Important data boundaries
A normal browser cannot directly read modem radio fields such as MCC/MNC, Cell ID, RSRP, RSRQ or SINR. Those require a native mobile companion with OS permissions. TrackMeNow must never fabricate those values.

Satellite basemap imagery is not live satellite video. Aircraft, ships, rail and other moving objects require legitimate live/public data feeds and are represented as separate overlays.

## Run
```bash
npm install
npm start
```

Then open http://localhost:8787.
