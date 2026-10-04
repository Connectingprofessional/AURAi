# TrackMeNow

Real-time consent-based GPS tracking and **MapLibre GL Global Intelligence** map (Argos Atlas–style reference UI).

## What you get
- Full-screen **MapLibre GL** map (WebGL): satellite / dark / terrain, flat ↔ 3D globe, tilt & rotate
- Live aircraft (OpenSky ADS-B), ships (AIS when configured), public transport (GTFS-RT), cameras & infrastructure (OSM/Overpass)
- Browser GPS (`navigator.geolocation`), accuracy circle, heading/speed, movement trail
- Place / coordinate / object search
- WebSocket rooms + session / history API
- PostgreSQL / PostGIS–ready schema
- Explicit separation: **LIVE GPS** · **LIVE RADIO** (native only) · **PUBLIC CELL DATABASE**

## Architecture
| Layer | Path | Role |
|--------|------|------|
| UI | `index.html` + `trackmenow.js` + MapLibre vendor | Single Global Intelligence frontend |
| API | `server/index.js` + `server/global-sources.js` | Express + WebSocket + live feeds |
| DB | `database/schema.sql` | Optional PostGIS persistence |
| Static host | GitHub Pages | Map UI only (no Node API) |
| Full stack | `npm start` | UI + API on same origin |

The old **Leaflet** `frontend/` tree and **Render** deploy config have been removed. The client uses **same-origin** API URLs (no hardcoded Render host).

## Run locally
```bash
cp .env.example .env   # optional keys
npm install
npm start
```
Open http://localhost:8787

## Environment (optional)
See `.env.example`. Important keys:
- `DATABASE_URL` — enable PostGIS session history
- `GTFS_REALTIME_URLS` — comma-separated VehiclePositions feeds
- `AISSTREAM_API_KEY` / `AIS_API_URL` — ships
- `OPENCELLID_API_KEY` — public cells
- `CAMERA_GEOJSON_URLS` — public camera GeoJSON
- `APPLIXIR_API_KEY` — optional rewarded ads

## GitHub Pages
Workflow `.github/workflows/pages.yml` publishes the **static MapLibre UI** from the repo root.
Live feed panels need the Node API (run `npm start` or host `server/` elsewhere). Without the API, basemap, GPS and search still work; movement layers show source errors until an API is available.

## Data honesty
- A browser cannot read modem radio fields (MCC/MNC, Cell ID, RSRP…). Those need a native companion.
- Satellite basemap is **not** live video.
- Aircraft, ships and other movers only appear from legitimate public feeds — never fabricated.

## License / attribution
MapLibre GL, OpenStreetMap, Natural Earth, OpenSky, USGS, and other sources remain under their respective licences.
